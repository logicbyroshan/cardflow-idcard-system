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
import json
import logging
import re
import time
import zipfile
import hashlib

from django.conf import settings

logger = logging.getLogger(__name__)

_NAME_BASE_RE = re.compile(r'^(?:[ac]\d{14}|\d{14})$')
_NAME_BASE_6_RE = re.compile(r'^(?:[ac]\d{14}|\d{14})_\d{6}$')


def _db_retry(fn, max_retries=5, base_delay=1.0):
    """
    Retry a callable that does DB writes.

    Handles:
    - SQLite  : 'database is locked' (single-writer contention)
    - PostgreSQL: stale / dropped connections
        - InterfaceError  ('connection already closed')
        - OperationalError('server closed the connection unexpectedly')
    - PostgreSQL transient write conflicts
        - deadlock detected (40P01)
        - serialization failure (40001)
        - lock not available / lock timeout (55P03)

    On a connection-level error we call close_old_connections() so Django
    opens a fresh connection on the next attempt.
    """
    from django.db.utils import OperationalError, InterfaceError
    last_err = None
    for attempt in range(max_retries):
        try:
            return fn()
        except (OperationalError, InterfaceError) as e:
            err_str = str(e).lower()
            is_lock = 'database is locked' in err_str
            pg_code = (
                getattr(e, 'pgcode', None)
                or getattr(getattr(e, '__cause__', None), 'pgcode', None)
            )
            is_pg_transient = pg_code in {'40001', '40P01', '55P03'}
            is_pg_lock_text = (
                'deadlock detected' in err_str
                or 'could not serialize access' in err_str
                or 'lock timeout' in err_str
                or 'could not obtain lock on row' in err_str
                or 'lock not available' in err_str
            )
            is_conn = (
                isinstance(e, InterfaceError)
                or 'server closed the connection' in err_str
                or 'connection already closed' in err_str
                or 'could not connect to server' in err_str
                or 'ssl connection has been closed' in err_str
            )
            if not (is_lock or is_conn or is_pg_transient or is_pg_lock_text):
                raise  # not a transient issue — propagate immediately
            last_err = e
            delay = base_delay * (2 ** attempt)  # 1, 2, 4, 8, 16 s
            logger.warning(
                "DB transient error (attempt %d/%d), retrying in %.1fs: %s",
                attempt + 1, max_retries, delay, e,
            )
            if is_conn or is_pg_transient:
                try:
                    from django.db import close_old_connections
                    close_old_connections()
                except Exception:
                    pass
            time.sleep(delay)
    # All retries exhausted
    raise last_err


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
    strict_mode = bool(metadata.get('strict_mode', True))
    task_user = getattr(task, 'user', None)
    
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
    
    _db_retry(lambda: task.update_progress(0, total_cards))
    _open_zip = None  # Kept open for entire card loop; closed in finally

    try:
        # First, build index of available images in ZIP (just names, not content)
        # This is memory efficient - only stores filenames
        try:
            zip_image_index, manifest_index, zip_stats = _build_zip_image_index(zip_path)
            logger.info("ZIP index built: %d images found", len(zip_image_index))
        except Exception as e:
            logger.exception("Failed to read ZIP for reupload task_id=%s", task.id)
            task.mark_failed("Failed to read ZIP file. Please verify the ZIP and try again.")
            return

        if strict_mode and not zip_stats.get('manifest_present'):
            task.mark_failed(
                "Strict reupload requires _reupload_manifest.json in ZIP. "
                "Please download a fresh ZIP from panel and reupload that edited ZIP."
            )
            return

        if strict_mode and zip_stats.get('manifest_duplicate_keys', 0) > 0:
            task.mark_failed(
                f"Strict reupload blocked: manifest has {zip_stats.get('manifest_duplicate_keys')} duplicate card/field mappings."
            )
            return

        if strict_mode and zip_stats.get('manifest_missing_paths', 0) > 0:
            task.mark_failed(
                f"Strict reupload blocked: manifest references {zip_stats.get('manifest_missing_paths')} files that are missing in ZIP."
            )
            return

        preflight = _run_reupload_preflight(
            cards_qs=cards_qs,
            image_field_names=image_field_names,
            zip_image_index=zip_image_index,
            manifest_index=manifest_index,
            strict_mode=strict_mode,
            manifest_present=zip_stats.get('manifest_present', False),
        )

        metadata['preflight'] = preflight
        task.metadata = metadata
        _db_retry(lambda: task.save(update_fields=['metadata']))

        if strict_mode and preflight.get('ambiguous_matches', 0) > 0:
            task.mark_failed(
                f"Strict reupload blocked: {preflight.get('ambiguous_matches')} ambiguous matches detected in preflight."
            )
            return

        if not zip_image_index:
            task.mark_failed("No valid images found in ZIP file")
            return

        # Open the ZIP once for the entire card loop.
        # Avoids reopening (and re-reading the central directory) for every
        # single image — was N open/close calls, now exactly 1.
        _open_zip = zipfile.ZipFile(zip_path, 'r')
        zip_name_set = set(_open_zip.namelist())

        # Process cards one at a time
        updated_count = 0
        matched_count = 0
        unchanged_count = 0
        errors = []
        batch_counter = 0
        pending_updates = []  # Accumulated cards for bulk_update; flushed every FLUSH_EVERY
        pending_media_deletes = []  # (card_pk, field_name) tuples for batch CardMedia cleanup
        pending_media_creates = []  # kwargs dicts for batch CardMedia creation
        pending_storage_deletes = []  # old paths to delete only AFTER DB commit
        FLUSH_EVERY = 100  # larger batches → fewer DB writes → less lock contention

        for idx, card in enumerate(cards_qs.iterator(chunk_size=200)):
            try:
                field_data = card.field_data or {}
                card_updated = False
                
                for img_field in image_field_names:
                    manifest_meta = manifest_index.get((card.pk, img_field)) if manifest_index else None
                    manifest_entry = None
                    if manifest_meta:
                        path_key = str(manifest_meta.get('zip_path') or '').replace('\\', '/')
                        if path_key in zip_name_set:
                            base_name = os.path.basename(path_key)
                            ext = os.path.splitext(base_name)[1].lower()
                            manifest_entry = {
                                'zip_path': path_key,
                                'ext': ext,
                                'original_name': base_name,
                                'sha256': manifest_meta.get('sha256'),
                                'size': manifest_meta.get('size'),
                            }

                    current_value = field_data.get(img_field) or ''
                    
                    # ── Determine what to match against ──────────────────
                    # We try up to THREE strategies in priority order so
                    # that both old cards (no __ref_) and new cards match.
                    match_key = None
                    existing_path = None
                    
                    if current_value.startswith('PENDING:'):
                        # Strategy 1: PENDING:reference  (always works)
                        match_key = BaseService.normalize_image_identifier(current_value[8:])
                    elif current_value and current_value not in ('NOT_FOUND', ''):
                        # Has existing saved image
                        existing_path = current_value
                        # Strategy 2: stored original reference (added by bulk upload)
                        ref_key = f'__ref_{img_field}'
                        original_ref = field_data.get(ref_key, '')
                        if original_ref:
                            match_key = BaseService.normalize_image_identifier(original_ref)
                        else:
                            # Strategy 3 (fallback): auto-generated filename
                            # Works only when user names ZIP files to match the
                            # saved filenames (rare, but keeps backward compat).
                            existing_filename = os.path.splitext(
                                os.path.basename(current_value)
                            )[0]
                            match_key = BaseService.normalize_image_identifier(existing_filename)
                    else:
                        continue
                    
                    if not match_key and not manifest_entry:
                        continue

                    # Prefer deterministic manifest mapping when available.
                    zip_entry = manifest_entry
                    if not zip_entry:
                        if strict_mode and zip_stats.get('manifest_present'):
                            continue
                        # Fallback: legacy basename matching.
                        if match_key not in zip_image_index:
                            continue
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

                        image_sha = hashlib.sha256(image_bytes).hexdigest()
                        if strict_mode and manifest_entry and manifest_entry.get('sha256'):
                            if str(manifest_entry.get('sha256')).lower() != image_sha.lower():
                                errors.append(f"Card {card.pk}: Manifest hash mismatch for {img_field}")
                                continue

                        if strict_mode and existing_path:
                            existing_sha = _compute_storage_sha256(existing_path)
                            if existing_sha and existing_sha.lower() == image_sha.lower():
                                unchanged_count += 1
                                continue
                        
                        # Save image FILE to disk (no DB writes yet)
                        # Pass card=None so replace_image/save_new_image
                        # skip the per-card CardMedia atomic() block.
                        if existing_path:
                            result = ImageService.replace_image(
                                image_bytes=image_bytes,
                                client=client,
                                field_name=img_field,
                                existing_path=existing_path,
                                card=None,  # defer CardMedia to batch
                                batch_counter=batch_counter,
                                original_ext=zip_entry['ext'],
                                uploaded_by=task_user,
                            )
                        else:
                            result = ImageService.save_new_image(
                                image_bytes=image_bytes,
                                client=client,
                                field_name=img_field,
                                card=None,  # defer CardMedia to batch
                                batch_counter=batch_counter,
                                original_ext=zip_entry['ext'],
                                uploaded_by=task_user,
                            )
                        
                        if result.success and result.data.get('final_value'):
                            saved_path = result.data['final_value']

                            if strict_mode:
                                expected_mode = 'update' if existing_path else 'new'
                                if not _is_valid_system_filename(saved_path, expected_mode):
                                    try:
                                        ImageService.delete_image(saved_path)
                                    except Exception:
                                        pass
                                    errors.append(
                                        f"Card {card.pk}: Generated filename violates policy ({os.path.basename(saved_path)})"
                                    )
                                    continue

                            field_data[img_field] = saved_path
                            # Preserve original reference for future reuploads
                            # (the ZIP entry's original name without extension)
                            ref_key = f'__ref_{img_field}'
                            if not field_data.get(ref_key):
                                field_data[ref_key] = zip_entry.get('original_name', '').rsplit('.', 1)[0] or match_key
                            card_updated = True
                            # Queue CardMedia ops for batch flush
                            if existing_path:
                                pending_media_deletes.append((card.pk, img_field))
                                old_path = result.data.get('old_path_to_delete')
                                if old_path and old_path != saved_path:
                                    pending_storage_deletes.append(old_path)
                            pending_media_creates.append({
                                'card': card,
                                'client': client,
                                'saved_path': saved_path,
                                'field_name': img_field,
                            })
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
            
            # Flush bulk updates + CardMedia + progress every FLUSH_EVERY cards
            if (idx + 1) % FLUSH_EVERY == 0 or idx == total_cards - 1:
                _flush_batch(
                    pending_updates, pending_media_deletes,
                    pending_media_creates, pending_storage_deletes,
                    IDCard, ImageService, client,
                )
                pending_updates = []
                pending_media_deletes = []
                pending_media_creates = []
                pending_storage_deletes = []
                _db_retry(lambda _idx=idx: task.update_progress(_idx + 1))

        # Safety flush: if the iterator returned fewer rows than total_cards
        # (e.g. cards deleted mid-iteration), the in-loop condition
        # `idx == total_cards - 1` never fires and the last batch is lost.
        if pending_updates or pending_media_creates:
            _flush_batch(
                pending_updates, pending_media_deletes,
                pending_media_creates, pending_storage_deletes,
                IDCard, ImageService, client,
            )
            pending_updates = []
            pending_media_deletes = []
            pending_media_creates = []
            pending_storage_deletes = []

        # Build result
        result_msg = f"Updated {updated_count} cards with {matched_count} images matched"

        # Store results in metadata (with retry)
        task.metadata['result'] = {
            'updated_count': updated_count,
            'matched_count': matched_count,
            'unchanged_count': unchanged_count,
            'zip_images_count': len(zip_image_index),
            'strict_mode': strict_mode,
            'manifest_present': zip_stats.get('manifest_present', False),
            'preflight': preflight,
            'error_count': len(errors),
            'errors': errors[:10] if errors else []
        }
        _db_retry(lambda: task.save(update_fields=['metadata']))

        # Mark completed (with retry)
        _db_retry(lambda: task.mark_completed())
        logger.info(
            "REUPLOAD_DONE task_id=%d matched=%d updated=%d unchanged=%d zip_images=%d errors=%d",
            task.id, matched_count, updated_count, unchanged_count, len(zip_image_index), len(errors),
        )

    except Exception as e:
        logger.exception("Reupload processing failed: %s", e)
        try:
            _db_retry(lambda: task.mark_failed("Reupload processing failed due to an internal error."))
        except Exception:
            logger.error("Could not mark task %d as failed (DB still locked)", task.id)
    finally:
        if _open_zip is not None:
            try:
                _open_zip.close()
            except Exception:
                pass
        # Cleanup
        _cleanup_task_files(task)


def _flush_batch(
    pending_updates,
    pending_media_deletes,
    pending_media_creates,
    pending_storage_deletes,
    IDCard,
    ImageService,
    client,
):
    """
    Flush accumulated DB writes in a single retried transaction.

    Groups IDCard bulk_update + CardMedia delete/create into one write.
    Old image file deletion is deferred until after DB commit succeeds.
    """
    if not pending_updates and not pending_media_creates:
        return

    def _do_flush():
        from django.db import transaction
        from django.utils import timezone as _tz
        from mediafiles.models import CardMedia

        with transaction.atomic():
            # 1. Bulk-update IDCard field_data
            if pending_updates:
                _now = _tz.now()
                for _c in pending_updates:
                    _c.updated_at = _now
                IDCard.objects.bulk_update(
                    pending_updates, ['field_data', 'updated_at'], batch_size=100
                )

            # 2. Batch-delete old CardMedia
            if pending_media_deletes:
                from django.db.models import Q
                q = Q()
                for card_pk, field_name in pending_media_deletes:
                    q |= Q(card_id=card_pk, field_name=field_name)
                CardMedia.objects.filter(q).delete()

            # 3. Batch-create new CardMedia
            if pending_media_creates:
                objs = []
                for item in pending_media_creates:
                    objs.append(CardMedia(
                        card=item['card'],
                        client=item['client'],
                        file=item['saved_path'],
                        media_type='photo',
                        field_name=item['field_name'],
                    ))
                CardMedia.objects.bulk_create(objs, batch_size=100)

    try:
        _db_retry(_do_flush)
    except Exception:
        # DB failed: rollback saved files from this batch so paths don't drift.
        rollback_paths = {
            item.get('saved_path')
            for item in pending_media_creates
            if item.get('saved_path')
        }
        for saved_path in rollback_paths:
            try:
                ImageService.delete_image(saved_path)
            except Exception as cleanup_err:
                logger.warning(
                    "Reupload rollback cleanup failed for new file %s: %s",
                    saved_path,
                    cleanup_err,
                )
        raise

    # DB commit succeeded: now it is safe to remove old replaced files.
    if pending_storage_deletes:
        from mediafiles.models import CardMedia

        for old_path in set(pending_storage_deletes):
            if not old_path:
                continue
            try:
                # If any row still references this file, do not delete it.
                if CardMedia.objects.filter(file=old_path).exists():
                    continue
                ImageService.delete_image(old_path)
            except Exception as delete_err:
                logger.warning(
                    "Deferred old-image delete failed for %s: %s",
                    old_path,
                    delete_err,
                )


def _build_zip_image_index(zip_path):
    """
    Build an index of images in a ZIP file.
    
        CRITICAL: Only stores filenames and metadata, not image content.

        Returns:
                tuple:
                    - dict: {normalized_key: {'zip_path': str, 'ext': str, 'original_name': str}}
                    - dict: {(card_id, field_name): {'zip_path': str, 'sha256': str, 'size': int}}
                        from optional _reupload_manifest.json
                    - dict: zip_stats
    """
    from core.services.base import BaseService
    
    index = {}
    manifest_index = {}
    duplicate_name_keys = 0
    manifest_duplicate_keys = 0
    manifest_missing_paths = 0
    manifest_present = False
    
    with zipfile.ZipFile(zip_path, 'r') as zf:
        # Optional deterministic mapping generated by exporter.
        if '_reupload_manifest.json' in zf.namelist():
            manifest_present = True
            try:
                raw_manifest = zf.read('_reupload_manifest.json')
                parsed_manifest = json.loads(raw_manifest.decode('utf-8'))
                for item in parsed_manifest.get('entries', []):
                    card_id = item.get('card_id')
                    field_name = item.get('field_name')
                    zip_entry_path = str(item.get('zip_path') or '').replace('\\', '/')
                    if card_id and field_name and zip_entry_path:
                        mk = (int(card_id), str(field_name))
                        if mk in manifest_index:
                            manifest_duplicate_keys += 1
                            continue
                        if zip_entry_path not in zf.namelist():
                            manifest_missing_paths += 1
                            continue
                        manifest_index[mk] = {
                            'zip_path': zip_entry_path,
                            'sha256': item.get('sha256'),
                            'size': item.get('size'),
                        }
            except Exception:
                logger.warning("Invalid _reupload_manifest.json ignored in ZIP: %s", zip_path)

        for zip_info in zf.infolist():
            if zip_info.is_dir():
                continue

            if zip_info.filename == '_reupload_manifest.json':
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
                if existing is not None:
                    duplicate_name_keys += 1

    zip_stats = {
        'manifest_present': manifest_present,
        'manifest_entries': len(manifest_index),
        'manifest_duplicate_keys': manifest_duplicate_keys,
        'manifest_missing_paths': manifest_missing_paths,
        'duplicate_name_keys': duplicate_name_keys,
    }

    return index, manifest_index, zip_stats


def _is_valid_system_filename(path_or_name, mode='new'):
    """
    Validate filename stem against system policy.

    new     -> [a|c]+14 digits OR legacy 14 digits
    update  -> base + underscore + 6 digits
    """
    base_name = os.path.basename(str(path_or_name or '').strip())
    stem, _ = os.path.splitext(base_name)
    if mode == 'new':
        return bool(_NAME_BASE_RE.match(stem))
    if mode == 'update':
        return bool(_NAME_BASE_6_RE.match(stem))
    return bool(_NAME_BASE_RE.match(stem) or _NAME_BASE_6_RE.match(stem))


def _run_reupload_preflight(
    cards_qs,
    image_field_names,
    zip_image_index,
    manifest_index,
    strict_mode,
    manifest_present,
):
    """Compute match diagnostics before any writes occur."""
    from core.services.base import BaseService

    expected_targets = 0
    matched_targets = 0
    missing_targets = 0
    ambiguous_matches = 0
    missing_samples = []

    for card in cards_qs.iterator(chunk_size=500):
        field_data = card.field_data or {}
        for img_field in image_field_names:
            current_value = field_data.get(img_field) or ''
            match_key = None

            if current_value.startswith('PENDING:'):
                match_key = BaseService.normalize_image_identifier(current_value[8:])
            elif current_value and current_value not in ('NOT_FOUND', ''):
                ref_key = f'__ref_{img_field}'
                original_ref = field_data.get(ref_key, '')
                if original_ref:
                    match_key = BaseService.normalize_image_identifier(original_ref)
                else:
                    existing_filename = os.path.splitext(os.path.basename(current_value))[0]
                    match_key = BaseService.normalize_image_identifier(existing_filename)
            else:
                continue

            expected_targets += 1
            has_manifest_hit = bool(manifest_index.get((card.pk, img_field))) if manifest_present else False
            has_fallback_hit = bool(match_key and match_key in zip_image_index)

            if has_manifest_hit or (not manifest_present and has_fallback_hit):
                matched_targets += 1
            else:
                missing_targets += 1
                if len(missing_samples) < 20:
                    missing_samples.append({'card_id': card.pk, 'field_name': img_field})

            if strict_mode and manifest_present and has_fallback_hit and not has_manifest_hit:
                ambiguous_matches += 1

    return {
        'expected_targets': expected_targets,
        'matched_targets': matched_targets,
        'missing_targets': missing_targets,
        'ambiguous_matches': ambiguous_matches,
        'missing_samples': missing_samples,
        'manifest_present': manifest_present,
        'strict_mode': bool(strict_mode),
    }


def _compute_storage_sha256(storage_path):
    """Hash an existing stored file; returns None when unavailable."""
    if not storage_path:
        return None
    try:
        from django.core.files.storage import default_storage
        if not default_storage.exists(storage_path):
            return None
        h = hashlib.sha256()
        with default_storage.open(storage_path, 'rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


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
