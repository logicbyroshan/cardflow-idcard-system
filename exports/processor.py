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
import time
import zipfile
from datetime import datetime

from django.conf import settings
from django.utils import timezone as django_tz
from django.core.files.storage import default_storage
from django.http import StreamingHttpResponse

logger = logging.getLogger(__name__)


def _extract_response_bytes(response):
    """
    Extract raw bytes from an HttpResponse or StreamingHttpResponse.
    
    stream_file_response returns HttpResponse for files <10 MB and
    StreamingHttpResponse for larger files. This helper handles both
    so that background export processors can reliably save the content.
    
    Returns bytes or None if the response has no content.
    """
    if response is None:
        return None
    if isinstance(response, StreamingHttpResponse):
        # Read streaming chunks into bytes
        chunks = []
        for chunk in response.streaming_content:
            if isinstance(chunk, str):
                chunk = chunk.encode('utf-8')
            chunks.append(chunk)
        return b''.join(chunks) if chunks else None
    # Regular HttpResponse — has .content
    if hasattr(response, 'content') and response.content:
        return response.content
    return None


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
    from idcards.models import IDCardTable, IDCard
    from core.services.background_worker import ensure_exports_directory
    from mediafiles.services import ImageService
    from exports.utils import get_image_fields, clean_filename, is_valid_image_path, sort_cards_for_export
    
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
        cards_qs = IDCard.objects.filter(table=table, id__in=card_ids)
    elif status_filter:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter)
    else:
        cards_qs = IDCard.objects.filter(table=table)
    
    # Sort: class → section → name ascending
    cards_qs = sort_cards_for_export(cards_qs, table.fields or [])
    
    total_cards = cards_qs.count() if hasattr(cards_qs, 'count') else len(cards_qs)
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
    
    # Create a SINGLE ZIP with subdirectories per image field
    from exports.zip import _get_readable_field_name
    
    timestamp = django_tz.localtime(django_tz.now()).strftime('%Y%m%d_%H%M%S')
    zip_filename = f"{clean_client}_{clean_table}_Images_{timestamp}.zip"
    zip_path = os.path.join(exports_dir, zip_filename)
    
    zip_files_created = []
    total_images = 0
    current_progress = 0
    
    try:
        with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_STORED) as zf:
            for field_info in image_fields:
                field_name = field_info['name']
                folder_name = _get_readable_field_name(field_name)
                used_names = {}
                
                for card in cards_qs.iterator(chunk_size=100):
                    img_path = ImageService.get_image_path_for_card(
                        card=card,
                        field_name=field_name,
                        fallback_to_field_data=True
                    )
                    
                    if not img_path or not is_valid_image_path(img_path):
                        current_progress += 1
                        continue
                    
                    try:
                        if default_storage.exists(img_path):
                            try:
                                real_path = default_storage.path(img_path)
                                file_size = os.path.getsize(real_path)
                            except (NotImplementedError, AttributeError, OSError):
                                real_path = None
                                file_size = 0

                            base = os.path.basename(img_path)

                            if base in used_names:
                                used_names[base] += 1
                                name, ext = os.path.splitext(base)
                                download_filename = f"{name}_{used_names[base]}{ext}"
                            else:
                                used_names[base] = 0
                                download_filename = base

                            arcname = f"{folder_name}/{download_filename}"

                            if real_path and file_size >= 100:
                                zf.write(real_path, arcname=arcname)
                                total_images += 1
                            elif not real_path:
                                with default_storage.open(img_path, 'rb') as img_file:
                                    img_data = img_file.read()
                                if img_data and len(img_data) >= 100:
                                    zf.writestr(arcname, img_data)
                                    total_images += 1
                    except Exception as e:
                        logger.warning("Error adding image to ZIP: %s", e)
                    
                    current_progress += 1
                    
                    if current_progress % 50 == 0:
                        task.update_progress(current_progress)
        
        task.update_progress(current_progress)
        
        if total_images == 0:
            try:
                os.remove(zip_path)
            except Exception:
                pass
            task.mark_failed("No images found to export")
            return
        
        relative_path = os.path.relpath(zip_path, settings.MEDIA_ROOT)
        zip_files_created.append({
            'field_name': 'ALL',
            'filename': zip_filename,
            'path': relative_path,
            'image_count': total_images
        })
        
        # Store results in metadata
        task.metadata['result'] = {
            'zip_files': zip_files_created,
            'total_images': total_images,
            'total_zips': len(zip_files_created)
        }
        task.save(update_fields=['metadata'])
        
        task.mark_completed(result_path=zip_files_created[0]['path'])

        # Determine total file size on disk
        total_bytes = 0
        for zi in zip_files_created:
            full = os.path.join(settings.MEDIA_ROOT, zi['path'])
            if os.path.exists(full):
                total_bytes += os.path.getsize(full)

        logger.info(
            "EXPORT_DONE type=zip task_id=%d cards=%d images=%d zips=%d size_mb=%.2f",
            task.id, total_cards, total_images, len(zip_files_created),
            total_bytes / (1024 * 1024),
        )
        
    except Exception as e:
        # Cleanup current partial ZIP being written
        if 'zip_path' in locals():
            try:
                full_zip = os.path.join(settings.MEDIA_ROOT, zip_path)
                if os.path.exists(full_zip):
                    os.remove(full_zip)
            except Exception as cleanup_err:
                logger.warning('Failed to cleanup partial ZIP %s: %s', zip_path, cleanup_err)
        # Cleanup any fully created ZIPs
        for zip_info in zip_files_created:
            try:
                full_path = os.path.join(settings.MEDIA_ROOT, zip_info['path'])
                if os.path.exists(full_path):
                    os.remove(full_path)
            except Exception as cleanup_err:
                logger.warning('Failed to cleanup ZIP %s: %s', zip_info.get('path', '?'), cleanup_err)
        
        logger.exception("ZIP export failed: %s", e)
        task.mark_failed(str(e))


def process_export_pdf(task):
    """
    Export cards to PDF file on disk.
    
    CRITICAL: PDF is generated to a temp file, not in memory.
    """
    from idcards.models import IDCardTable, IDCard
    from core.services.background_worker import ensure_exports_directory
    from exports.pdf import PdfExporter
    from exports.utils import generate_export_filename, sort_cards_for_export
    
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
        cards_qs = IDCard.objects.filter(table=table, id__in=card_ids)
    elif status_filter:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter)
    else:
        cards_qs = IDCard.objects.filter(table=table)
    
    # Sort: class → section → name ascending
    cards_qs = sort_cards_for_export(cards_qs, table.fields or [])
    
    total_cards = cards_qs.count() if hasattr(cards_qs, 'count') else len(cards_qs)
    if total_cards == 0:
        task.mark_failed("No cards to export")
        return
    
    task.update_progress(0, total_cards)

    template_id = metadata.get('template_id')
    font_mode = metadata.get('font_mode', 'auto') or 'auto'
    shorten_titles = bool(metadata.get('shorten_titles', False))

    try:
        # Use existing PDF exporter but save to file
        exporter = PdfExporter()
        result = exporter.export_cards(
            table, cards_qs,
            status=status_filter,
            template_id=template_id,
            font_mode=font_mode,
            shorten_titles=shorten_titles,
        )
        
        if not result.success:
            task.mark_failed(result.message)
            return
        
        # Extract bytes from response (handles both HttpResponse and StreamingHttpResponse)
        pdf_bytes = _extract_response_bytes(result.response)
        if not pdf_bytes:
            task.mark_failed("PDF exporter returned empty response")
            return
        
        # Save to file
        exports_dir = ensure_exports_directory()
        client_name = table.group.client.name if table.group and table.group.client else ''
        filename = generate_export_filename(table.name, 'pdf', client_name=client_name, status=status_filter)
        
        pdf_path = os.path.join(exports_dir, filename)
        
        with open(pdf_path, 'wb') as f:
            f.write(pdf_bytes)
        
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

        size_bytes = os.path.getsize(pdf_path) if os.path.exists(pdf_path) else 0
        logger.info(
            "EXPORT_DONE type=pdf task_id=%d cards=%d size_mb=%.2f",
            task.id, result.card_count, size_bytes / (1024 * 1024),
        )
        
    except Exception as e:
        # Cleanup partial PDF file on failure (e.g. disk-full)
        if 'pdf_path' in locals() and os.path.exists(pdf_path):
            try:
                os.remove(pdf_path)
            except Exception as cleanup_err:
                logger.warning('Failed to cleanup partial PDF %s: %s', pdf_path, cleanup_err)
        logger.exception("PDF export failed: %s", e)
        task.mark_failed(str(e))


def process_export_docx(task):
    """
    Export cards to DOCX file on disk.
    """
    from idcards.models import IDCardTable, IDCard
    from core.services.background_worker import ensure_exports_directory
    from exports.word import WordExporter
    from exports.utils import generate_export_filename, sort_cards_for_export
    
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
        cards_qs = IDCard.objects.filter(table=table, id__in=card_ids)
    elif status_filter:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter)
    else:
        cards_qs = IDCard.objects.filter(table=table)
    
    # Sort: class → section → name ascending
    cards_qs = sort_cards_for_export(cards_qs, table.fields or [])
    
    total_cards = cards_qs.count() if hasattr(cards_qs, 'count') else len(cards_qs)
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
        
        # Extract bytes from response (handles both HttpResponse and StreamingHttpResponse)
        docx_bytes = _extract_response_bytes(result.response)
        if not docx_bytes:
            task.mark_failed("DOCX exporter returned empty response")
            return
        
        # Save to file
        exports_dir = ensure_exports_directory()
        client_name = table.group.client.name if table.group and table.group.client else ''
        filename = generate_export_filename(table.name, 'docx', client_name=client_name, status=status_filter)
        
        docx_path = os.path.join(exports_dir, filename)
        
        with open(docx_path, 'wb') as f:
            f.write(docx_bytes)
        
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

        size_bytes = os.path.getsize(docx_path) if os.path.exists(docx_path) else 0
        logger.info(
            "EXPORT_DONE type=docx task_id=%d cards=%d size_mb=%.2f",
            task.id, result.card_count, size_bytes / (1024 * 1024),
        )
        
    except Exception as e:
        # Cleanup partial DOCX file on failure (e.g. disk-full)
        if 'docx_path' in locals() and os.path.exists(docx_path):
            try:
                os.remove(docx_path)
            except Exception as cleanup_err:
                logger.warning('Failed to cleanup partial DOCX %s: %s', docx_path, cleanup_err)
        logger.exception("DOCX export failed: %s", e)
        task.mark_failed(str(e))


def process_export_excel(task):
    """
    Export cards to Excel file on disk.
    """
    from idcards.models import IDCardTable, IDCard
    from core.services.background_worker import ensure_exports_directory
    from exports.excel import ExcelExporter
    from exports.utils import generate_export_filename, sort_cards_for_export
    
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
        cards_qs = IDCard.objects.filter(table=table, id__in=card_ids)
    elif status_filter:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter)
    else:
        cards_qs = IDCard.objects.filter(table=table)
    
    # Sort: class → section → name ascending
    cards_qs = sort_cards_for_export(cards_qs, table.fields or [])
    
    total_cards = cards_qs.count() if hasattr(cards_qs, 'count') else len(cards_qs)
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
        
        # Extract bytes from response (handles both HttpResponse and StreamingHttpResponse)
        xlsx_bytes = _extract_response_bytes(result.response)
        if not xlsx_bytes:
            task.mark_failed("Excel exporter returned empty response")
            return
        
        # Save to file
        exports_dir = ensure_exports_directory()
        client_name = table.group.client.name if table.group and table.group.client else ''
        filename = generate_export_filename(table.name, 'xlsx', client_name=client_name, status=status_filter)
        
        excel_path = os.path.join(exports_dir, filename)
        
        with open(excel_path, 'wb') as f:
            f.write(xlsx_bytes)
        
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

        size_bytes = os.path.getsize(excel_path) if os.path.exists(excel_path) else 0
        logger.info(
            "EXPORT_DONE type=xlsx task_id=%d rows=%d size_mb=%.2f",
            task.id, result.row_count, size_bytes / (1024 * 1024),
        )
        
    except Exception as e:
        # Cleanup partial Excel file on failure (e.g. disk-full)
        if 'excel_path' in locals() and os.path.exists(excel_path):
            try:
                os.remove(excel_path)
            except Exception as cleanup_err:
                logger.warning('Failed to cleanup partial Excel %s: %s', excel_path, cleanup_err)
        logger.exception("Excel export failed: %s", e)
        task.mark_failed(str(e))
