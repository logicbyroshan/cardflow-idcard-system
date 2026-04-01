"""
Background Task API Views

Endpoints for managing background tasks:
- Create tasks for bulk operations
- Check task status and progress
- Download task results
- Cancel pending tasks

CRITICAL FEATURES:
- Block multiple concurrent heavy tasks per user
- Progress tracking with polling support
- Safe file download with cleanup

ARCHITECTURE RULES (enforced):
- Views are ULTRA-THIN: parse request → call service → return JsonResponse.
- NO .save(), .delete() on BackgroundTask in views.
- Task cancellation delegates to background_worker.cancel_task().
"""
import os
import json
import logging

from django.core.cache import cache as django_cache
from django.http import JsonResponse, FileResponse
from django.views.decorators.http import require_POST, require_GET
from django.shortcuts import get_object_or_404
from django.conf import settings

from core.models import BackgroundTask
from idcards.models import IDCardTable
from core.utils.upload_security import validate_zip_safety
from core.services.permission_service import (
    PermissionService,
    api_require_any_authenticated,
    api_require_permission,
)
from core.services.background_worker import (
    background_worker,
    save_uploaded_file_to_disk,
    cleanup_temp_file,
)
from accounts.rate_limit import rate_limit

logger = logging.getLogger(__name__)

# ==================== UPLOAD VALIDATION CONSTANTS ====================

# Maximum allowed file sizes (bytes)
MAX_XLSX_SIZE = 50 * 1024 * 1024         # 50 MB for spreadsheets
MAX_ZIP_SIZE = 950 * 1024 * 1024          # 950 MB for ZIP archives (buffer below 1 GB nginx limit)

# Allowed file extensions
ALLOWED_ZIP_EXTENSIONS = ('.zip',)


def _normalize_positive_int_ids(raw_ids, *, max_items=5000):
    """Normalize arbitrary payload values into unique positive integer IDs."""
    if not isinstance(raw_ids, (list, tuple)):
        return []
    normalized = []
    seen = set()
    for item in raw_ids:
        if isinstance(item, bool):
            continue
        try:
            val = int(str(item).strip())
        except (TypeError, ValueError):
            continue
        if val <= 0 or val in seen:
            continue
        seen.add(val)
        normalized.append(val)
        if len(normalized) >= max_items:
            break
    return normalized


def _is_path_within_root(full_path, root_dir):
    """Return True only when full_path is contained within root_dir."""
    try:
        full = os.path.realpath(full_path)
        root = os.path.realpath(str(root_dir))
        return os.path.commonpath([full, root]) == root
    except Exception:
        return False


def _validate_uploaded_file(uploaded_file, allowed_extensions, max_size, label='File'):
    """
    Validate an uploaded file's extension, content-type, and size.
    Returns (ok: bool, error_message: str|None).
    """
    name = uploaded_file.name.lower()
    ext_ok = any(name.endswith(ext) for ext in allowed_extensions)
    if not ext_ok:
        return False, f'{label}: Invalid file type. Allowed: {", ".join(allowed_extensions)}'
    if uploaded_file.size > max_size:
        max_mb = max_size / (1024 * 1024)
        actual_mb = uploaded_file.size / (1024 * 1024)
        return False, f'{label}: File too large ({actual_mb:.1f} MB). Maximum: {max_mb:.0f} MB'
    return True, None


def _parse_reupload_scope_payload(request):
    """Parse reupload scope payload from request.POST in a safe, normalized form."""
    target_field = str(request.POST.get('target_field', '') or '').strip()

    card_ids = []
    if 'card_ids' in request.POST:
        try:
            raw_ids = json.loads(request.POST.get('card_ids', '[]'))
        except (json.JSONDecodeError, TypeError):
            raw_ids = []
        card_ids = _normalize_positive_int_ids(raw_ids, max_items=10000)

    status_filter = str(request.POST.get('status', '') or '').strip()

    return {
        'target_field': target_field,
        'card_ids': card_ids,
        'status_filter': status_filter,
    }


def _acquire_task_lock(user_id, task_type, ttl=10):
    """
    Acquire a short-lived cache lock to prevent double-click duplicate tasks.
    Returns True if lock acquired, False if a request is already in flight.
    """
    lock_key = f'task_lock:{user_id}:{task_type}'
    # add() returns True only if the key doesn't exist yet
    return django_cache.add(lock_key, 1, ttl)


def _release_task_lock(user_id, task_type):
    """Release the double-click lock after task creation completes/fails."""
    lock_key = f'task_lock:{user_id}:{task_type}'
    django_cache.delete(lock_key)


# ==================== TASK STATUS API ====================

@require_GET
@api_require_any_authenticated
def api_task_status(request, task_id):
    """
    Get status and progress of a background task.
    
    Endpoint: GET /api/task-status/<task_id>/
    
    Returns:
        {
            "success": true,
            "task_id": 123,
            "task_type": "bulk_upload",
            "status": "processing",
            "progress": 1200,
            "total": 3000,
            "progress_percentage": 40,
            "created_at": "2026-02-13T10:00:00Z",
            "started_at": "2026-02-13T10:00:05Z",
            "completed_at": null,
            "result": {...},  // Only when completed
            "error_message": null
        }
    """
    # ── Prevent session write on every poll (SESSION_SAVE_EVERY_REQUEST). ──
    # This is a read-only endpoint called every 2 s.  With SQLite the
    # session-save write competes with the background worker’s writes,
    # causing "database is locked" when processing large reuploads.
    request.session.modified = False

    try:
        # Users can only see their own tasks (super_admin can see all)
        if PermissionService.is_super_admin(request.user):
            task = get_object_or_404(BackgroundTask, id=task_id)
        else:
            task = get_object_or_404(BackgroundTask, id=task_id, user=request.user)
        
        response_data = {
            'success': True,
            'task_id': task.id,
            'task_type': task.task_type,
            'task_type_display': task.get_task_type_display(),
            'status': task.status,
            'status_display': task.get_status_display(),
            'progress': task.progress,
            'total': task.total,
            'progress_percentage': task.progress_percentage,
            'created_at': task.created_at.isoformat() if task.created_at else None,
            'started_at': task.started_at.isoformat() if task.started_at else None,
            'completed_at': task.completed_at.isoformat() if task.completed_at else None,
            'error_message': task.error_message,
        }
        
        # Include result data if completed
        if task.status == 'completed':
            response_data['result'] = task.metadata.get('result', {})
            if task.result_path:
                response_data['download_url'] = f'/api/task-download/{task.id}/'
        
        return JsonResponse(response_data)
        
    except Exception as e:
        logger.exception("Error getting task status: %s", e)
        return JsonResponse({
            'success': False,
            'message': 'Error retrieving task status'
        }, status=400)


@require_GET
@api_require_any_authenticated
def api_task_download(request, task_id):
    """
    Download result file from a completed task.
    
    Endpoint: GET /api/task-download/<task_id>/
    
    Returns:
        FileResponse with the result file
    """
    try:
        # Users can only download their own tasks
        if PermissionService.is_super_admin(request.user):
            task = get_object_or_404(BackgroundTask, id=task_id)
        else:
            task = get_object_or_404(BackgroundTask, id=task_id, user=request.user)
        
        if task.status != 'completed':
            return JsonResponse({
                'success': False,
                'message': 'Task is not completed yet'
            }, status=400)
        
        if not task.result_path:
            return JsonResponse({
                'success': False,
                'message': 'No result file available'
            }, status=404)
        
        # Get full path with traversal guard
        full_path = os.path.realpath(os.path.join(settings.MEDIA_ROOT, task.result_path))
        if not _is_path_within_root(full_path, settings.MEDIA_ROOT):
            return JsonResponse({
                'success': False,
                'message': 'Invalid file path'
            }, status=400)
        
        if not os.path.exists(full_path):
            return JsonResponse({
                'success': False,
                'message': 'Result file not found'
            }, status=404)
        
        # Determine filename from metadata or path
        result_data = task.metadata.get('result', {})
        filename = result_data.get('filename', os.path.basename(full_path))
        filename = os.path.basename(str(filename or '')).replace('\r', '').replace('\n', '')
        if not filename:
            filename = os.path.basename(full_path)
        
        # Return file response
        response = FileResponse(
            open(full_path, 'rb'),
            as_attachment=True,
            filename=filename
        )
        
        return response
        
    except Exception as e:
        logger.exception("Error downloading task result: %s", e)
        return JsonResponse({
            'success': False,
            'message': 'Error downloading file'
        }, status=400)


@require_POST
@api_require_any_authenticated
def api_task_cancel(request, task_id):
    """
    Cancel a pending or processing task.
    
    Endpoint: POST /api/task-cancel/<task_id>/
    
    Note: Tasks already being processed may not stop immediately,
    but their status will be marked as cancelled.
    """
    try:
        from ..services.background_worker import cancel_task
        result = cancel_task(task_id, user=request.user)

        if result['success']:
            return JsonResponse({'success': True, 'message': result['message']})
        return JsonResponse({'success': False, 'message': result['message']}, status=400)
        
    except Exception as e:
        logger.exception("Error cancelling task: %s", e)
        return JsonResponse({
            'success': False,
            'message': 'Error cancelling task'
        }, status=400)


@require_GET
@api_require_any_authenticated
def api_task_list(request):
    """
    List user's background tasks.
    
    Endpoint: GET /api/tasks/
    
    Query params:
        - status: Filter by status (pending, processing, completed, failed, cancelled)
        - type: Filter by task type
        - limit: Max results (default 20)
    """
    try:
        # Get user's tasks
        if PermissionService.is_super_admin(request.user):
            tasks_qs = BackgroundTask.objects.select_related('user').all()
        else:
            tasks_qs = BackgroundTask.objects.filter(user=request.user)
        
        # Apply filters
        status_filter = request.GET.get('status')
        if status_filter:
            tasks_qs = tasks_qs.filter(status=status_filter)
        
        type_filter = request.GET.get('type')
        if type_filter:
            tasks_qs = tasks_qs.filter(task_type=type_filter)
        
        # Limit results
        try:
            limit = int(request.GET.get('limit', 20))
            limit = min(max(limit, 1), 100)
        except ValueError:
            limit = 20
        
        tasks_qs = tasks_qs.order_by('-created_at')[:limit]
        
        tasks_data = []
        for task in tasks_qs:
            tasks_data.append({
                'task_id': task.id,
                'task_type': task.task_type,
                'task_type_display': task.get_task_type_display(),
                'status': task.status,
                'status_display': task.get_status_display(),
                'progress': task.progress,
                'total': task.total,
                'progress_percentage': task.progress_percentage,
                'created_at': task.created_at.isoformat() if task.created_at else None,
                'completed_at': task.completed_at.isoformat() if task.completed_at else None,
                'has_result': bool(task.result_path),
            })
        
        return JsonResponse({
            'success': True,
            'tasks': tasks_data
        })
        
    except Exception as e:
        logger.exception("Error listing tasks: %s", e)
        return JsonResponse({
            'success': False,
            'message': 'Error listing tasks'
        }, status=400)


@require_GET
@api_require_any_authenticated
def api_task_active(request):
    """
    Check if user has any active (pending/processing) tasks.
    
    Endpoint: GET /api/task-active/
    
    Returns:
        {
            "success": true,
            "has_active": true/false,
            "active_task": {...} or null
        }
    
    Use this to block new heavy operations if one is already running.
    """
    try:
        active_task = BackgroundTask.has_active_task(request.user)
        
        if active_task:
            return JsonResponse({
                'success': True,
                'has_active': True,
                'active_task': {
                    'task_id': active_task.id,
                    'task_type': active_task.task_type,
                    'task_type_display': active_task.get_task_type_display(),
                    'status': active_task.status,
                    'progress': active_task.progress,
                    'total': active_task.total,
                    'progress_percentage': active_task.progress_percentage,
                }
            })
        else:
            return JsonResponse({
                'success': True,
                'has_active': False,
                'active_task': None
            })
        
    except Exception as e:
        logger.exception("Error checking active tasks: %s", e)
        return JsonResponse({
            'success': False,
            'message': 'Error checking tasks'
        }, status=400)


# ==================== BULK UPLOAD TASK CREATION ====================

@require_POST
@rate_limit(max_requests=5, window_seconds=60, key_prefix='bulk_upload')
@api_require_permission('perm_idcard_bulk_upload')
def api_create_bulk_upload_task(request, table_id):
    """
    Create a background task for bulk upload.
    
    Endpoint: POST /api/table/<table_id>/bulk-upload-task/
    
    CRITICAL:
    - Saves uploaded files to disk immediately
    - Creates BackgroundTask record
    - Submits to background worker
    - Returns task_id for progress polling
    
    Request:
        - file: XLSX/CSV file (required)
        - photos_zip_<FIELDNAME>: ZIP files for specific image fields (optional)
        - unified_zip_<N>: Unified ZIP files for all image fields (optional)
        - unified_zip_count: Number of unified ZIPs (optional)
        - zip_field_names: JSON array of field names with ZIP uploads (optional)
    
    Returns:
        {
            "success": true,
            "task_id": 123,
            "message": "Bulk upload task created. Check progress at /api/task-status/123/"
        }
    """
    from core.views.idcard_api import _check_client_scope_by_table
    
    # Check client scope
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err:
        return err
    
    # Double-click guard
    if not _acquire_task_lock(request.user.id, 'bulk_upload'):
        return JsonResponse({'success': False, 'message': 'Request already in progress. Please wait.'}, status=429)
    
    try:
        # Validate table exists
        table = get_object_or_404(IDCardTable, id=table_id)
        
        # Check for required file
        if 'file' not in request.FILES:
            return JsonResponse({
                'success': False,
                'message': 'No file uploaded'
            }, status=400)
        
        uploaded_file = request.FILES['file']
        
        # Validate spreadsheet file
        ok, err_msg = _validate_uploaded_file(
            uploaded_file,
            allowed_extensions=('.xlsx', '.xls', '.csv'),
            max_size=MAX_XLSX_SIZE,
            label='Spreadsheet',
        )
        if not ok:
            return JsonResponse({'success': False, 'message': err_msg}, status=400)
        
        # Save main file to disk
        main_file_path = save_uploaded_file_to_disk(uploaded_file)
        
        # Process ZIP files
        zip_paths = {}  # {field_name: relative_path}
        unified_zip_paths = []  # [relative_path, ...]
        
        # Field-specific ZIPs
        zip_field_names_str = request.POST.get('zip_field_names', '[]')
        try:
            zip_field_names = json.loads(zip_field_names_str)
        except (json.JSONDecodeError, TypeError):
            zip_field_names = []
        
        for field_name in zip_field_names:
            zip_key = f'photos_zip_{field_name}'
            if zip_key in request.FILES:
                zip_file = request.FILES[zip_key]
                ok, err_msg = _validate_uploaded_file(zip_file, ('.zip',), MAX_ZIP_SIZE, f'ZIP ({field_name})')
                if not ok:
                    return JsonResponse({'success': False, 'message': err_msg}, status=400)
                zip_path = save_uploaded_file_to_disk(zip_file)
                # ZIP bomb/safety check
                zok, zerr = validate_zip_safety(os.path.join(settings.MEDIA_ROOT, zip_path))
                if not zok:
                    return JsonResponse({'success': False, 'message': zerr}, status=400)
                zip_paths[field_name] = zip_path
        
        # Legacy: single photos_zip
        if not zip_paths and 'photos_zip' in request.FILES:
            legacy_zip = request.FILES['photos_zip']
            ok, err_msg = _validate_uploaded_file(legacy_zip, ('.zip',), MAX_ZIP_SIZE, 'ZIP')
            if not ok:
                return JsonResponse({'success': False, 'message': err_msg}, status=400)
            from core.services.base import BaseService
            image_field_names = BaseService.get_image_field_names(table.fields)
            first_field = image_field_names[0] if image_field_names else 'PHOTO'
            zip_path = save_uploaded_file_to_disk(legacy_zip)
            # ZIP bomb/safety check
            zok, zerr = validate_zip_safety(os.path.join(settings.MEDIA_ROOT, zip_path))
            if not zok:
                return JsonResponse({'success': False, 'message': zerr}, status=400)
            zip_paths[first_field] = zip_path
        
        # Unified ZIPs
        try:
            unified_zip_count = int(request.POST.get('unified_zip_count', 0))
            unified_zip_count = min(unified_zip_count, 20)  # Cap at 20
        except (ValueError, TypeError):
            unified_zip_count = 0
        
        for i in range(unified_zip_count):
            zip_key = f'unified_zip_{i}'
            if zip_key in request.FILES:
                uz_file = request.FILES[zip_key]
                ok, err_msg = _validate_uploaded_file(uz_file, ('.zip',), MAX_ZIP_SIZE, f'Unified ZIP #{i+1}')
                if not ok:
                    return JsonResponse({'success': False, 'message': err_msg}, status=400)
                zip_path = save_uploaded_file_to_disk(uz_file)
                # ZIP bomb/safety check
                zok, zerr = validate_zip_safety(os.path.join(settings.MEDIA_ROOT, zip_path))
                if not zok:
                    return JsonResponse({'success': False, 'message': zerr}, status=400)
                unified_zip_paths.append(zip_path)
        
        # Create BackgroundTask atomically (prevents race conditions)
        task, error_msg = BackgroundTask.create_if_no_active(
            user=request.user,
            task_type='bulk_upload',
            file_path=main_file_path,
            metadata={
                'table_id': table_id,
                'zip_paths': zip_paths,
                'unified_zip_paths': unified_zip_paths,
                'original_filename': uploaded_file.name,
            }
        )
        
        if not task:
            # Cleanup uploaded files since task creation failed
            from core.services.background_worker import cleanup_temp_file
            cleanup_temp_file(main_file_path)
            for zp in zip_paths.values():
                cleanup_temp_file(zp)
            for zp in unified_zip_paths:
                cleanup_temp_file(zp)
            
            return JsonResponse({
                'success': False,
                'message': error_msg
            }, status=429)
        
        # Submit to background worker
        background_worker.submit_task(task.id)
        
        return JsonResponse({
            'success': True,
            'task_id': task.id,
            'message': f'Bulk upload task created. Check progress at /api/task-status/{task.id}/'
        })
        
    except Exception as e:
        logger.exception("Error creating bulk upload task: %s", e)
        return JsonResponse({
            'success': False,
            'message': 'Error creating upload task'
        }, status=400)
    finally:
        _release_task_lock(request.user.id, 'bulk_upload')


# ==================== REUPLOAD IMAGES TASK CREATION ====================

@require_POST
@rate_limit(max_requests=5, window_seconds=60, key_prefix='reupload')
@api_require_permission('perm_idcard_bulk_reupload')
def api_create_reupload_task(request, table_id):
    """
    Create a background task for image reupload.
    
    Endpoint: POST /api/table/<table_id>/reupload-task/
    
    Request:
        - photos_zip: ZIP file with images (required)
        - target_field: Target image field name (optional)
        - card_ids: JSON array of card IDs to limit scope (optional)
        - status: Status filter (optional)
    
    Returns:
        {
            "success": true,
            "task_id": 123,
            "message": "Reupload task created. Check progress at /api/task-status/123/"
        }
    """
    from core.views.idcard_api import _check_client_scope_by_table, _CLIENT_READONLY_STATUSES
    from idcards.models import IDCard
    
    # Check client scope
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err:
        return err
    
    # Client/client_staff cannot reupload for tables with locked cards
    if request.user.role in ('client', 'client_staff'):
        has_locked = IDCard.objects.filter(
            table_id=table_id,
            status__in=_CLIENT_READONLY_STATUSES
        ).exists()
        if has_locked:
            return JsonResponse({
                'success': False,
                'message': 'This table contains cards in approved/download status. Client users cannot reupload images.'
            }, status=403)
    
    # Double-click guard
    if not _acquire_task_lock(request.user.id, 'reupload'):
        return JsonResponse({'success': False, 'message': 'Request already in progress. Please wait.'}, status=429)
    
    try:
        # Validate table exists
        get_object_or_404(IDCardTable, id=table_id)

        # Check for required ZIP file
        if 'photos_zip' not in request.FILES:
            return JsonResponse({
                'success': False,
                'message': 'No ZIP file uploaded'
            }, status=400)

        # Validate ZIP file
        reup_zip = request.FILES['photos_zip']
        ok, err_msg = _validate_uploaded_file(reup_zip, ALLOWED_ZIP_EXTENSIONS, MAX_ZIP_SIZE, 'ZIP')
        if not ok:
            return JsonResponse({'success': False, 'message': err_msg}, status=400)

        # Save ZIP to disk
        zip_path = save_uploaded_file_to_disk(reup_zip)

        # ZIP bomb/safety check
        zok, zerr = validate_zip_safety(os.path.join(settings.MEDIA_ROOT, zip_path))
        if not zok:
            cleanup_temp_file(zip_path)
            return JsonResponse({'success': False, 'message': zerr}, status=400)

        # Parse optional scope parameters
        scope_payload = _parse_reupload_scope_payload(request)
        target_field = scope_payload['target_field']
        card_ids = scope_payload['card_ids']
        status_filter = scope_payload['status_filter']
        
        # Create BackgroundTask atomically (prevents race conditions)
        task, error_msg = BackgroundTask.create_if_no_active(
            user=request.user,
            task_type='reupload_images',
            file_path=zip_path,
            metadata={
                'table_id': table_id,
                'target_field': target_field,
                'card_ids': card_ids,
                'status_filter': status_filter,
            }
        )
        
        if not task:
            cleanup_temp_file(zip_path)
            
            return JsonResponse({
                'success': False,
                'message': error_msg
            }, status=429)
        
        # Submit to background worker
        background_worker.submit_task(task.id)
        
        return JsonResponse({
            'success': True,
            'task_id': task.id,
            'message': f'Reupload task created. Check progress at /api/task-status/{task.id}/'
        })
        
    except Exception as e:
        logger.exception("Error creating reupload task: %s", e)
        return JsonResponse({
            'success': False,
            'message': 'Error creating reupload task'
        }, status=400)
    finally:
        _release_task_lock(request.user.id, 'reupload')


# ==================== EXPORT TASK CREATION ====================

@require_POST
@rate_limit(max_requests=10, window_seconds=60, key_prefix='export')
@api_require_permission('perm_idcard_bulk_download')
def api_create_export_task(request, table_id):
    """
    Create a background task for data export (ZIP, PDF, DOCX, Excel).
    
    Endpoint: POST /api/table/<table_id>/export-task/
    
    Request (JSON body):
        - export_type: "zip", "pdf", "docx", or "excel" (required)
        - card_ids: Array of card IDs (optional)
        - status: Status filter (optional)
    
    Returns:
        {
            "success": true,
            "task_id": 123,
            "message": "Export task created. Check progress at /api/task-status/123/"
        }
    """
    from core.views.idcard_api import _check_client_scope_by_table
    
    # Check client scope
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err:
        return err
    
    # Double-click guard
    if not _acquire_task_lock(request.user.id, 'export'):
        return JsonResponse({'success': False, 'message': 'Request already in progress. Please wait.'}, status=429)
    
    try:
        # Validate table exists
        table = get_object_or_404(IDCardTable, id=table_id)
        
        # Parse request body
        try:
            if request.content_type == 'application/json':
                data = json.loads(request.body)
            else:
                data = request.POST
        except (json.JSONDecodeError, ValueError):
            data = request.POST
        
        # Get export type
        export_type = data.get('export_type', '').lower()
        type_mapping = {
            'zip': 'export_zip',
            'pdf': 'export_pdf',
            'docx': 'export_docx',
            'word': 'export_docx',
            'excel': 'export_excel',
            'xlsx': 'export_excel',
        }
        
        task_type = type_mapping.get(export_type)
        if not task_type:
            return JsonResponse({
                'success': False,
                'message': f'Invalid export_type: {export_type}. Expected: zip, pdf, docx, or excel'
            }, status=400)
        
        # Get optional parameters
        card_ids = data.get('card_ids', [])
        if isinstance(card_ids, str):
            try:
                card_ids = json.loads(card_ids)
            except (json.JSONDecodeError, TypeError):
                card_ids = []
        card_ids = _normalize_positive_int_ids(card_ids)
        
        status_filter = data.get('status', '')
        
        # Create BackgroundTask atomically (prevents race conditions)
        task, error_msg = BackgroundTask.create_if_no_active(
            user=request.user,
            task_type=task_type,
            metadata={
                'table_id': table_id,
                'card_ids': card_ids,
                'status': status_filter,
            }
        )
        
        if not task:
            return JsonResponse({
                'success': False,
                'message': error_msg
            }, status=429)
        
        # Submit to background worker
        background_worker.submit_task(task.id)
        
        return JsonResponse({
            'success': True,
            'task_id': task.id,
            'message': f'Export task created. Check progress at /api/task-status/{task.id}/'
        })
        
    except Exception as e:
        logger.exception("Error creating export task: %s", e)
        return JsonResponse({
            'success': False,
            'message': 'Error creating export task'
        }, status=400)
    finally:
        _release_task_lock(request.user.id, 'export')
