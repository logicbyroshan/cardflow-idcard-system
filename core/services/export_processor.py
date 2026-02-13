"""
Export Processor

Memory-efficient export processing for ZIP, PDF, DOCX, and Excel files.

CRITICAL DESIGN RULES:
1. NEVER use BytesIO for large outputs
2. Write directly to temp file on disk
3. Use ZIP_STORED (no compression) for memory efficiency
4. Process images one at a time
5. Stream file response with cleanup callback

Usage:
    # Called from background worker
    from core.services.export_processor import process_export_zip
    process_export_zip(task)
"""
import os
import logging
import tempfile
import zipfile
from datetime import datetime

from django.conf import settings
from django.core.files.storage import default_storage

logger = logging.getLogger(__name__)


def process_export_zip(task):
    """
    Export images from cards to a ZIP file on disk.
    
    CRITICAL:
    - ZIP is created directly on disk, not in memory
    - Uses ZIP_STORED (no compression) for memory efficiency
    - Images are added one at a time
    
    Args:
        task: BackgroundTask instance with metadata:
            - table_id: int
            - card_ids: list (optional)
            - status: str (optional)
            - image_fields: list (optional, defaults to all)
    """
    from core.models import IDCardTable, IDCard
    from core.services.background_worker import ensure_exports_directory
    from mediafiles.services import ImageService
    from exports.utils import get_image_fields, clean_filename, is_valid_image_path
    
    metadata = task.metadata or {}
    table_id = metadata.get('table_id')
    
    if not table_id:
        task.mark_failed("Missing table_id in metadata")
        return
    
    try:
        table = IDCardTable.objects.select_related('group__client').get(id=table_id)
    except IDCardTable.DoesNotExist:
        task.mark_failed(f"Table {table_id} not found")
        return
    
    # Get cards
    card_ids = metadata.get('card_ids', [])
    status_filter = metadata.get('status', '')
    
    if card_ids:
        cards_qs = IDCard.objects.filter(table=table, id__in=card_ids).order_by('id')
    elif status_filter:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('id')
    else:
        cards_qs = IDCard.objects.filter(table=table).order_by('id')
    
    total_cards = cards_qs.count()
    if total_cards == 0:
        task.mark_failed("No cards to export")
        return
    
    # Get image fields
    image_fields = get_image_fields(table.fields or [])
    if not image_fields:
        task.mark_failed("No image fields found in table")
        return
    
    task.update_progress(0, total_cards * len(image_fields))
    
    # Get client name for filename
    client_name = table.group.client.name if table.group and table.group.client else ''
    clean_client = clean_filename(client_name) if client_name else ''
    clean_table = clean_filename(table.name)
    
    # Create exports directory
    exports_dir = ensure_exports_directory()
    
    # Create separate ZIP for each image field
    zip_files_created = []
    total_images = 0
    current_progress = 0
    
    try:
        for field_info in image_fields:
            field_name = field_info['name']
            
            # Generate ZIP filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            clean_field = clean_filename(field_name)
            zip_filename = f"{clean_client}_{clean_table}_{clean_field}_{timestamp}.zip"
            zip_path = os.path.join(exports_dir, zip_filename)
            
            # Create ZIP file on disk with ZIP_STORED (no compression)
            images_in_zip = 0
            used_names = {}
            
            with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_STORED) as zf:
                for card in cards_qs.iterator(chunk_size=100):
                    # Get image path for this card/field
                    img_path = ImageService.get_image_path_for_card(
                        card=card,
                        field_name=field_name,
                        fallback_to_field_data=True
                    )
                    
                    # Skip if no valid path (type narrowing for str)
                    if not img_path or not is_valid_image_path(img_path):
                        current_progress += 1
                        continue
                    
                    try:
                        if default_storage.exists(img_path):
                            # Read image from storage and add to ZIP
                            with default_storage.open(img_path, 'rb') as img_file:
                                img_data = img_file.read()
                                
                                # Minimum valid image size check
                                if img_data and len(img_data) >= 100:
                                    base = os.path.basename(img_path)
                                    
                                    # Handle duplicate filenames
                                    if base in used_names:
                                        used_names[base] += 1
                                        name, ext = os.path.splitext(base)
                                        download_filename = f"{name}_{used_names[base]}{ext}"
                                    else:
                                        used_names[base] = 0
                                        download_filename = base
                                    
                                    # Write to ZIP
                                    zf.writestr(download_filename, img_data)
                                    images_in_zip += 1
                    except Exception as e:
                        logger.warning("Error adding image to ZIP: %s", e)
                    
                    current_progress += 1
                    
                    # Update progress every 50 images
                    if current_progress % 50 == 0:
                        task.update_progress(current_progress)
            
            # Only keep ZIP if it has images
            if images_in_zip > 0:
                relative_path = os.path.relpath(zip_path, settings.MEDIA_ROOT)
                zip_files_created.append({
                    'field_name': field_name,
                    'filename': zip_filename,
                    'path': relative_path,
                    'image_count': images_in_zip
                })
                total_images += images_in_zip
            else:
                # Remove empty ZIP
                os.remove(zip_path)
        
        # Update final progress
        task.update_progress(current_progress)
        
        if not zip_files_created:
            task.mark_failed("No images found to export")
            return
        
        # Store results in metadata
        task.metadata['result'] = {
            'zip_files': zip_files_created,
            'total_images': total_images,
            'total_zips': len(zip_files_created)
        }
        task.save(update_fields=['metadata'])
        
        # Set result path to first ZIP (or could be a combined ZIP)
        task.mark_completed(result_path=zip_files_created[0]['path'])
        logger.info("ZIP export completed: %d images in %d files", total_images, len(zip_files_created))
        
    except Exception as e:
        # Cleanup any partially created ZIPs
        for zip_info in zip_files_created:
            try:
                full_path = os.path.join(settings.MEDIA_ROOT, zip_info['path'])
                if os.path.exists(full_path):
                    os.remove(full_path)
            except Exception:
                pass
        
        logger.exception("ZIP export failed: %s", e)
        task.mark_failed(str(e))


def process_export_pdf(task):
    """
    Export cards to PDF file on disk.
    
    CRITICAL: PDF is generated to a temp file, not in memory.
    """
    from core.models import IDCardTable, IDCard
    from core.services.background_worker import ensure_exports_directory
    from exports.pdf import PdfExporter
    from exports.utils import generate_export_filename
    
    metadata = task.metadata or {}
    table_id = metadata.get('table_id')
    
    if not table_id:
        task.mark_failed("Missing table_id in metadata")
        return
    
    try:
        table = IDCardTable.objects.select_related('group__client').get(id=table_id)
    except IDCardTable.DoesNotExist:
        task.mark_failed(f"Table {table_id} not found")
        return
    
    # Get cards
    card_ids = metadata.get('card_ids', [])
    status_filter = metadata.get('status', '')
    
    if card_ids:
        cards_qs = IDCard.objects.filter(table=table, id__in=card_ids).order_by('id')
    elif status_filter:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('id')
    else:
        cards_qs = IDCard.objects.filter(table=table).order_by('id')
    
    total_cards = cards_qs.count()
    if total_cards == 0:
        task.mark_failed("No cards to export")
        return
    
    task.update_progress(0, total_cards)
    
    try:
        # Use existing PDF exporter but save to file
        exporter = PdfExporter()
        result = exporter.export_cards(table, cards_qs, status=status_filter)
        
        if not result.success:
            task.mark_failed(result.message)
            return
        
        # Validate response has content
        if not result.response or not hasattr(result.response, 'content') or not result.response.content:
            task.mark_failed("PDF exporter returned empty response")
            return
        
        # Save response content to file
        exports_dir = ensure_exports_directory()
        client_name = table.group.client.name if table.group and table.group.client else ''
        filename = generate_export_filename(table.name, 'pdf', client_name=client_name, status=status_filter)
        
        pdf_path = os.path.join(exports_dir, filename)
        
        with open(pdf_path, 'wb') as f:
            f.write(result.response.content)
        
        relative_path = os.path.relpath(pdf_path, settings.MEDIA_ROOT)
        
        # Store results
        task.metadata['result'] = {
            'filename': filename,
            'path': relative_path,
            'card_count': result.card_count
        }
        task.save(update_fields=['metadata'])
        
        task.update_progress(total_cards)
        task.mark_completed(result_path=relative_path)
        logger.info("PDF export completed: %d cards", result.card_count)
        
    except Exception as e:
        logger.exception("PDF export failed: %s", e)
        task.mark_failed(str(e))


def process_export_docx(task):
    """
    Export cards to DOCX file on disk.
    """
    from core.models import IDCardTable, IDCard
    from core.services.background_worker import ensure_exports_directory
    from exports.word import WordExporter
    from exports.utils import generate_export_filename
    
    metadata = task.metadata or {}
    table_id = metadata.get('table_id')
    
    if not table_id:
        task.mark_failed("Missing table_id in metadata")
        return
    
    try:
        table = IDCardTable.objects.select_related('group__client').get(id=table_id)
    except IDCardTable.DoesNotExist:
        task.mark_failed(f"Table {table_id} not found")
        return
    
    # Get cards
    card_ids = metadata.get('card_ids', [])
    status_filter = metadata.get('status', '')
    
    if card_ids:
        cards_qs = IDCard.objects.filter(table=table, id__in=card_ids).order_by('id')
    elif status_filter:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('id')
    else:
        cards_qs = IDCard.objects.filter(table=table).order_by('id')
    
    total_cards = cards_qs.count()
    if total_cards == 0:
        task.mark_failed("No cards to export")
        return
    
    task.update_progress(0, total_cards)
    
    try:
        # Use existing Word exporter
        exporter = WordExporter()
        result = exporter.export_cards(table, cards_qs, status=status_filter)
        
        if not result.success:
            task.mark_failed(result.message)
            return
        
        # Validate response has content
        if not result.response or not hasattr(result.response, 'content') or not result.response.content:
            task.mark_failed("DOCX exporter returned empty response")
            return
        
        # Save response content to file
        exports_dir = ensure_exports_directory()
        client_name = table.group.client.name if table.group and table.group.client else ''
        filename = generate_export_filename(table.name, 'docx', client_name=client_name, status=status_filter)
        
        docx_path = os.path.join(exports_dir, filename)
        
        with open(docx_path, 'wb') as f:
            f.write(result.response.content)
        
        relative_path = os.path.relpath(docx_path, settings.MEDIA_ROOT)
        
        # Store results
        task.metadata['result'] = {
            'filename': filename,
            'path': relative_path,
            'card_count': result.card_count
        }
        task.save(update_fields=['metadata'])
        
        task.update_progress(total_cards)
        task.mark_completed(result_path=relative_path)
        logger.info("DOCX export completed: %d cards", result.card_count)
        
    except Exception as e:
        logger.exception("DOCX export failed: %s", e)
        task.mark_failed(str(e))


def process_export_excel(task):
    """
    Export cards to Excel file on disk.
    """
    from core.models import IDCardTable, IDCard
    from core.services.background_worker import ensure_exports_directory
    from exports.excel import ExcelExporter
    from exports.utils import generate_export_filename
    
    metadata = task.metadata or {}
    table_id = metadata.get('table_id')
    
    if not table_id:
        task.mark_failed("Missing table_id in metadata")
        return
    
    try:
        table = IDCardTable.objects.select_related('group__client').get(id=table_id)
    except IDCardTable.DoesNotExist:
        task.mark_failed(f"Table {table_id} not found")
        return
    
    # Get cards
    card_ids = metadata.get('card_ids', [])
    status_filter = metadata.get('status', '')
    
    if card_ids:
        cards_qs = IDCard.objects.filter(table=table, id__in=card_ids).order_by('id')
    elif status_filter:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('id')
    else:
        cards_qs = IDCard.objects.filter(table=table).order_by('id')
    
    total_cards = cards_qs.count()
    if total_cards == 0:
        task.mark_failed("No cards to export")
        return
    
    task.update_progress(0, total_cards)
    
    try:
        # Use existing Excel exporter
        exporter = ExcelExporter()
        result = exporter.export_cards(table, cards_qs)
        
        if not result.success:
            task.mark_failed(result.message)
            return
        
        # Validate response has content
        if not result.response or not hasattr(result.response, 'content') or not result.response.content:
            task.mark_failed("Excel exporter returned empty response")
            return
        
        # Save response content to file
        exports_dir = ensure_exports_directory()
        client_name = table.group.client.name if table.group and table.group.client else ''
        filename = generate_export_filename(table.name, 'xlsx', client_name=client_name, status=status_filter)
        
        excel_path = os.path.join(exports_dir, filename)
        
        with open(excel_path, 'wb') as f:
            f.write(result.response.content)
        
        relative_path = os.path.relpath(excel_path, settings.MEDIA_ROOT)
        
        # Store results (ExcelExportResult uses row_count instead of card_count)
        task.metadata['result'] = {
            'filename': filename,
            'path': relative_path,
            'card_count': result.row_count
        }
        task.save(update_fields=['metadata'])
        
        task.update_progress(total_cards)
        task.mark_completed(result_path=relative_path)
        logger.info("Excel export completed: %d rows", result.row_count)
        
    except Exception as e:
        logger.exception("Excel export failed: %s", e)
        task.mark_failed(str(e))
