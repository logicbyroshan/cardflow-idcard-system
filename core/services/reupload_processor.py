"""
Reupload Images Processor

Memory-efficient image reupload processing from ZIP files.

CRITICAL DESIGN RULES:
1. NEVER extract entire ZIP into memory
2. Process ONE image at a time
3. Update progress after each image
4. Cleanup temp files on completion/failure

Usage:
    # Called from background worker
    from core.services.reupload_processor import process_reupload_images
    process_reupload_images(task)
"""
import os
import logging
import zipfile

from django.conf import settings

logger = logging.getLogger(__name__)


def process_reupload_images(task):
    """
    Process image reupload from ZIP on disk.
    
    CRITICAL:
    - ZIP is opened from disk, not loaded into memory
    - Images are matched and processed one at a time
    - Progress is updated after each successful match
    
    Args:
        task: BackgroundTask instance with:
            - file_path: Path to saved ZIP file
            - metadata: {
                'table_id': int,
                'target_field': str (optional),
                'card_ids': list (optional),
                'status_filter': str (optional)
            }
    """
    from idcards.models import IDCardTable, IDCard
    from core.services.base import BaseService
    from mediafiles.services import ImageService
    from core.utils.field_utils import validate_image_bytes
    
    metadata = task.metadata or {}
    table_id = metadata.get('table_id')
    
    if not table_id:
        task.mark_failed("Missing table_id in metadata")
        return
    
    try:
        table = IDCardTable.objects.select_related('group__client').get(id=table_id)
        client = table.group.client
    except IDCardTable.DoesNotExist:
        task.mark_failed(f"Table {table_id} not found")
        return
    
    # Get full path to ZIP file
    zip_path = os.path.join(settings.MEDIA_ROOT, task.file_path) if task.file_path else None
    if not zip_path or not os.path.exists(zip_path):
        task.mark_failed(f"ZIP file not found: {task.file_path}")
        return
    
    # Get image field names
    image_field_names = BaseService.get_image_field_names(table.fields)
    if not image_field_names:
        task.mark_failed("No image fields defined in table")
        return
    
    # Target field (defaults to first image field)
    target_field = metadata.get('target_field', image_field_names[0])
    if target_field not in image_field_names:
        target_field = image_field_names[0]
    
    # Get cards to process
    card_ids = metadata.get('card_ids', [])
    status_filter = metadata.get('status_filter', '')
    
    if card_ids:
        cards_qs = IDCard.objects.filter(table=table, id__in=card_ids).order_by('id')
    elif status_filter and status_filter in BaseService.VALID_STATUSES:
        cards_qs = IDCard.objects.filter(table=table, status=status_filter).order_by('id')
    else:
        cards_qs = IDCard.objects.filter(table=table).order_by('id')
    
    # Count total cards for progress
    total_cards = cards_qs.count()
    if total_cards == 0:
        task.mark_failed("No cards found to reupload images")
        return
    
    task.update_progress(0, total_cards)
    _open_zip = None  # Kept open for entire card loop; closed in finally

    try:
        # First, build index of available images in ZIP (just names, not content)
        # This is memory efficient - only stores filenames
        try:
            zip_image_index = _build_zip_image_index(zip_path)
            logger.info("ZIP index built: %d images found", len(zip_image_index))
        except Exception as e:
            task.mark_failed(f"Failed to read ZIP file: {str(e)}")
            return

        if not zip_image_index:
            task.mark_failed("No valid images found in ZIP file")
            return

        # Open the ZIP once for the entire card loop.
        # Avoids reopening (and re-reading the central directory) for every
        # single image — was N open/close calls, now exactly 1.
        _open_zip = zipfile.ZipFile(zip_path, 'r')

        # Process cards one at a time
        updated_count = 0
        matched_count = 0
        errors = []
        batch_counter = 0
        pending_updates = []  # Accumulated cards for bulk_update; flushed every 50

        for idx, card in enumerate(cards_qs.iterator(chunk_size=100)):
            try:
                field_data = card.field_data or {}
                card_updated = False
                
                for img_field in image_field_names:
                    current_value = field_data.get(img_field, '')
                    
                    # Determine what to match against
                    match_key = None
                    existing_path = None
                    
                    if current_value.startswith('PENDING:'):
                        # Extract reference from PENDING:reference
                        match_key = BaseService.normalize_image_identifier(current_value[8:])
                    elif current_value and current_value not in ('NOT_FOUND', ''):
                        # Has existing image - extract filename for matching
                        existing_path = current_value
                        existing_filename = os.path.splitext(os.path.basename(current_value))[0]
                        match_key = BaseService.normalize_image_identifier(existing_filename)
                    else:
                        continue
                    
                    if not match_key:
                        continue
                    
                    # Check if we have a matching image in ZIP
                    if match_key not in zip_image_index:
                        continue
                    
                    # Extract and save this specific image
                    zip_entry = zip_image_index[match_key]
                    matched_count += 1
                    
                    try:
                        batch_counter += 1
                        
                        # Extract image using the already-open ZIP handle
                        image_bytes = _extract_single_image(_open_zip, zip_entry['zip_path'])
                        if not image_bytes:
                            errors.append(f"Card {card.pk}: Failed to extract image")
                            continue
                        
                        # Validate image
                        is_valid, error_msg = validate_image_bytes(image_bytes)
                        if not is_valid:
                            errors.append(f"Card {card.pk}: Invalid image - {error_msg}")
                            continue
                        
                        # Save image using single-authority entry point
                        if existing_path:
                            result = ImageService.replace_image(
                                image_bytes=image_bytes,
                                client=client,
                                field_name=img_field,
                                existing_path=existing_path,
                                card=card,
                                batch_counter=batch_counter,
                                original_ext=zip_entry['ext'],
                            )
                        else:
                            result = ImageService.save_new_image(
                                image_bytes=image_bytes,
                                client=client,
                                field_name=img_field,
                                card=card,
                                batch_counter=batch_counter,
                                original_ext=zip_entry['ext'],
                            )
                        
                        if result.success and result.data.get('final_value'):
                            field_data[img_field] = result.data['final_value']
                            card_updated = True
                            logger.debug("Reupload: Card %s field %s updated", card.pk, img_field)
                        else:
                            errors.append(f"Card {card.pk}: Failed to save - {result.message}")
                            
                    except Exception as save_err:
                        errors.append(f"Card {card.pk}: Error - {str(save_err)}")
                
                # Queue card for bulk update instead of saving individually
                if card_updated:
                    card.field_data = field_data
                    pending_updates.append(card)
                    updated_count += 1
                
            except Exception as card_err:
                errors.append(f"Card {card.pk}: {str(card_err)}")
                logger.error("Error processing card %d: %s", card.pk, card_err)
            
            # Flush bulk updates + report progress every 50 cards
            if (idx + 1) % 50 == 0 or idx == total_cards - 1:
                if pending_updates:
                    from django.utils import timezone as _tz
                    _now = _tz.now()
                    for _c in pending_updates:
                        _c.updated_at = _now
                    IDCard.objects.bulk_update(
                        pending_updates, ['field_data', 'updated_at'], batch_size=50
                    )
                    pending_updates = []
                task.update_progress(idx + 1)

        # Build result
        result_msg = f"Updated {updated_count} cards with {matched_count} images matched"

        # Store results in metadata
        task.metadata['result'] = {
            'updated_count': updated_count,
            'matched_count': matched_count,
            'zip_images_count': len(zip_image_index),
            'error_count': len(errors),
            'errors': errors[:10] if errors else []
        }
        task.save(update_fields=['metadata'])

        # Mark completed
        task.mark_completed()
        logger.info(
            "REUPLOAD_DONE task_id=%d matched=%d updated=%d zip_images=%d errors=%d",
            task.id, matched_count, updated_count, len(zip_image_index), len(errors),
        )

    except Exception as e:
        logger.exception("Reupload processing failed: %s", e)
        task.mark_failed(str(e))
    finally:
        if _open_zip is not None:
            try:
                _open_zip.close()
            except Exception:
                pass
        # Cleanup
        _cleanup_task_files(task)


def _build_zip_image_index(zip_path):
    """
    Build an index of images in a ZIP file.
    
    CRITICAL: Only stores filenames and metadata, not image content.
    
    Returns:
        dict: {normalized_key: {'zip_path': str, 'ext': str, 'original_name': str}}
    """
    from core.services.base import BaseService
    
    index = {}
    
    with zipfile.ZipFile(zip_path, 'r') as zf:
        for zip_info in zf.infolist():
            if zip_info.is_dir():
                continue
            
            # Skip very large files
            if zip_info.file_size > 20 * 1024 * 1024:  # 20MB
                continue
            
            base_name = os.path.basename(zip_info.filename)
            name_without_ext = os.path.splitext(base_name)[0]
            ext = os.path.splitext(base_name)[1].lower()
            
            if ext not in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
                continue
            
            normalized_key = BaseService.normalize_image_identifier(name_without_ext)
            if normalized_key:
                # Keep alphabetically-first if duplicate
                existing = index.get(normalized_key)
                if existing is None or base_name < existing['original_name']:
                    index[normalized_key] = {
                        'zip_path': zip_info.filename,
                        'ext': ext,
                        'original_name': base_name
                    }
    
    return index


def _extract_single_image(zf_or_path, internal_path):
    """
    Extract a single image from a ZIP file.

    Accepts an already-open ZipFile object (fast path — zero open/close overhead)
    or a path string (fallback that opens and closes the ZIP itself).

    Returns:
        bytes: Image content, or None if extraction failed
    """
    try:
        if isinstance(zf_or_path, zipfile.ZipFile):
            return zf_or_path.read(internal_path)
        with zipfile.ZipFile(zf_or_path, 'r') as zf:
            return zf.read(internal_path)
    except Exception as e:
        logger.error("Failed to extract %s: %s", internal_path, e)
        return None


def _cleanup_task_files(task):
    """Clean up temporary files."""
    from core.services.background_worker import cleanup_temp_file
    
    if task.file_path:
        cleanup_temp_file(task.file_path)
