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
from typing import List, Optional

from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_POST
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404

from core.models import IDCardTable
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
        card_ids = [int(cid) for cid in card_ids if isinstance(cid, (int, str)) and str(cid).isdigit()]
        # Cap to prevent OOM / slow SQL
        if len(card_ids) > MAX_EXPORT_CARD_IDS:
            card_ids = card_ids[:MAX_EXPORT_CARD_IDS]
    
    # Fallback: if no card_ids provided but table_id is available,
    # fetch ALL card IDs for the requested status from the database,
    # respecting any active search/class/section filters.
    if not card_ids and table_id:
        from core.models import IDCard, IDCardTable
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
            qs = IDCard.objects.filter(table_id=table_id)
            if status:
                qs = qs.filter(status=status)
            if search_q:
                qs = qs.filter(field_data__icontains=search_q)
            if class_f:
                qs = qs.filter(field_data__icontains=class_f)
            if section_f:
                qs = qs.filter(field_data__icontains=section_f)
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
        except Exception:
            pass
    
    return card_ids if card_ids else None


def _check_export_permission(request):
    """
    Check if user has export permission.
    
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
    
    return None


def _check_export_client_scope(request, table_id):
    """
    Check if user has access to the client owning this table.
    Delegates to PermissionService.can_access_client() (single authority).
    
    Returns:
        None if permitted, JsonResponse with error if not
    """
    table = get_object_or_404(IDCardTable, id=table_id)
    if not PermissionService.can_access_client(request.user, table.group.client_id):
        return JsonResponse({
            'success': False,
            'message': 'Access denied. You are not assigned to this client.'
        }, status=403)
    return None


def _acquire_export_lock(user_id, table_id, ttl=120):
    """Prevent concurrent exports by the same user on the same table."""
    lock_key = f'export_lock:{user_id}:{table_id}'
    return django_cache.add(lock_key, 1, ttl), lock_key

def _release_export_lock(lock_key):
    """Release export lock."""
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
    acquired, lock_key = _acquire_export_lock(request.user.id, table_id)
    if not acquired:
        return JsonResponse({'success': False, 'message': 'An export is already in progress. Please wait.'}, status=429)
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
    
    # Get format preference
    doc_format = 'docx'
    if request.content_type == 'application/json':
        try:
            data = json.loads(request.body)
            doc_format = data.get('format', 'docx')
        except (json.JSONDecodeError, ValueError):
            pass
    else:
        doc_format = request.POST.get('format', 'docx')
    
    if doc_format not in ('docx', 'doc'):
        doc_format = 'docx'
    
    # Concurrent export guard
    acquired, lock_key = _acquire_export_lock(request.user.id, table_id)
    if not acquired:
        return JsonResponse({'success': False, 'message': 'An export is already in progress. Please wait.'}, status=429)
    try:
        service = ExportService(request.user)
        result = service.export_word(table_id, card_ids, doc_format=doc_format, status=_get_status_from_request(request))
        
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

# PDF generation is memory-intensive; use a lower limit
MAX_PDF_EXPORT_CARD_IDS = 2000

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
    perm_error = _check_export_permission(request)
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
    
    # Concurrent export guard
    acquired, lock_key = _acquire_export_lock(request.user.id, table_id)
    if not acquired:
        return JsonResponse({'success': False, 'message': 'An export is already in progress. Please wait.'}, status=429)
    try:
        service = ExportService(request.user)
        result = service.export_pdf(table_id, card_ids, status=_get_status_from_request(request))
        
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
# IMAGE ZIP EXPORT
# =============================================================================

# Image/ZIP exports are memory-intensive; use a reasonable limit
MAX_ZIP_EXPORT_CARD_IDS = 3000

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
    acquired, lock_key = _acquire_export_lock(request.user.id, table_id)
    if not acquired:
        return JsonResponse({'success': False, 'message': 'An export is already in progress. Please wait.'}, status=429)
    try:
        service = ExportService(request.user)
        result = service.export_images(table_id, card_ids, status=_get_status_from_request(request))
        
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
            card_ids = json.loads(card_ids_str)
        except (json.JSONDecodeError, ValueError):
            card_ids = [int(x.strip()) for x in card_ids_str.split(',') if x.strip().isdigit()]
    
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
    
    Memory-efficient implementation: processes data in batches and limits
    total export size to prevent server crashes.
    
    POST /api/table/<table_id>/cards/download-all/
    
    Returns JSON with base64-encoded files:
    {
        "success": true,
        "files": [
            {
                "type": "xlsx",
                "status": "pending",
                "filename": "Students (Pending)_A7.xlsx",
                "data": "base64..."
            },
            {
                "type": "zip",
                "status": "pending",
                "filename": "Students (Pending)_A7_PHOTO.zip",
                "data": "base64...",
                "image_count": 10
            }
        ],
        "total_files": 3
    }
    """
    import gc  # For memory cleanup
    
    # Check permission
    perm_error = _check_export_permission(request)
    if perm_error:
        return perm_error
    
    # Check client scope for admin_staff
    scope_error = _check_export_client_scope(request, table_id)
    if scope_error:
        return scope_error
    
    try:
        table = get_object_or_404(IDCardTable, id=table_id)
    except Exception:
        return JsonResponse({'success': False, 'message': 'Table not found'}, status=404)
    
    # Concurrent export guard
    acquired, lock_key = _acquire_export_lock(request.user.id, table_id)
    if not acquired:
        return JsonResponse({'success': False, 'message': 'An export is already in progress. Please wait.'}, status=429)
    try:
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
        
        files = []
        counter = 0
        
        # Memory-efficient limits
        MAX_CARDS_PER_STATUS = 1000  # Reduced from 2000
        MAX_TOTAL_CARDS = 3000  # Total card limit across all statuses
        total_cards_processed = 0
        
        for status_key, status_label in _DOWNLOAD_ALL_STATUSES.items():
            # Get cards for this status, scoped by user permissions
            cards_qs = service.get_scoped_cards(table).filter(status=status_key)
            
            card_count = cards_qs.count()
            if card_count == 0:
                continue
            
            # Check total limit
            remaining_capacity = MAX_TOTAL_CARDS - total_cards_processed
            if remaining_capacity <= 0:
                logger.warning("Download-all reached total card limit for table %d", table_id)
                break
            
            # Apply per-status and remaining capacity limits
            effective_limit = min(MAX_CARDS_PER_STATUS, remaining_capacity, card_count)
            cards = cards_qs[:effective_limit]
            
            total_cards_processed += effective_limit
            
            counter += 1
            if clean_client:
                base_name = f"{clean_client}_{clean_table}_{status_label}"
            else:
                base_name = f"{clean_table}_{status_label}"
            
            # Generate XLSX (base64) - XLSX is generally small
            try:
                xlsx_result = excel_exporter.export_cards(table, cards, status=status_key)
                if xlsx_result.success and xlsx_result.response:
                    xlsx_base64 = base64.b64encode(xlsx_result.response.content).decode('utf-8')
                    files.append({
                        'type': 'xlsx',
                        'status': status_key,
                        'filename': f"{base_name}.xlsx",
                        'data': xlsx_base64,
                    })
                    # Clean up XLSX response to free memory
                    del xlsx_result
            except Exception as e:
                logger.error("XLSX export failed for status %s: %s", status_key, e)
            
            # Force garbage collection after XLSX
            gc.collect()
            
            # Generate ZIP(s) for image fields (base64) - use batched processing
            try:
                zip_result = zip_exporter.export_images(table, cards, status=status_key)
                if zip_result.success and zip_result.zip_files:
                    for zf in zip_result.zip_files:
                        field_label = zf.field_name.upper().replace(' ', '_')
                        files.append({
                            'type': 'zip',
                            'status': status_key,
                            'filename': f"{base_name}_{field_label}.zip",
                            'data': zf.data,
                            'image_count': zf.image_count,
                        })
                # Clean up ZIP result to free memory
                del zip_result
            except Exception as e:
                logger.error("ZIP export failed for status %s: %s", status_key, e)
            
            # Force garbage collection after each status to prevent memory buildup
            gc.collect()
        
        if not files:
            return JsonResponse({
                'success': False,
                'message': 'No cards found in any list to export'
            }, status=400)
        
        logger.info("Export DOWNLOAD-ALL: user=%s table=%d files=%d cards=%d", 
                    request.user.id, table_id, len(files), total_cards_processed)
        
        return JsonResponse({
            'success': True,
            'files': files,
            'total_files': len(files),
            'total_cards': total_cards_processed,
            'note': f"Limited to {MAX_TOTAL_CARDS} total cards" if total_cards_processed >= MAX_TOTAL_CARDS else None
        })
    except Exception as e:
        logger.exception("Export DOWNLOAD-ALL failed: %s", e)
        return JsonResponse({'success': False, 'message': 'Export failed. Please try again or reduce the number of cards.'}, status=500)
    finally:
        _release_export_lock(lock_key)
