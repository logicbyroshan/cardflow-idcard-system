"""
Export Views Module

API views for export operations.
All views are READ-ONLY - they never mutate data.

Features:
- Permission checking
- Client scoping
- Proper error responses
"""
import json
import base64
import logging
from typing import List, Optional, Dict, Any

from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_POST
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404

from idcards.models import IDCardTable
from core.services.permission_service import PermissionService
from accounts.rate_limit import rate_limit

from django.core.cache import cache as django_cache

from .services import ExportService
from .excel import ExcelExporter
from .zip import ZipExporter, zip_result_to_dict

logger = logging.getLogger(__name__)

MAX_EXPORT_CARD_IDS = 5000

_VALID_STATUSES = {'pending', 'verified', 'approved', 'download', 'pool'}


def _get_status_from_request(request) -> str:
    """Extract status label from POST body (JSON or form data)."""
    status = ''
    if request.content_type == 'application/json':
        try:
            data = json.loads(request.body)
            status = data.get('status', '')
        except (json.JSONDecodeError, ValueError):
            pass
    if not status:
        status = request.POST.get('status', '')
    return status if status in _VALID_STATUSES else ''


def _normalize_positive_int_ids(values, max_items: int = MAX_EXPORT_CARD_IDS) -> List[int]:
    """Normalize mixed payload IDs to unique positive integers with a hard cap."""
    if not isinstance(values, list):
        return []

    out: List[int] = []
    seen = set()
    for value in values:
        if isinstance(value, bool):
            continue
        try:
            number = int(str(value).strip())
        except (TypeError, ValueError):
            continue
        if number <= 0 or number in seen:
            continue
        seen.add(number)
        out.append(number)
        if len(out) >= max_items:
            break
    return out


def _get_card_ids_from_request(request, table_id: int = None) -> Optional[List[int]]:
    """
    Extract card IDs from POST request body.
    
    Handles both form data and JSON body.
    When no explicit card_ids are provided but table_id is given,
    falls back to ALL card IDs for the requested status from the database.
    
    Args:
        request: Django HttpRequest
        table_id: Optional table ID to fall back to full status query
        
    Returns:
        List of card IDs or None if no valid IDs found
    """
    card_ids = None
    
    # Try JSON body first
    if request.content_type == 'application/json':
        try:
            data = json.loads(request.body)
            card_ids = data.get('card_ids', [])
        except (json.JSONDecodeError, ValueError):
            pass
    
    # Fall back to POST data
    if not card_ids:
        card_ids_str = request.POST.get('card_ids', '')
        if card_ids_str:
            try:
                card_ids = json.loads(card_ids_str)
            except (json.JSONDecodeError, ValueError):
                # Try comma-separated
                card_ids = [int(x.strip()) for x in card_ids_str.split(',') if x.strip().isdigit()]
    
    # Validate and filter
    if card_ids:
        card_ids = _normalize_positive_int_ids(card_ids, max_items=MAX_EXPORT_CARD_IDS)
    
    # Fallback: if no card_ids provided but table_id is available,
    # fetch ALL card IDs for the requested status from the database,
    # respecting any active search/class/section filters.
    if not card_ids and table_id:
        from idcards.models import IDCard, IDCardTable
        from core.services import IDCardService
        status = _get_status_from_request(request)
        # Extract optional filters from JSON body
        search_q = ''
        class_f = ''
        section_f = ''
        from_date = ''
        to_date = ''
        if request.content_type == 'application/json':
            try:
                body = json.loads(request.body)
                search_q = (body.get('search') or '').strip()
                class_f = (body.get('class') or body.get('class_filter') or '').strip()
                section_f = (body.get('section') or body.get('section_filter') or '').strip()
                from_date = (body.get('from') or '').strip()
                to_date = (body.get('to') or '').strip()
            except (json.JSONDecodeError, ValueError):
                pass
        try:
            from django.db.models.fields.json import KeyTextTransform
            from core.views.idcard_api import _get_class_section_field_names

            table = IDCardTable.objects.select_related('group').filter(id=table_id).first()
            if not table:
                return None

            user = getattr(request, 'user', None)
            if not user or not getattr(user, 'is_authenticated', False):
                logger.warning("Export fallback blocked for unauthenticated request on table %s", table_id)
                return None
            if not PermissionService.can_access_client(user, table.group.client_id):
                logger.warning("Export fallback blocked for unauthorized user %s on table %s", getattr(user, 'id', None), table_id)
                return None

            qs = IDCard.objects.filter(table=table)
            if status:
                qs = qs.filter(status=status)
            if search_q:
                qs = IDCardService._apply_search_filter(qs, search_q, table=table)
            # Use proper JSON field extraction for exact class/section matching
            if class_f or section_f:
                if table:
                    class_field_name, section_field_name = _get_class_section_field_names(table)
                    if class_f and class_field_name:
                        qs = qs.annotate(_cls=KeyTextTransform(class_field_name, 'field_data')).filter(_cls__iexact=class_f)
                    if section_f and section_field_name:
                        qs = qs.annotate(_sec=KeyTextTransform(section_field_name, 'field_data')).filter(_sec__iexact=section_f)
            # DateTime range filter (download list)
            if from_date:
                try:
                    from django.utils.dateparse import parse_datetime
                    dt = parse_datetime(from_date)
                    if dt:
                        qs = qs.filter(downloaded_at__gte=dt)
                except (ValueError, TypeError):
                    pass
            if to_date:
                try:
                    from django.utils.dateparse import parse_datetime
                    dt = parse_datetime(to_date)
                    if dt:
                        qs = qs.filter(downloaded_at__lte=dt)
                except (ValueError, TypeError):
                    pass
            card_ids = list(qs.order_by('id').values_list('id', flat=True)[:MAX_EXPORT_CARD_IDS])
        except Exception as e:
            logger.warning("Export card_ids fallback query failed for table %s: %s", table_id, e)
    
    return card_ids if card_ids else None


def _get_image_rename_options_from_request(request) -> Optional[Dict[str, Any]]:
    """
    Extract optional image rename settings from JSON body.

    Expected shape:
        {
            "rename_options": {
                "enabled": true,
                "image_name_fields": {
                    "PHOTO": "Student Name",
                    "FATHER_PHOTO": "Father Name",
                    "MOTHER_PHOTO": "Mother Name"
                }
            }
        }
    """
    if request.content_type != 'application/json':
        return None

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return None

    rename_options = data.get('rename_options')
    if not isinstance(rename_options, dict):
        return None
    if rename_options.get('enabled') is not True:
        return None

    raw_map = rename_options.get('image_name_fields')
    if not isinstance(raw_map, dict):
        return None

    cleaned_map: Dict[str, str] = {}
    for key, value in raw_map.items():
        k = str(key or '').strip().upper()
        v = str(value or '').strip()
        if not k or not v:
            continue
        if len(k) > 60 or len(v) > 120:
            continue
        cleaned_map[k] = v

    if not cleaned_map:
        return None

    return {
        'enabled': True,
        'image_name_fields': cleaned_map,
    }


def _check_export_permission(request, skip_status_check=False):
    """
    Check if user has export permission.
    
    Clients/client_staff are blocked from exporting approved/download status
    cards and from the download-all endpoint (unless skip_status_check=True,
    used for PDF exports which clients are allowed on all statuses).
    
    Returns:
        None if permitted, JsonResponse with error if not
    """
    if not request.user.is_authenticated:
        return JsonResponse({
            'success': False,
            'message': 'Authentication required'
        }, status=401)
    
    if not PermissionService.can_bulk_download(request.user):
        return JsonResponse({
            'success': False,
            'message': 'Permission denied: You do not have bulk download access'
        }, status=403)
    
    # Block client/client_staff from exporting approved or download status cards
    # (skipped for PDF exports — clients can download PDF on all statuses)
    if not skip_status_check and request.user.role in ('client', 'client_staff'):
        status = _get_status_from_request(request)
        if status in ('approved', 'download'):
            return JsonResponse({
                'success': False,
                'message': 'Export is not available for this list'
            }, status=403)
    
    return None


def _check_client_pdf_only(request):
    """
    Block client / client_staff from non-PDF export formats.
    Clients are only allowed PDF downloads; xlsx, docx, images are admin-only.

    Returns:
        None if permitted, JsonResponse with error if blocked.
    """
    if request.user.role in ('client', 'client_staff'):
        return JsonResponse({
            'success': False,
            'message': 'Only PDF download is available for your account'
        }, status=403)
    return None


def _check_export_client_scope(request, table_id):
    """
    Check if user has access to the client owning this table.
    Delegates to PermissionService.can_access_client() (single authority).
    
    Returns:
        None if permitted, JsonResponse with error if not
    """
    table = get_object_or_404(IDCardTable.objects.select_related('group'), id=table_id)
    if not PermissionService.can_access_client(request.user, table.group.client_id):
        return JsonResponse({
            'success': False,
            'message': 'Access denied. You are not assigned to this client.'
        }, status=403)
    return None


def _acquire_export_lock(user_id, table_id, export_type='generic', max_concurrent=3, ttl=300):
    """Allow up to max_concurrent concurrent exports per user/table/type.

    Each export type (pdf, xlsx, docx, images, download_all) gets its own
    set of lock slots so that e.g. 3 PDF downloads can run at the same time
    while an XLSX export is also in progress.

    TTL=300s (5 min) safety net — locks are always released in the finally
    block, but TTL handles crashes / timeouts gracefully.

    Returns (acquired: bool, lock_key: str).
    """
    for slot in range(max_concurrent):
        lock_key = f'export_lock:{user_id}:{table_id}:{export_type}:{slot}'
        if django_cache.add(lock_key, 1, ttl):
            return True, lock_key
    return False, ''

def _release_export_lock(lock_key):
    """Release export lock."""
    if lock_key:
        django_cache.delete(lock_key)


# =============================================================================
# EXCEL EXPORT
# =============================================================================

@login_required
@require_POST
@rate_limit(max_requests=10, window_seconds=60, key_prefix='export')
def api_export_xlsx(request, table_id: int) -> HttpResponse:
    """
    Export cards to Excel format.
    
    POST /api/table/<table_id>/export/xlsx/
    POST /api/table/<table_id>/cards/download-xlsx/  (legacy URL in core)
    
    Body:
        {
            "card_ids": [1, 2, 3]
        }
        
    Returns:
        Excel file download or JSON error
    """
    # Check permission
    perm_error = _check_export_permission(request)
    if perm_error:
        return perm_error
    
    # Client/client_staff can only download PDF
    pdf_only = _check_client_pdf_only(request)
    if pdf_only:
        return pdf_only
    
    # Check client scope for admin_staff
    scope_error = _check_export_client_scope(request, table_id)
    if scope_error:
        return scope_error
    
    card_ids = _get_card_ids_from_request(request, table_id=table_id)
    if not card_ids:
        return JsonResponse({
            'success': False,
            'message': 'No cards selected for export'
        }, status=400)
    
    # Concurrent export guard
    acquired, lock_key = _acquire_export_lock(request.user.id, table_id, 'xlsx')
    if not acquired:
        return JsonResponse({'success': False, 'level': 'warning', 'message': 'Too many Excel exports running. Please wait.'}, status=429)
    try:
        service = ExportService(request.user)
        result = service.export_excel(table_id, card_ids, status=_get_status_from_request(request))
        
        if not result.success:
            return JsonResponse({
                'success': False,
                'message': result.message
            }, status=400)
        
        logger.info("Export XLSX: user=%s table=%d cards=%d", request.user.id, table_id, len(card_ids))
        return result.response
    except Exception as e:
        logger.exception("Export XLSX failed: %s", e)
        return JsonResponse({'success': False, 'message': 'Export failed. Please try again or reduce the number of cards.'}, status=500)
    finally:
        _release_export_lock(lock_key)


# =============================================================================
# WORD EXPORT
# =============================================================================

@login_required
@require_POST
@rate_limit(max_requests=10, window_seconds=60, key_prefix='export')
def api_export_docx(request, table_id: int) -> HttpResponse:
    """
    Export cards to Word format.
    
    POST /api/table/<table_id>/export/docx/
    POST /api/table/<table_id>/cards/download-docx/  (legacy URL in core)
    
    Body:
        {
            "card_ids": [1, 2, 3],
            "format": "docx"  // or "doc"
        }
        
    Returns:
        Word file download or JSON error
    """
    # Check permission
    perm_error = _check_export_permission(request)
    if perm_error:
        return perm_error
    
    # Client/client_staff can only download PDF
    pdf_only = _check_client_pdf_only(request)
    if pdf_only:
        return pdf_only
    
    # Check client scope for admin_staff
    scope_error = _check_export_client_scope(request, table_id)
    if scope_error:
        return scope_error
    
    card_ids = _get_card_ids_from_request(request, table_id=table_id)
    if not card_ids:
        return JsonResponse({
            'success': False,
            'message': 'No cards selected for export'
        }, status=400)
    
    # Get format preference and template_id
    doc_format = 'docx'
    template_id = None
    if request.content_type == 'application/json':
        try:
            data = json.loads(request.body)
            doc_format = data.get('format', 'docx')
            tpl_val = data.get('template_id', '')
            if tpl_val:
                try:
                    template_id = int(tpl_val)
                except (ValueError, TypeError):
                    pass
        except (json.JSONDecodeError, ValueError):
            pass
    else:
        doc_format = request.POST.get('format', 'docx')
    
    if doc_format not in ('docx', 'doc'):
        doc_format = 'docx'
    
    # Concurrent export guard
    acquired, lock_key = _acquire_export_lock(request.user.id, table_id, 'docx')
    if not acquired:
        return JsonResponse({'success': False, 'level': 'warning', 'message': 'Too many Word exports running. Please wait.'}, status=429)
    try:
        service = ExportService(request.user)
        result = service.export_word(table_id, card_ids, doc_format=doc_format, status=_get_status_from_request(request), template_id=template_id)
        
        if not result.success:
            return JsonResponse({
                'success': False,
                'message': result.message
            }, status=400)
        
        logger.info("Export %s: user=%s table=%d cards=%d", doc_format.upper(), request.user.id, table_id, len(card_ids))
        return result.response
    except Exception as e:
        logger.exception("Export DOCX failed: %s", e)
        return JsonResponse({'success': False, 'message': 'Export failed. Please try again or reduce the number of cards.'}, status=500)
    finally:
        _release_export_lock(lock_key)


# =============================================================================
# PDF EXPORT
# =============================================================================

# PDF generation is memory-intensive
MAX_PDF_EXPORT_CARD_IDS = 5000

@login_required
@require_POST
@rate_limit(max_requests=10, window_seconds=60, key_prefix='export')
def api_export_pdf(request, table_id: int) -> HttpResponse:
    """
    Export cards to PDF format.
    
    POST /api/table/<table_id>/export/pdf/
    POST /api/table/<table_id>/cards/download-pdf/  (legacy URL in core)
    
    Body:
        {
            "card_ids": [1, 2, 3]
        }
        
    Returns:
        PDF file download or JSON error
    """
    perm_error = _check_export_permission(request, skip_status_check=True)
    if perm_error:
        return perm_error
    
    # Check client scope for admin_staff
    scope_error = _check_export_client_scope(request, table_id)
    if scope_error:
        return scope_error
    
    card_ids = _get_card_ids_from_request(request, table_id=table_id)
    if not card_ids:
        return JsonResponse({
            'success': False,
            'message': 'No cards selected for export'
        }, status=400)
    
    # Apply PDF-specific limit (more strict for memory reasons)
    if len(card_ids) > MAX_PDF_EXPORT_CARD_IDS:
        card_ids = card_ids[:MAX_PDF_EXPORT_CARD_IDS]
    
    # Extract template_id from request.
    # Font mode is intentionally locked to 'auto' for consistent layout.
    template_id = None
    font_mode = 'auto'
    shorten_titles = False
    if request.content_type == 'application/json':
        try:
            data = json.loads(request.body)
            tpl_val = data.get('template_id', '')
            if tpl_val:
                try:
                    template_id = int(tpl_val)
                except (ValueError, TypeError):
                    pass
            shorten_titles = bool(data.get('shorten_titles', False))
        except (json.JSONDecodeError, ValueError):
            pass
    
    # Concurrent export guard
    acquired, lock_key = _acquire_export_lock(request.user.id, table_id, 'pdf')
    if not acquired:
        return JsonResponse({'success': False, 'level': 'warning', 'message': 'Too many PDF exports running. Please wait.'}, status=429)
    try:
        service = ExportService(request.user)
        result = service.export_pdf(table_id, card_ids, status=_get_status_from_request(request), template_id=template_id, font_mode=font_mode, shorten_titles=shorten_titles)
        
        if not result.success:
            return JsonResponse({
                'success': False,
                'message': result.message
            }, status=400)
        
        logger.info("Export PDF: user=%s table=%d cards=%d", request.user.id, table_id, len(card_ids))
        return result.response
    except Exception as e:
        logger.exception("Export PDF failed: %s", e)
        return JsonResponse({'success': False, 'message': 'Export failed. Please try again or reduce the number of cards.'}, status=500)
    finally:
        _release_export_lock(lock_key)


# =============================================================================
# ASYNC PDF EXPORT (Background generation with polling)
# =============================================================================

# Threshold: exports with more cards than this use background generation
_ASYNC_PDF_THRESHOLD = 500

@login_required
@require_POST
@rate_limit(max_requests=10, window_seconds=60, key_prefix='export')
def api_export_pdf_async(request, table_id: int) -> JsonResponse:
    """
    Start a background PDF export for large datasets.
    
    Returns a task_id immediately. Client polls api_export_status()
    until state='completed', then downloads the file.
    
    POST /api/table/<table_id>/export/pdf-async/
    
    Body:
        { "card_ids": [1, 2, 3], "template_id": 5 }
    
    Returns:
        { "success": true, "task_id": "abc123", "async": true }
    """
    perm_error = _check_export_permission(request, skip_status_check=True)
    if perm_error:
        return perm_error
    
    scope_error = _check_export_client_scope(request, table_id)
    if scope_error:
        return scope_error
    
    card_ids = _get_card_ids_from_request(request, table_id=table_id)
    if not card_ids:
        return JsonResponse({
            'success': False,
            'message': 'No cards selected for export'
        }, status=400)
    
    if len(card_ids) > MAX_PDF_EXPORT_CARD_IDS:
        card_ids = card_ids[:MAX_PDF_EXPORT_CARD_IDS]
    
    template_id = None
    font_mode = 'auto'
    shorten_titles = False
    if request.content_type == 'application/json':
        try:
            data = json.loads(request.body)
            tpl_val = data.get('template_id', '')
            if tpl_val:
                try:
                    template_id = int(tpl_val)
                except (ValueError, TypeError):
                    pass
            shorten_titles = bool(data.get('shorten_titles', False))
        except (json.JSONDecodeError, ValueError):
            pass
    
    from .tasks import BackgroundExportManager
    
    task_id = BackgroundExportManager.start_pdf_export(
        user=request.user,
        table_id=table_id,
        card_ids=card_ids,
        status=_get_status_from_request(request),
        template_id=template_id,
        font_mode=font_mode,
        shorten_titles=shorten_titles,
    )
    
    logger.info("Export PDF (async): user=%s table=%d cards=%d task=%s",
                request.user.id, table_id, len(card_ids), task_id)
    
    return JsonResponse({
        'success': True,
        'task_id': task_id,
        'async': True,
        'card_count': len(card_ids),
    })


@login_required
def api_export_status(request, task_id: str) -> JsonResponse:
    """
    Check the status of a background export task.
    
    GET /api/export/status/<task_id>/
    
    Returns:
        {
            "success": true,
            "state": "processing|completed|failed",
            "progress": 50,
            "message": "Generating PDF for 2000 cards...",
            "download_url": "/media/temp/exports/abc123_file.pdf"  (when completed)
        }
    """
    from .tasks import BackgroundExportManager
    
    status = BackgroundExportManager.get_status(task_id, user=request.user)
    if status is None:
        return JsonResponse({
            'success': False,
            'message': 'Export task not found or expired'
        }, status=404)
    
    return JsonResponse({
        'success': True,
        'state': status['state'],
        'progress': status['progress'],
        'message': status['message'],
        'download_url': status.get('download_url', ''),
        'filename': status.get('filename', ''),
    })


# =============================================================================
# IMAGE ZIP EXPORT
# =============================================================================

# Image/ZIP exports
MAX_ZIP_EXPORT_CARD_IDS = 5000

@login_required
@require_POST
@rate_limit(max_requests=10, window_seconds=60, key_prefix='export')
def api_export_images(request, table_id: int) -> JsonResponse:
    """
    Export images as ZIP files.
    
    POST /api/table/<table_id>/export/images/
    POST /api/table/<table_id>/cards/download-images/  (legacy URL in core)
    
    Body:
        {
            "card_ids": [1, 2, 3]
        }
        
    Returns:
        JSON with base64-encoded ZIP files:
        {
            "success": true,
            "zip_files": [
                {
                    "field_name": "PHOTO",
                    "filename": "TableName_PHOTO_20240101_120000.zip",
                    "data": "base64...",
                    "image_count": 10
                }
            ],
            "total_images": 10,
            "total_zips": 1
        }
    """
    # Check permission
    perm_error = _check_export_permission(request)
    if perm_error:
        return perm_error
    
    # Client/client_staff can only download PDF
    pdf_only = _check_client_pdf_only(request)
    if pdf_only:
        return pdf_only
    
    # Check client scope for admin_staff
    scope_error = _check_export_client_scope(request, table_id)
    if scope_error:
        return scope_error
    
    card_ids = _get_card_ids_from_request(request, table_id=table_id)
    if not card_ids:
        return JsonResponse({
            'success': False,
            'message': 'No cards selected for export'
        }, status=400)
    
    # Apply ZIP-specific limit (memory-intensive)
    if len(card_ids) > MAX_ZIP_EXPORT_CARD_IDS:
        card_ids = card_ids[:MAX_ZIP_EXPORT_CARD_IDS]
    
    # Concurrent export guard
    acquired, lock_key = _acquire_export_lock(request.user.id, table_id, 'images')
    if not acquired:
        return JsonResponse({'success': False, 'level': 'warning', 'message': 'Too many image exports running. Please wait.'}, status=429)
    try:
        service = ExportService(request.user)
        rename_options = _get_image_rename_options_from_request(request)
        result = service.export_images(
            table_id,
            card_ids,
            status=_get_status_from_request(request),
            rename_options=rename_options,
        )
        
        logger.info("Export ZIP: user=%s table=%d cards=%d", request.user.id, table_id, len(card_ids))
        return JsonResponse(zip_result_to_dict(result))
    except Exception as e:
        logger.exception("Export ZIP failed: %s", e)
        return JsonResponse({'success': False, 'message': 'Export failed. Please try again or reduce the number of cards.'}, status=500)
    finally:
        _release_export_lock(lock_key)


# =============================================================================
# EXPORT PREVIEW
# =============================================================================

@login_required
def api_export_preview(request, table_id: int) -> JsonResponse:
    """
    Get export preview/capabilities for a table.
    
    GET /api/table/<table_id>/export/preview/
    
    Returns:
        JSON with export capabilities:
        {
            "success": true,
            "table_name": "Student Cards",
            "card_count": 100,
            "text_field_count": 5,
            "image_field_count": 2,
            "available_formats": {
                "xlsx": true,
                "docx": true,
                "doc": true,
                "zip": true
            },
            "can_export": true
        }
    """
    # Check permission
    perm_error = _check_export_permission(request)
    if perm_error:
        return perm_error

    # Check client scope for admin_staff
    scope_error = _check_export_client_scope(request, table_id)
    if scope_error:
        return scope_error

    card_ids = None
    
    # Optional card_ids filter
    card_ids_str = request.GET.get('card_ids', '')
    if card_ids_str:
        try:
            card_ids = _normalize_positive_int_ids(json.loads(card_ids_str))
        except (json.JSONDecodeError, ValueError):
            card_ids = _normalize_positive_int_ids(card_ids_str.split(','))
    
    service = ExportService(request.user)
    result = service.get_export_preview(table_id, card_ids)
    
    return JsonResponse(result)


# =============================================================================
# DOWNLOAD ALL (Bulk Export by Status)
# =============================================================================

# Status lists to export
_DOWNLOAD_ALL_STATUSES = {
    'pending': 'Pending',
    'verified': 'Verified',
    'approved': 'Approved',
    'download': 'Download',
    'pool': 'Pool',
}


@login_required
@require_POST
@rate_limit(max_requests=3, window_seconds=60, key_prefix='export_all')
def api_download_all_cards(request, table_id: int) -> JsonResponse:
    """
    Download all ID cards for a table, grouped by status list.
    
    For each status (Pending/Verified/Approved/Download/Pool) that has cards,
    generates one XLSX file and one or more ZIP files (one per image field).
    
    Memory-efficient implementation:
    - Writes individual XLSX/ZIP files to a temp directory on disk
    - Streams them into a single combined ZIP file on disk
    - Returns a download URL for the combined ZIP (no base64 in RAM)
    - Temp files auto-cleaned after 1 hour by BackgroundExportManager
    
    Not available to client/client_staff users.
    
    POST /api/table/<table_id>/cards/download-all/
    
    Returns JSON with a download URL (new streaming mode) or base64 files (legacy small exports):
    {
        "success": true,
        "download_url": "/media/temp/exports/abc123_download_all.zip",
        "filename": "Client_Table_AllCards.zip",
        "total_files": 3,
        "total_cards": 500
    }
    """
    
    # Block client/client_staff from download-all (contains approved/download data)
    if request.user.is_authenticated and request.user.role in ('client', 'client_staff'):
        return JsonResponse({
            'success': False,
            'message': 'This feature is not available for your account'
        }, status=403)
    
    # Check permission
    perm_error = _check_export_permission(request)
    if perm_error:
        return perm_error
    
    # Check client scope for admin_staff
    scope_error = _check_export_client_scope(request, table_id)
    if scope_error:
        return scope_error
    
    try:
        table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    except Exception:
        return JsonResponse({'success': False, 'message': 'Table not found'}, status=404)
    
    # Concurrent export guard — download-all is heavy, keep max_concurrent=1
    acquired, lock_key = _acquire_export_lock(request.user.id, table_id, 'download_all', max_concurrent=1)
    if not acquired:
        return JsonResponse({'success': False, 'level': 'warning', 'message': 'A bulk download is already in progress. Please wait.'}, status=429)
    try:
        import uuid as _uuid
        from .tasks import EXPORT_TEMP_DIR, _ensure_export_dir
        _ensure_export_dir()
        
        service = ExportService(request.user)
        excel_exporter = ExcelExporter()
        zip_exporter = ZipExporter()
        
        # Get client name for filenames
        client_name = ''
        if table.group and table.group.client:
            client_name = table.group.client.name
        
        from .utils import clean_filename
        clean_client = clean_filename(client_name) if client_name else ''
        clean_table = clean_filename(table.name)
        
        # Export limits per download-all
        MAX_CARDS_PER_STATUS = 15000
        MAX_TOTAL_CARDS = 15000
        total_cards_processed = 0
        file_entries = []  # list of (filename, disk_path) for combined ZIP
        temp_files = []  # track for cleanup on error
        
        task_id = _uuid.uuid4().hex[:12]
        
        for status_key, status_label in _DOWNLOAD_ALL_STATUSES.items():
            cards_qs = service.get_scoped_cards(table).filter(status=status_key)
            card_count = cards_qs.count()
            if card_count == 0:
                continue
            
            remaining_capacity = MAX_TOTAL_CARDS - total_cards_processed
            if remaining_capacity <= 0:
                logger.warning("Download-all reached total card limit for table %d", table_id)
                break
            
            effective_limit = min(MAX_CARDS_PER_STATUS, remaining_capacity, card_count)
            cards = cards_qs[:effective_limit]
            total_cards_processed += effective_limit
            
            if clean_client:
                base_name = f"{clean_client}_{clean_table}_{status_label}"
            else:
                base_name = f"{clean_table}_{status_label}"
            
            # Write XLSX to disk
            try:
                xlsx_result = excel_exporter.export_cards(table, cards, status=status_key)
                if xlsx_result.success and xlsx_result.response:
                    xlsx_filename = f"{base_name}.xlsx"
                    xlsx_path = os.path.join(EXPORT_TEMP_DIR, f"{task_id}_{xlsx_filename}")
                    # Handle both HttpResponse (.content) and StreamingHttpResponse (.streaming_content)
                    resp = xlsx_result.response
                    if hasattr(resp, 'content'):
                        xlsx_bytes = resp.content
                    elif hasattr(resp, 'streaming_content'):
                        xlsx_bytes = b''.join(
                            ch.encode('utf-8') if isinstance(ch, str) else ch
                            for ch in resp.streaming_content
                        )
                    else:
                        xlsx_bytes = b''
                    if xlsx_bytes:
                        with open(xlsx_path, 'wb') as f:
                            f.write(xlsx_bytes)
                        file_entries.append((xlsx_filename, xlsx_path))
                        temp_files.append(xlsx_path)
                    del xlsx_bytes
                    del xlsx_result
            except Exception as e:
                logger.error("XLSX export failed for status %s: %s", status_key, e)
            
            # Write ZIP(s) for image fields directly to disk (memory-safe, no base64)
            try:
                from .zip import export_images_to_disk as _export_images_disk
                disk_result = _export_images_disk(table, cards, output_dir=EXPORT_TEMP_DIR, status=status_label)
                if disk_result.success and disk_result.zip_files:
                    for dzi in disk_result.zip_files:
                        file_entries.append((dzi.filename, dzi.path))
                        temp_files.append(dzi.path)
                del disk_result
            except Exception as e:
                logger.error("ZIP export failed for status %s: %s", status_key, e)
        
        if not file_entries:
            # Cleanup any temp files
            for tp in temp_files:
                try:
                    os.remove(tp)
                except OSError:
                    pass
            return JsonResponse({
                'success': False,
                'message': 'No cards found in any list to export'
            }, status=400)
        
        # Combine all files into a single ZIP on disk (streaming, constant RAM)
        if clean_client:
            combined_name = f"{clean_client}_{clean_table}_AllCards.zip"
        else:
            combined_name = f"{clean_table}_AllCards.zip"
        
        combined_path = os.path.join(EXPORT_TEMP_DIR, f"{task_id}_{combined_name}")
        
        import zipfile as _zf
        with _zf.ZipFile(combined_path, 'w', _zf.ZIP_DEFLATED) as combined_zip:
            for entry_name, entry_path in file_entries:
                combined_zip.write(entry_path, arcname=entry_name)
        
        # Clean up individual temp files (combined ZIP has their data now)
        for tp in temp_files:
            try:
                os.remove(tp)
            except OSError:
                pass
        
        # Build download URL
        rel_path = os.path.relpath(combined_path, settings.MEDIA_ROOT).replace('\\', '/')
        download_url = f'{settings.MEDIA_URL}{rel_path}'
        
        logger.info("Export DOWNLOAD-ALL: user=%s table=%d files=%d cards=%d url=%s", 
                    request.user.id, table_id, len(file_entries), total_cards_processed, download_url)
        
        return JsonResponse({
            'success': True,
            'download_url': download_url,
            'filename': combined_name,
            'total_files': len(file_entries),
            'total_cards': total_cards_processed,
            'note': f"Limited to {MAX_TOTAL_CARDS} total cards" if total_cards_processed >= MAX_TOTAL_CARDS else None
        })
    except Exception as e:
        logger.exception("Export DOWNLOAD-ALL failed: %s", e)
        return JsonResponse({'success': False, 'message': 'Export failed. Please try again or reduce the number of cards.'}, status=500)
    finally:
        _release_export_lock(lock_key)
