"""
ID Card API Views
Contains: All ID Card Table and ID Card related API endpoints.
Including: CRUD, bulk operations, search, status changes, bulk upload.

ARCHITECTURE RULES (enforced):
- Views are ULTRA-THIN: parse request → call service → return JsonResponse.
- NO .save(), .create(), .delete() on IDCard / IDCardTable in views.
- All mutations delegate to IDCardService or WorkflowService.
- Permission enforcement via @api_require_permission decorators.
- Client scoping via _check_client_scope_by_table / _check_client_scope_by_card.

EXCEPTION: api_idcard_bulk_upload and api_idcard_reupload_images still
contain inline mutation logic — flagged for future service extraction.
"""
import json
import logging
import os

from django.shortcuts import get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.db import transaction

from ..models import IDCardGroup, IDCard, IDCardTable
from ..services import IDCardService
from ..services.image_service import ImageService
from ..services.base import BaseService
from ..services.activity_service import ActivityService
from ..services.permission_service import (
    PermissionService,
    api_require_any_authenticated,
    api_require_permission,
)
from ..services.workflow_service import WorkflowService

# Logger for this module
logger = logging.getLogger(__name__)


# ==================== ADMIN STAFF CLIENT SCOPING ====================
# Ensures admin_staff can only access data belonging to their assigned clients.

_ACCESS_DENIED_RESPONSE = JsonResponse(
    {'success': False, 'message': 'Access denied. You are not assigned to this client.'},
    status=403,
)

def _check_client_scope_by_group(user, group_id):
    """Check user has access to the client owning this group. Returns (group, error_response).
    
    Delegates to PermissionService.can_access_client() (single authority).
    """
    group = get_object_or_404(IDCardGroup, id=group_id)
    if not PermissionService.can_access_client(user, group.client_id):
        return None, _ACCESS_DENIED_RESPONSE
    return group, None

def _check_client_scope_by_table(user, table_id):
    """Check user has access to the client owning this table. Returns (table, error_response).
    
    Delegates to PermissionService.can_access_client() (single authority).
    """
    table = get_object_or_404(IDCardTable.objects.select_related('group'), id=table_id)
    if not PermissionService.can_access_client(user, table.group.client_id):
        return None, _ACCESS_DENIED_RESPONSE
    return table, None

def _check_client_scope_by_card(user, card_id):
    """Check user has access to the client owning this card. Returns (card, error_response).
    
    Delegates to PermissionService.can_access_client() (single authority).
    """
    card = get_object_or_404(IDCard.objects.select_related('table__group'), id=card_id)
    if not PermissionService.can_access_client(user, card.table.group.client_id):
        return None, _ACCESS_DENIED_RESPONSE
    return card, None


# ==================== CLIENT READONLY ON APPROVED+ ====================
# After cards reach approved/download/reprint, client & client_staff users
# can only VIEW — no edit, delete, status change, or image reupload.

_CLIENT_READONLY_STATUSES = frozenset({'approved', 'download', 'reprint'})

def _client_readonly_response():
    """Fresh 403 response for each request."""
    return JsonResponse(
        {'success': False, 'message': 'Cards in approved / download status cannot be modified by client users.'},
        status=403,
    )

def _is_client_readonly(user, card_status):
    """Return True when client/client_staff tries to modify a card in a locked status."""
    return user.role in ('client', 'client_staff') and card_status in _CLIENT_READONLY_STATUSES


# ==================== FIELD HELPERS (canonical: core.utils.field_utils) ====================
# Re-exported for backward compatibility within this view module.
# All new code should import directly from core.utils.field_utils.
from core.utils.field_utils import (
    validate_image_bytes,
    convert_class_value,
    convert_section_value,
    NUMERIC_TO_ROMAN,
    VALID_CLASS_VALUES,
    CLASS_UPGRADE_MAP,
)


# ==================== ID CARD TABLE API ENDPOINTS ====================

@require_http_methods(["POST"])
@api_require_permission('perm_idcard_setting_add')
def api_idcard_table_create(request, group_id):
    """API endpoint to create a new ID Card Table"""
    group, err = _check_client_scope_by_group(request.user, group_id)
    if err: return err
    try:
        data = json.loads(request.body)
        result = IDCardService.create_table(group_id, data)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_setting_list')
def api_idcard_table_get(request, table_id):
    """API endpoint to get a single ID Card Table"""
    table, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    result = IDCardService.get_table(table_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST", "PUT"])
@api_require_permission('perm_idcard_setting_edit')
def api_idcard_table_update(request, table_id):
    """API endpoint to update an ID Card Table"""
    table, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        data = json.loads(request.body)
        result = IDCardService.update_table(table_id, data)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["DELETE", "POST"])
@api_require_permission('perm_idcard_setting_delete')
def api_idcard_table_delete(request, table_id):
    """API endpoint to delete an ID Card Table"""
    table, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    result = IDCardService.delete_table(table_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_setting_status')
def api_idcard_table_toggle_status(request, table_id):
    """API endpoint to toggle ID Card Table active/inactive status"""
    table, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    result = IDCardService.toggle_table_status(table_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_setting_list')
def api_idcard_table_list(request, group_id):
    """API endpoint to list all ID Card Tables for a group"""
    group, err = _check_client_scope_by_group(request.user, group_id)
    if err: return err
    result = IDCardService.list_tables(group_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


# ==================== ID CARD API ENDPOINTS ====================

@require_http_methods(["GET"])
@api_require_any_authenticated
def api_idcard_list(request, table_id):
    """API endpoint to list ID Cards for a table with pagination support for lazy loading"""
    table, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    status_filter = request.GET.get('status', None)
    
    # Check status-specific list permission (via single authority)
    if status_filter:
        required_perm = PermissionService.STATUS_LIST_PERM_MAP.get(status_filter)
        if required_perm and not PermissionService.has(request.user, required_perm):
            return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    
    try:
        offset = max(0, int(request.GET.get('offset', 0)))
        limit = min(500, max(1, int(request.GET.get('limit', 100))))
    except (ValueError, TypeError):
        offset, limit = 0, 100
    
    result = IDCardService.list_cards(table_id, status_filter, offset, limit)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["GET"])
@api_require_any_authenticated
def api_idcard_all_ids(request, table_id):
    """API endpoint to get all card IDs for a table (for Select All functionality)"""
    table, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    status_filter = request.GET.get('status', None)
    
    # Check status-specific list permission (via single authority)
    if status_filter:
        required_perm = PermissionService.STATUS_LIST_PERM_MAP.get(status_filter)
        if required_perm and not PermissionService.has(request.user, required_perm):
            return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    
    result = IDCardService.get_all_card_ids(table_id, status_filter)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_add')
def api_idcard_create(request, table_id):
    """API endpoint to create a new ID Card with file upload support.

    View responsibility: parse HTTP request → delegate to IDCardService.
    """
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        # Parse field_data and image_files from either multipart or JSON
        if request.content_type and 'multipart/form-data' in request.content_type:
            field_data = json.loads(request.POST.get('field_data', '{}'))
            image_files = dict(request.FILES)
            legacy_photo_file = request.FILES.get('photo')
        else:
            data = json.loads(request.body)
            field_data = data.get('field_data', {})
            image_files = None
            legacy_photo_file = None

        result = IDCardService.create_card(
            table_id=table_id,
            field_data=field_data,
            image_files=image_files,
            uploaded_by=request.user if request.user.is_authenticated else None,
            legacy_photo_file=legacy_photo_file,
        )

        if result.success:
            return JsonResponse({
                'success': True,
                'message': result.message,
                'card': result.data['card'],
            })
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_info')
def api_idcard_get(request, card_id):
    """API endpoint to get a single ID Card"""
    card, err = _check_client_scope_by_card(request.user, card_id)
    if err: return err
    result = IDCardService.get_card(card_id)
    if result.success:
        return JsonResponse({'success': True, 'card': result.data['card']})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_http_methods(["POST", "PUT"])
@api_require_permission('perm_idcard_edit')
def api_idcard_update(request, card_id):
    """API endpoint to update an ID Card with file upload support.

    View responsibility: parse HTTP request, scope/readonly gates → delegate
    to IDCardService.update_card (which handles concurrency, images, save).
    """
    _card, err = _check_client_scope_by_card(request.user, card_id)
    if err: return err
    # Client/client_staff cannot edit cards in approved/download/reprint
    if _is_client_readonly(request.user, _card.status):
        return _client_readonly_response()
    try:
        # Parse request into service-friendly args
        if request.content_type and 'multipart/form-data' in request.content_type:
            field_data = json.loads(request.POST.get('field_data', '{}'))
            expected_updated_at = request.POST.get('expected_updated_at', None)
            image_files = dict(request.FILES)
            legacy_photo_file = request.FILES.get('photo')
        else:
            data = json.loads(request.body)
            field_data = data.get('field_data')
            expected_updated_at = data.get('expected_updated_at', None)
            image_files = None
            legacy_photo_file = None

        result = IDCardService.update_card(
            card_id=card_id,
            field_data=field_data,
            image_files=image_files,
            uploaded_by=request.user if request.user.is_authenticated else None,
            expected_updated_at=expected_updated_at,
            legacy_photo_file=legacy_photo_file,
        )

        if result.success:
            card_data = result.data['card']
            return JsonResponse({
                'success': True,
                'message': result.message,
                'card': {
                    'id': card_data['id'],
                    'field_data': card_data['field_data'],
                    'photo': card_data.get('photo'),
                    'status': card_data['status'],
                    'status_display': card_data.get('status_display'),
                    'updated_at': card_data.get('updated_at_iso'),
                }
            })

        # Concurrency conflict → 409
        if result.data and result.data.get('conflict'):
            return JsonResponse({
                'success': False,
                'message': result.message,
                'conflict': True,
                'server_updated_at': result.data['server_updated_at'],
            }, status=409)

        return JsonResponse({'success': False, 'message': result.message}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["DELETE", "POST"])
@api_require_permission('perm_idcard_delete')
def api_idcard_delete(request, card_id):
    """API endpoint to delete an ID Card"""
    _card, err = _check_client_scope_by_card(request.user, card_id)
    if err: return err
    # Client/client_staff cannot delete cards in approved/download/reprint
    if _is_client_readonly(request.user, _card.status):
        return _client_readonly_response()
    result = IDCardService.delete_card(card_id)
    return JsonResponse(
        {'success': result.success, 'message': result.message},
        status=200 if result.success else 400
    )


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_edit')
def api_idcard_update_field(request, card_id):
    """API endpoint to update a single field on an ID Card (for inline editing)"""
    _card, err = _check_client_scope_by_card(request.user, card_id)
    if err: return err
    # Client/client_staff cannot edit cards in approved/download/reprint
    if _is_client_readonly(request.user, _card.status):
        return _client_readonly_response()
    try:
        data = json.loads(request.body)
        field = data.get('field')
        value = data.get('value', '')
        
        result = IDCardService.update_single_field(card_id, field, value)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["POST"])
@api_require_any_authenticated
def api_idcard_change_status(request, card_id):
    """API endpoint to change an ID Card's status.
    
    Delegates entirely to WorkflowService.transition() which enforces:
    transition matrix, permissions, mandatory fields, image gate, client-readonly, activity log.
    """
    card, err = _check_client_scope_by_card(request.user, card_id)
    if err: return err
    try:
        data = json.loads(request.body)
        new_status = data.get('status')

        from ..services.workflow_service import WorkflowService
        result = WorkflowService.transition(card, new_status, user=request.user, request=request)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["POST"])
@api_require_any_authenticated
def api_idcard_bulk_status(request, table_id):
    """API endpoint to change status of multiple ID Cards.
    
    Delegates entirely to WorkflowService.bulk_transition() which enforces:
    transition matrix, permissions, mandatory fields, image gate, client-readonly, activity log.
    """
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        data = json.loads(request.body)
        card_ids = data.get('card_ids', [])
        new_status = data.get('status')
        
        if not new_status:
            return JsonResponse({'success': False, 'message': 'Status is required'}, status=400)
        if not card_ids:
            return JsonResponse({'success': False, 'message': 'No cards selected'}, status=400)

        from ..services.workflow_service import WorkflowService
        result = WorkflowService.bulk_transition(
            _tbl, card_ids, new_status, user=request.user, request=request
        )
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["POST"])
@api_require_any_authenticated
def api_idcard_bulk_delete(request, table_id):
    """API endpoint to delete multiple ID Cards.
    When delete_all=True, requires perm_delete_all_idcard + 6-digit confirmation_code.
    When delete_all=False (selected cards), requires perm_idcard_delete_from_pool.
    """
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        data = json.loads(request.body)
        card_ids = data.get('card_ids', [])
        delete_all = data.get('delete_all', False)
        
        if not delete_all and not card_ids:
            return JsonResponse({'success': False, 'message': 'No cards selected'}, status=400)
        
        # Check appropriate permission
        if delete_all:
            if not PermissionService.has(request.user, 'perm_delete_all_idcard'):
                return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
        else:
            if not PermissionService.has(request.user, 'perm_idcard_delete_from_pool'):
                return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
        
        # Secure confirmation for delete-all
        if delete_all:
            confirmation_code = data.get('confirmation_code', '')
            session_key = f'delete_all_code_{table_id}'
            expected_code = request.session.get(session_key)
            
            if not expected_code:
                return JsonResponse({
                    'success': False,
                    'message': 'No confirmation code generated. Please request a new code.'
                }, status=400)
            
            if str(confirmation_code) != str(expected_code):
                return JsonResponse({
                    'success': False,
                    'message': 'Invalid confirmation code. Delete aborted.'
                }, status=403)
            
            # Code verified — clear it so it can't be reused
            del request.session[session_key]
            request.session.modified = True
        
        result = IDCardService.bulk_delete(table_id, card_ids, delete_all)
        if result.success:
            count = result.data.get('deleted_count', len(card_ids))
            target_label = 'all cards' if delete_all else f'{count} card(s)'
            ActivityService.log_bulk_delete(request, target_label, count)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["POST"])
@api_require_permission('perm_delete_all_idcard')
def api_generate_delete_code(request, table_id):
    """Generate a 6-digit confirmation code for delete-all, stored in session."""
    import secrets
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        table = get_object_or_404(IDCardTable, id=table_id)
        total = IDCard.objects.filter(table=table).count()
        
        code = str(secrets.randbelow(900000) + 100000)
        request.session[f'delete_all_code_{table_id}'] = code
        request.session.modified = True
        
        return JsonResponse({
            'success': True,
            'code': code,
            'table_name': table.name,
            'total_cards': total,
        })
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_edit')
def api_generate_upgrade_code(request, table_id):
    """Generate a 6-digit confirmation code for upgrade-all-classes, stored in session."""
    import secrets
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        table = get_object_or_404(IDCardTable, id=table_id)
        download_count = IDCard.objects.filter(table=table, status='download').count()

        code = str(secrets.randbelow(900000) + 100000)
        request.session[f'upgrade_all_code_{table_id}'] = code
        request.session.modified = True

        return JsonResponse({
            'success': True,
            'code': code,
            'table_name': table.name,
            'download_count': download_count,
        })
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_edit')
def api_upgrade_all_classes(request, table_id):
    """
    Upgrade the class field value for all cards in the 'download' list.
    Each class value is bumped to the next level (e.g. V → VI).
    Cards already at XII remain unchanged.
    Only affects cards with status='download'.
    Requires 6-digit confirmation code.
    """
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        # Verify confirmation code (session validation stays in view — request-scoped)
        data = json.loads(request.body) if request.body else {}
        confirmation_code = data.get('confirmation_code', '')
        expected_code = request.session.get(f'upgrade_all_code_{table_id}', '')

        if not expected_code or confirmation_code != expected_code:
            return JsonResponse({
                'success': False,
                'message': 'Invalid or expired confirmation code. Please try again.'
            }, status=400)

        # Clear the code after use
        request.session.pop(f'upgrade_all_code_{table_id}', None)
        request.session.modified = True

        # Delegate to service layer
        result = IDCardService.upgrade_all_classes(table_id)
        if not result.success:
            return JsonResponse({'success': False, 'message': result.message}, status=400)

        if result.data.get('upgraded', 0) > 0:
            ActivityService.log_bulk_upgrade(
                request, result.data['upgraded'], result.data.get('client_name', '')
            )

        return JsonResponse({
            'success': True,
            'message': result.message,
            'upgraded': result.data['upgraded'],
            'skipped': result.data['skipped'],
            'total': result.data['total'],
        })
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["GET"])
@api_require_any_authenticated
def api_idcard_search(request, table_id):
    """API endpoint to search ID Cards across all statuses"""
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    query = request.GET.get('q', '').strip()
    result = IDCardService.search_cards(table_id, query)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["GET"])
@api_require_any_authenticated
def api_table_status_counts(request, table_id):
    """API endpoint to get status counts for a table"""
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        table = get_object_or_404(IDCardTable, id=table_id)
        status_counts = IDCardService.get_status_counts(table)
        
        return JsonResponse({
            'success': True,
            'status_counts': status_counts
        })
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_bulk_upload')
def api_idcard_bulk_upload(request, table_id):
    """API endpoint to bulk upload ID Cards from XLSX/CSV file with fuzzy matching and optional ZIP photo upload"""
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        import openpyxl
        from io import BytesIO
        import re
        import zipfile
        import os
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        
        table = get_object_or_404(IDCardTable, id=table_id)
        
        if 'file' not in request.FILES:
            return JsonResponse({'success': False, 'message': 'No file uploaded!'}, status=400)
        
        uploaded_file = request.FILES['file']
        file_name = uploaded_file.name.lower()
        file_size = uploaded_file.size
        
        # Get image field names from table using BaseService
        image_field_names = BaseService.get_image_field_names(table.fields)
        
        # Dictionary to store photos from each ZIP: { field_name: { filename: {bytes, ext} } }
        zip_photos_by_field = {}
        
        # Check for multiple ZIP files - one per image field
        # ZIP files are sent as photos_zip_FIELDNAME
        zip_field_names_str = request.POST.get('zip_field_names', '[]')
        try:
            zip_field_names = json.loads(zip_field_names_str)
        except (json.JSONDecodeError, TypeError):
            zip_field_names = []
        
        logger.debug("zip_field_names = %s", zip_field_names)
        logger.debug("request.FILES keys = %s", list(request.FILES.keys()))
        
        # Process each ZIP file for each image field
        for field_name in zip_field_names:
            zip_key = f'photos_zip_{field_name}'
            if zip_key in request.FILES:
                photos_zip_file = request.FILES[zip_key]
                zip_photos_by_field[field_name] = {}
                
                try:
                    zip_content = photos_zip_file.read()
                    with zipfile.ZipFile(BytesIO(zip_content), 'r') as zf:
                        for zip_info in zf.infolist():
                            if zip_info.is_dir():
                                continue
                            
                            file_in_zip = zip_info.filename
                            base_name = os.path.basename(file_in_zip)
                            name_without_ext = os.path.splitext(base_name)[0]
                            ext = os.path.splitext(base_name)[1].lower()
                            
                            if ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
                                try:
                                    image_bytes = zf.read(zip_info.filename)
                                    is_valid, error_msg = validate_image_bytes(image_bytes)
                                    if is_valid:
                                        # Use normalized key for robust case/whitespace-insensitive matching
                                        normalized_key = BaseService.normalize_image_identifier(name_without_ext)
                                        if normalized_key:
                                            # Deterministic: if duplicate key, keep alphabetically-first filename
                                            existing = zip_photos_by_field[field_name].get(normalized_key)
                                            if existing is None or base_name < existing['original_name']:
                                                zip_photos_by_field[field_name][normalized_key] = {
                                                    'bytes': image_bytes,
                                                    'ext': ext,
                                                    'original_name': base_name
                                                }
                                except Exception as img_read_err:
                                    continue
                except Exception as zip_error:
                    logger.debug("ZIP error for %s: %s", field_name, zip_error)
        
        logger.debug("zip_photos_by_field keys = %s", list(zip_photos_by_field.keys()))
        for k, v in zip_photos_by_field.items():
            logger.debug("Field '%s' has %d photos, first few keys: %s", k, len(v), list(v.keys())[:5])
        
        # Legacy: Also check for single photos_zip (backward compatibility)
        if not zip_photos_by_field and 'photos_zip' in request.FILES:
            photos_zip_file = request.FILES['photos_zip']
            # Assign to first image field
            first_image_field = image_field_names[0] if image_field_names else 'PHOTO'
            zip_photos_by_field[first_image_field] = {}
            
            try:
                zip_content = photos_zip_file.read()
                with zipfile.ZipFile(BytesIO(zip_content), 'r') as zf:
                    for zip_info in zf.infolist():
                        if zip_info.is_dir():
                            continue
                        
                        file_in_zip = zip_info.filename
                        base_name = os.path.basename(file_in_zip)
                        name_without_ext = os.path.splitext(base_name)[0]
                        ext = os.path.splitext(base_name)[1].lower()
                        
                        if ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
                            try:
                                image_bytes = zf.read(zip_info.filename)
                                is_valid, error_msg = validate_image_bytes(image_bytes)
                                if is_valid:
                                    # Use normalized key for robust matching
                                    normalized_key = BaseService.normalize_image_identifier(name_without_ext)
                                    if normalized_key:
                                        # Deterministic: if duplicate key, keep alphabetically-first filename
                                        existing = zip_photos_by_field[first_image_field].get(normalized_key)
                                        if existing is None or base_name < existing['original_name']:
                                            zip_photos_by_field[first_image_field][normalized_key] = {
                                                'bytes': image_bytes,
                                                'ext': ext,
                                                'original_name': base_name
                                            }
                            except Exception as img_read_err:
                                continue
            except Exception as zip_error:
                pass
        
        # NEW: Process unified ZIP files (images auto-matched to all columns)
        # This allows users to upload one or more ZIPs containing ALL images
        # which will be matched against any image column based on filename
        unified_zip_photos = {}  # Shared pool: { normalized_key: { bytes, ext, original_name } }
        
        try:
            unified_zip_count = int(request.POST.get('unified_zip_count', 0))
        except (ValueError, TypeError):
            unified_zip_count = 0
        
        # Cap to prevent resource exhaustion from user-supplied count
        unified_zip_count = min(unified_zip_count, 20)
        
        MAX_ZIP_IMAGES = 5000
        MAX_ZIP_TOTAL_BYTES = 500 * 1024 * 1024  # 500MB uncompressed total
        total_extracted_bytes = 0
        total_extracted_images = 0
        
        logger.debug("unified_zip_count = %d", unified_zip_count)
        
        for i in range(unified_zip_count):
            zip_key = f'unified_zip_{i}'
            if zip_key in request.FILES:
                try:
                    zip_file = request.FILES[zip_key]
                    zip_content = zip_file.read()
                    logger.debug("Processing unified ZIP %d: %s", i, zip_file.name)
                    
                    with zipfile.ZipFile(BytesIO(zip_content), 'r') as zf:
                        for zip_info in zf.infolist():
                            if zip_info.is_dir():
                                continue
                            
                            # ZIP bomb protection
                            if zip_info.file_size > 20 * 1024 * 1024:  # Skip files > 20MB
                                continue
                            if total_extracted_images >= MAX_ZIP_IMAGES:
                                break
                            if total_extracted_bytes + zip_info.file_size > MAX_ZIP_TOTAL_BYTES:
                                break
                            
                            file_in_zip = zip_info.filename
                            base_name = os.path.basename(file_in_zip)
                            name_without_ext = os.path.splitext(base_name)[0]
                            ext = os.path.splitext(base_name)[1].lower()
                            
                            if ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
                                try:
                                    image_bytes = zf.read(zip_info.filename)
                                    is_valid, error_msg = validate_image_bytes(image_bytes)
                                    if is_valid:
                                        normalized_key = BaseService.normalize_image_identifier(name_without_ext)
                                        if normalized_key:
                                            # Deterministic: if duplicate key, keep alphabetically-first filename
                                            existing = unified_zip_photos.get(normalized_key)
                                            if existing is None or base_name < existing['original_name']:
                                                unified_zip_photos[normalized_key] = {
                                                    'bytes': image_bytes,
                                                    'ext': ext,
                                                    'original_name': base_name
                                                }
                                except Exception:
                                    continue
                except Exception as e:
                    logger.debug("Error processing unified ZIP %d: %s", i, e)
        
        logger.debug("unified_zip_photos count = %d, first few keys: %s", len(unified_zip_photos), list(unified_zip_photos.keys())[:5] if unified_zip_photos else 'EMPTY')
        
        # Get client for ImageService operations
        client = table.group.client
        
        # Get all table fields using BaseService (text fields for matching, image fields to include with empty values)
        all_table_fields = table.fields
        table_fields = [f['name'] for f in all_table_fields if not BaseService.is_image_field(f)]
        image_fields = [f['name'] for f in all_table_fields if BaseService.is_image_field(f)]
        
        logger.debug("table_fields = %s", table_fields)
        logger.debug("image_fields = %s", image_fields)
        matched_field_names = []
        
        if file_name.endswith('.xlsx') or file_name.endswith('.xls'):
            # Process Excel file
            try:
                file_content = uploaded_file.read()
                
                # Check file magic bytes to detect actual format
                if len(file_content) < 4:
                    return JsonResponse({
                        'success': False, 
                        'message': 'File is too small or empty.'
                    }, status=400)
                
                magic_bytes = file_content[:4]
                is_zip = magic_bytes[:2] == b'PK'
                is_old_xls = (magic_bytes[0] == 0xD0 and magic_bytes[1] == 0xCF)
                
                headers = []
                rows_data = []
                
                if is_zip or file_name.endswith('.xlsx'):
                    # New .xlsx format - use openpyxl
                    try:
                        wb = openpyxl.load_workbook(BytesIO(file_content))
                        ws = wb.active
                        
                        # Get header row (first row)
                        for cell in ws[1]:
                            if cell.value:
                                headers.append(str(cell.value).strip())
                        
                        # Get data rows
                        for row in ws.iter_rows(min_row=2, values_only=True):
                            rows_data.append(row)
                    except Exception as xlsx_error:
                        # Maybe it's actually an old xls file with wrong extension
                        if not is_zip:
                            is_old_xls = True
                        else:
                            raise xlsx_error
                
                if is_old_xls or (file_name.endswith('.xls') and not file_name.endswith('.xlsx') and not headers):
                    # Old .xls format - use xlrd
                    try:
                        import xlrd
                        wb = xlrd.open_workbook(file_contents=file_content)
                        ws = wb.sheet_by_index(0)
                        
                        # Get header row (first row)
                        headers = []
                        for col_idx in range(ws.ncols):
                            cell_value = ws.cell_value(0, col_idx)
                            if cell_value:
                                headers.append(str(cell_value).strip())
                        
                        # Get data rows
                        rows_data = []
                        for row_idx in range(1, ws.nrows):
                            row = []
                            for col_idx in range(ws.ncols):
                                row.append(ws.cell_value(row_idx, col_idx))
                            rows_data.append(tuple(row))
                    except ImportError:
                        return JsonResponse({
                            'success': False, 
                            'message': 'xlrd library not installed. Please install it to support .xls files.'
                        }, status=400)
                    except Exception as xls_error:
                        return JsonResponse({
                            'success': False, 
                            'message': f'Error reading .xls file: {str(xls_error)}'
                        }, status=400)
                
                if not headers:
                    return JsonResponse({
                        'success': False, 
                        'message': 'Could not read headers from Excel file. Please check the file format.'
                    }, status=400)
                    
            except Exception as excel_error:
                return JsonResponse({
                    'success': False, 
                    'message': f'Error reading Excel file: {str(excel_error)}'
                }, status=400)
            
            # Map headers to table fields using fuzzy matching
            # Skip any headers that match image field names (those are for ZIP matching only)
            header_to_field = {}
            available_fields = table_fields.copy()
            
            # Track which column indices contain image reference values (like PHOTO column)
            image_ref_columns = {}
            unmatched_image_fields = list(image_fields)  # Track which image fields still need matching
            
            for idx, header in enumerate(headers):
                if not header:
                    continue
                
                # Try to match this header against unmatched image fields
                # Uses abbreviation expansion: F PHOTO -> FATHER PHOTO, M PHOTO -> MOTHER PHOTO, etc.
                matched_img_field = BaseService.find_best_image_field_match(header, unmatched_image_fields)
                if matched_img_field:
                    image_ref_columns[matched_img_field] = idx
                    unmatched_image_fields.remove(matched_img_field)
                    continue
                
                # Not an image field - try text field matching
                match = BaseService.find_best_field_match(header, available_fields)
                if match:
                    header_to_field[idx] = match
                    available_fields.remove(match)  # Don't match same field twice
                    matched_field_names.append(match)
            
            logger.debug("image_ref_columns = %s", image_ref_columns)
            logger.debug("header_to_field = %s", header_to_field)
            
            if not header_to_field:
                return JsonResponse({
                    'success': False, 
                    'message': f'No matching columns found! Expected columns: {", ".join(table_fields)}'
                }, status=400)
            
            # Initialize counters and error tracking
            cards_created = 0
            total_photos_matched = 0
            errors = []
            
            # Track all saved image paths for rollback cleanup on failure
            _saved_image_paths = []
            
            # Cap rows to prevent excessive uploads
            MAX_BULK_ROWS = 5000
            if len(rows_data) > MAX_BULK_ROWS:
                return JsonResponse({
                    'success': False,
                    'message': f'File has {len(rows_data)} rows. Maximum allowed is {MAX_BULK_ROWS}.'
                }, status=400)
            
            # Reverse rows so that the first Excel row gets the highest DB id.
            # Since the table is displayed newest-first (-id), this preserves Excel order:
            # Excel row 1 → highest id → shown first in table.
            rows_data = list(reversed(rows_data))
            
            # ── Pre-scan: detect duplicate photo keys ──────────────
            # If multiple rows reference the same filename for an image field,
            # it's ambiguous which row should own the image. Mark ALL of them
            # as PENDING so the user can assign manually.
            # _duplicate_keys[(img_field, normalized_key)] = True means "skip image save"
            from collections import Counter
            _photo_key_counts = {}  # { img_field: Counter({key: count}) }
            for _scan_row in rows_data:
                if all(cell is None or str(cell).strip() == '' for cell in _scan_row):
                    continue
                for _img_f in image_fields:
                    _col_idx = image_ref_columns.get(_img_f)
                    if _col_idx is None:
                        continue
                    if _col_idx < len(_scan_row):
                        _cv = _scan_row[_col_idx]
                        if _cv is not None and str(_cv).strip() and str(_cv).strip().lower() != 'none':
                            if isinstance(_cv, float) and _cv == int(_cv):
                                _cv = str(int(_cv))
                            elif isinstance(_cv, int):
                                _cv = str(_cv)
                            else:
                                _cv = str(_cv).strip()
                            _pk = BaseService.normalize_image_identifier(_cv)
                            if _pk:
                                if _img_f not in _photo_key_counts:
                                    _photo_key_counts[_img_f] = Counter()
                                _photo_key_counts[_img_f][_pk] += 1
            
            _duplicate_keys = set()
            for _img_f, _counter in _photo_key_counts.items():
                for _pk, _cnt in _counter.items():
                    if _cnt > 1:
                        _duplicate_keys.add((_img_f, _pk))
            
            if _duplicate_keys:
                logger.info("Bulk upload: %d duplicate photo keys found — those rows will be PENDING", len(_duplicate_keys))
            
            # Process data rows using rows_data collected earlier
            try:
              with transaction.atomic():
               for row_num, row in enumerate(rows_data, start=2):
                try:
                    # Skip empty rows
                    if all(cell is None or str(cell).strip() == '' for cell in row):
                        continue
                    
                    field_data = {}
                    for col_idx, field_name in header_to_field.items():
                        if col_idx < len(row):
                            value = row[col_idx]
                            if value is not None:
                                # Convert to string, handle dates and numbers
                                if hasattr(value, 'strftime'):
                                    # Already a datetime object
                                    value = value.strftime('%d-%m-%Y')
                                elif isinstance(value, float):
                                    # Check if it's an Excel date serial number (typically between 1 and 60000)
                                    # Excel dates start from 1900-01-01 (serial 1)
                                    if 1 < value < 60000 and ('date' in field_name.lower() or 'dob' in field_name.lower() or 'birth' in field_name.lower()):
                                        # Convert Excel serial date to actual date
                                        from datetime import datetime, timedelta
                                        # Excel's epoch is December 30, 1899
                                        excel_epoch = datetime(1899, 12, 30)
                                        actual_date = excel_epoch + timedelta(days=int(value))
                                        value = actual_date.strftime('%d-%m-%Y')
                                    elif value == int(value):
                                        # It's actually an integer (no decimal part)
                                        value = str(int(value)).upper()
                                    else:
                                        value = str(value).upper()
                                elif isinstance(value, int):
                                    # Check if it might be an Excel date serial for integer values
                                    if 1 < value < 60000 and ('date' in field_name.lower() or 'dob' in field_name.lower() or 'birth' in field_name.lower()):
                                        from datetime import datetime, timedelta
                                        excel_epoch = datetime(1899, 12, 30)
                                        actual_date = excel_epoch + timedelta(days=value)
                                        value = actual_date.strftime('%d-%m-%Y')
                                    else:
                                        value = str(value).upper()
                                else:
                                    value = str(value).strip().upper()  # Convert to uppercase
                                field_data[field_name] = value
                            else:
                                field_data[field_name] = ''
                        else:
                            field_data[field_name] = ''
                    
                    # Apply class/section value conversions for XLSX import
                    field_type_lookup = {f['name']: f['type'] for f in all_table_fields}
                    for fname in list(field_data.keys()):
                        ftype = field_type_lookup.get(fname, 'text')
                        if ftype == 'class' and field_data[fname]:
                            field_data[fname] = convert_class_value(field_data[fname])
                        elif ftype == 'section' and field_data[fname]:
                            field_data[fname] = convert_section_value(field_data[fname])
                    
                    # Process image fields - try to match with ZIP photos
                    photos_matched = 0
                    used_photo_keys_this_row = set()  # Prevent same image going to multiple columns
                    
                    for img_field in image_fields:
                        # Get the photo reference value ONLY from the mapped column
                        # No fallback — if this field has no column mapped, it stays empty
                        photo_column_value = None
                        
                        if img_field in image_ref_columns:
                            col_idx = image_ref_columns[img_field]
                            if col_idx < len(row):
                                cell_value = row[col_idx]
                                if cell_value is not None and str(cell_value).strip() and str(cell_value).strip().lower() != 'none':
                                    # Handle numeric values - convert float 1.0 to "1"
                                    if isinstance(cell_value, float) and cell_value == int(cell_value):
                                        photo_column_value = str(int(cell_value))
                                    elif isinstance(cell_value, int):
                                        photo_column_value = str(cell_value)
                                    else:
                                        photo_column_value = str(cell_value).strip()
                        # else: field not mapped to any XLSX column — leave empty
                        
                        # Try to match photo from ZIP using normalized matching
                        # This handles: case insensitivity, whitespace, numeric formats
                        field_zip_photos = zip_photos_by_field.get(img_field, {})
                        
                        # Normalize the Excel cell value for matching
                        photo_key = BaseService.normalize_image_identifier(photo_column_value) if photo_column_value else None
                        
                        # Prevent same image appearing in multiple columns within the same row
                        if photo_key and photo_key in used_photo_keys_this_row:
                            logger.warning("Row %d: photo_key '%s' already used by another field, skipping for '%s'",
                                          row_num, photo_key, img_field)
                            photo_key = None
                        
                        # Debug first few rows
                        if row_num <= 5:
                            logger.debug("Row %d: img_field='%s', photo_key='%s', field_zip_photos_keys=%s, unified_zip_keys=%s",
                                        row_num, img_field, photo_key,
                                        list(field_zip_photos.keys())[:5] if field_zip_photos else 'EMPTY',
                                        list(unified_zip_photos.keys())[:5] if unified_zip_photos else 'EMPTY')
                        
                        # Try to find photo in: 1) field-specific ZIP, 2) unified ZIP pool
                        photo_info = None
                        if photo_key:
                            if field_zip_photos and photo_key in field_zip_photos:
                                photo_info = field_zip_photos[photo_key]
                            elif unified_zip_photos and photo_key in unified_zip_photos:
                                photo_info = unified_zip_photos[photo_key]
                            if photo_info:
                                used_photo_keys_this_row.add(photo_key)  # Claim this key
                        
                        # If this key is used by multiple rows, skip saving — all get PENDING
                        if photo_key and (img_field, photo_key) in _duplicate_keys:
                            field_data[img_field] = f'PENDING:{photo_column_value}'
                        elif photo_info:
                            try:
                                # Use ImageService.save_new_image (single authority)
                                cards_created += 1  # Increment before for 1-based counter
                                original_ext = photo_info['ext']
                                
                                result = ImageService.save_new_image(
                                    image_bytes=photo_info['bytes'],
                                    client=client,
                                    field_name=img_field,
                                    card=None,  # card not yet created
                                    batch_counter=cards_created,
                                    original_ext=original_ext,
                                )
                                
                                if result.success and result.data.get('final_value'):
                                    saved_path = result.data['final_value']
                                    _saved_image_paths.append(saved_path)
                                    field_data[img_field] = saved_path
                                    photos_matched += 1
                                    total_photos_matched += 1
                                else:
                                    field_data[img_field] = ''
                                    logger.warning("Bulk upload image save failed: %s", result.message)
                                cards_created -= 1  # Revert since we incremented early
                            except Exception as photo_error:
                                # Log but don't break the whole process
                                logger.error("Error saving photo (XLSX) for %s: %s", photo_column_value, photo_error)
                                # Save as PENDING so it can be reuploaded later
                                if photo_column_value:
                                    field_data[img_field] = f'PENDING:{photo_column_value}'
                                else:
                                    field_data[img_field] = ''
                        else:
                            # No image in ZIP but has reference value - save as PENDING for later reupload
                            if photo_column_value:
                                field_data[img_field] = f'PENDING:{photo_column_value}'
                            else:
                                # No reference value at all - empty field
                                field_data[img_field] = ''
                    
                    # Create the card
                    card = IDCard.objects.create(
                        table=table,
                        field_data=field_data,
                        status=WorkflowService.INITIAL_STATUS
                    )
                    cards_created += 1
                    
                    # DUAL-WRITE: Create CardMedia records for bulk-uploaded images
                    for img_field in image_fields:
                        img_path = field_data.get(img_field, '')
                        if img_path and not img_path.startswith('PENDING:') and img_path not in ['', 'NOT_FOUND']:
                            try:
                                ImageService.create_media_record(
                                    saved_path=img_path,
                                    client=client,
                                    card=card,
                                    field_name=img_field,
                                    media_type='photo',
                                    original_filename=None,
                                    uploaded_by=request.user if request.user.is_authenticated else None
                                )
                            except Exception as media_err:
                                logger.warning("Failed to create CardMedia for bulk %s: %s", img_field, media_err)
                    
                except Exception as e:
                    errors.append(f'Row {row_num}: {str(e)}')
            except Exception as atomic_err:
                # Transaction rolled back — clean up orphaned image files saved to disk
                logger.error("Bulk upload transaction failed, cleaning up %d images: %s",
                             len(_saved_image_paths), atomic_err)
                for orphan_path in _saved_image_paths:
                    try:
                        ImageService.delete_image(orphan_path)
                    except Exception:
                        pass
                raise  # Re-raise so the outer try/except returns error response
        
        elif file_name.endswith('.csv'):
            import csv
            from io import StringIO
            
            # Read CSV
            content = uploaded_file.read().decode('utf-8-sig')
            reader = csv.DictReader(StringIO(content))
            
            # Map CSV headers to table fields using fuzzy matching
            csv_headers = reader.fieldnames or []
            header_to_field = {}
            available_fields = table_fields.copy()
            
            # Track image reference columns for CSV
            csv_image_ref_columns = {}
            csv_unmatched_image_fields = list(image_fields)  # Track which image fields still need matching
            
            for header in csv_headers:
                if not header:
                    continue
                
                # Try to match this header against unmatched image fields
                # Uses abbreviation expansion: F PHOTO -> FATHER PHOTO, M PHOTO -> MOTHER PHOTO, etc.
                matched_img_field = BaseService.find_best_image_field_match(header, csv_unmatched_image_fields)
                if matched_img_field:
                    csv_image_ref_columns[matched_img_field] = header
                    csv_unmatched_image_fields.remove(matched_img_field)
                    continue
                
                # Not an image field - try text field matching
                match = BaseService.find_best_field_match(header.strip(), available_fields)
                if match:
                    header_to_field[header] = match
                    available_fields.remove(match)
                    matched_field_names.append(match)
            
            if not header_to_field:
                return JsonResponse({
                    'success': False, 
                    'message': f'No matching columns found! Expected columns: {", ".join(table_fields)}'
                }, status=400)
            
            # Initialize counters and error tracking for CSV
            cards_created = 0
            total_photos_matched = 0
            errors = []
            
            # Collect all CSV rows and reverse so first Excel row gets highest DB id
            # (preserves Excel order when displayed newest-first)
            csv_rows = list(reader)
            csv_rows = list(reversed(csv_rows))
            
            # Cap rows to prevent excessive uploads
            MAX_BULK_ROWS = 5000
            if len(csv_rows) > MAX_BULK_ROWS:
                return JsonResponse({
                    'success': False,
                    'message': f'File has {len(csv_rows)} rows. Maximum allowed is {MAX_BULK_ROWS}.'
                }, status=400)
            
            with transaction.atomic():
              for row_num, row in enumerate(csv_rows, start=2):
                try:
                    # Skip empty rows
                    if all(not v or str(v).strip() == '' for v in row.values()):
                        continue
                    
                    field_data = {}
                    for csv_header, field_name in header_to_field.items():
                        value = row.get(csv_header, '')
                        field_data[field_name] = str(value).strip().upper() if value else ''  # Convert to uppercase
                    
                    # Apply class/section value conversions for CSV import
                    field_type_lookup = {f['name']: f['type'] for f in all_table_fields}
                    for fname in list(field_data.keys()):
                        ftype = field_type_lookup.get(fname, 'text')
                        if ftype == 'class' and field_data[fname]:
                            field_data[fname] = convert_class_value(field_data[fname])
                        elif ftype == 'section' and field_data[fname]:
                            field_data[fname] = convert_section_value(field_data[fname])
                    
                    # Process image fields - try to match with ZIP photos
                    photos_matched = 0
                    used_photo_keys_this_row = set()  # Prevent same image going to multiple columns
                    
                    for img_field in image_fields:
                        # Get the photo reference value ONLY from the mapped column
                        # No fallback — if this field has no column mapped, it stays empty
                        photo_column_value = None
                        
                        if img_field in csv_image_ref_columns:
                            csv_header = csv_image_ref_columns[img_field]
                            cell_value = row.get(csv_header, '')
                            if cell_value and str(cell_value).strip():
                                # CASE SENSITIVE - do NOT convert to uppercase
                                photo_column_value = str(cell_value).strip()
                        # else: field not mapped to any CSV column — leave empty
                        
                        # Try to match photo from ZIP using normalized matching
                        # This handles: case insensitivity, whitespace, numeric formats
                        field_zip_photos = zip_photos_by_field.get(img_field, {})
                        
                        # Normalize the CSV cell value for matching
                        photo_key = BaseService.normalize_image_identifier(photo_column_value) if photo_column_value else None
                        
                        # Prevent same image appearing in multiple columns within the same row
                        if photo_key and photo_key in used_photo_keys_this_row:
                            logger.warning("CSV Row %d: photo_key '%s' already used by another field, skipping for '%s'",
                                          row_num, photo_key, img_field)
                            photo_key = None
                        
                        # Try to find photo in: 1) field-specific ZIP, 2) unified ZIP pool
                        photo_info = None
                        if photo_key:
                            if field_zip_photos and photo_key in field_zip_photos:
                                photo_info = field_zip_photos[photo_key]
                            elif unified_zip_photos and photo_key in unified_zip_photos:
                                photo_info = unified_zip_photos[photo_key]
                            if photo_info:
                                used_photo_keys_this_row.add(photo_key)  # Claim this key
                        
                        if photo_info:
                            try:
                                # Use ImageService.save_new_image (single authority)
                                cards_created += 1  # Increment before for 1-based counter
                                original_ext = photo_info['ext']
                                
                                result = ImageService.save_new_image(
                                    image_bytes=photo_info['bytes'],
                                    client=client,
                                    field_name=img_field,
                                    card=None,  # card not yet created
                                    batch_counter=cards_created,
                                    original_ext=original_ext,
                                )
                                
                                if result.success and result.data.get('final_value'):
                                    saved_path = result.data['final_value']
                                    field_data[img_field] = saved_path
                                    photos_matched += 1
                                    total_photos_matched += 1
                                else:
                                    field_data[img_field] = ''
                                    logger.warning("Bulk upload image save failed: %s", result.message)
                                cards_created -= 1  # Revert since we incremented early
                            except Exception as photo_error:
                                # Log but don't break the whole process
                                logger.error("Error saving photo (CSV) for %s: %s", photo_column_value, photo_error)
                                # Save as PENDING so it can be reuploaded later
                                if photo_column_value:
                                    field_data[img_field] = f'PENDING:{photo_column_value}'
                                else:
                                    field_data[img_field] = ''
                        else:
                            # No image in ZIP but has reference value - save as PENDING for later reupload
                            if photo_column_value:
                                field_data[img_field] = f'PENDING:{photo_column_value}'
                            else:
                                # No reference value at all - empty field
                                field_data[img_field] = ''
                    
                    # Create the card
                    card = IDCard.objects.create(
                        table=table,
                        field_data=field_data,
                        status=WorkflowService.INITIAL_STATUS
                    )
                    cards_created += 1
                    
                    # DUAL-WRITE: Create CardMedia records for CSV bulk-uploaded images
                    for img_field in image_fields:
                        img_path = field_data.get(img_field, '')
                        if img_path and not img_path.startswith('PENDING:') and img_path not in ['', 'NOT_FOUND']:
                            try:
                                ImageService.create_media_record(
                                    saved_path=img_path,
                                    client=client,
                                    card=card,
                                    field_name=img_field,
                                    media_type='photo',
                                    original_filename=None,
                                    uploaded_by=request.user if request.user.is_authenticated else None
                                )
                            except Exception as media_err:
                                logger.warning("Failed to create CardMedia for CSV bulk %s: %s", img_field, media_err)
                    
                except Exception as e:
                    errors.append(f'Row {row_num}: {str(e)}')
        
        else:
            return JsonResponse({
                'success': False, 
                'message': 'Invalid file format! Please upload .xlsx, .xls, or .csv file.'
            }, status=400)
        
        # Return result
        photo_msg = f" with {total_photos_matched} photos matched" if total_photos_matched > 0 else ""
        result = {
            'success': True,
            'message': f'Successfully created {cards_created} ID cards{photo_msg}!',
            'cards_created': cards_created,
            'photos_matched': total_photos_matched,
            'matched_fields': matched_field_names,
        }
        
        if errors:
            result['errors'] = errors[:10]  # Return first 10 errors only
            result['error_count'] = len(errors)
        
        return JsonResponse(result)
        
    except ImportError:
        return JsonResponse({
            'success': False, 
            'message': 'openpyxl library not installed. Run: pip install openpyxl'
        }, status=500)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@require_http_methods(["POST"])
@api_require_permission('perm_reupload_idcard_image')
def api_idcard_reupload_images(request, table_id):
    """
    API endpoint to reupload images from a ZIP file.
    Matches ZIP filenames to card image references (PENDING: or existing paths) and updates them.
    
    Supports:
    - PENDING:reference matching (for cards created without images)
    - Existing image path updates (applies edit naming: original_14 + _HHMMSS)
    - Multiple image fields per card
    - Thumbnail generation for all saved images
    """
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    # Client/client_staff cannot reupload images for tables with approved/download/reprint cards
    if request.user.role in ('client', 'client_staff'):
        has_locked = IDCard.objects.filter(
            table_id=table_id, status__in=_CLIENT_READONLY_STATUSES
        ).exists()
        if has_locked:
            return JsonResponse({
                'success': False,
                'message': 'This table contains cards in approved/download status. Client users cannot reupload images.'
            }, status=403)
    try:
        import zipfile
        from django.db import transaction
        
        table = get_object_or_404(IDCardTable, id=table_id)
        client = table.group.client
        
        if 'photos_zip' not in request.FILES:
            return JsonResponse({'success': False, 'message': 'No ZIP file uploaded!'}, status=400)
        
        # Get image field names from table
        image_field_names = BaseService.get_image_field_names(table.fields)
        if not image_field_names:
            return JsonResponse({'success': False, 'message': 'No image fields defined in table!'}, status=400)
        
        # Get target field from request (optional - defaults to first image field)
        target_field = request.POST.get('target_field', image_field_names[0])
        if target_field not in image_field_names:
            target_field = image_field_names[0]
        
        # Extract photos from ZIP — use temp file if available (avoids OOM on large uploads)
        zip_photos = {}  # { normalized_key: { bytes, ext, original_name } }
        
        try:
            zip_file = request.FILES['photos_zip']

            # Open ZIP directly from file handle (Django spills >10MB to /tmp)
            if hasattr(zip_file, 'temporary_file_path'):
                zf = zipfile.ZipFile(zip_file.temporary_file_path(), 'r')
            else:
                zip_file.seek(0)
                zf = zipfile.ZipFile(zip_file, 'r')

            with zf:
                for zip_info in zf.infolist():
                    if zip_info.is_dir():
                        continue
                    
                    file_in_zip = zip_info.filename
                    base_name = os.path.basename(file_in_zip)
                    name_without_ext = os.path.splitext(base_name)[0]
                    ext = os.path.splitext(base_name)[1].lower()
                    
                    if ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
                        try:
                            image_bytes = zf.read(zip_info.filename)
                            is_valid, error_msg = validate_image_bytes(image_bytes)
                            if is_valid:
                                normalized_key = BaseService.normalize_image_identifier(name_without_ext)
                                if normalized_key:
                                    # Deterministic: if duplicate key, keep alphabetically-first filename
                                    existing = zip_photos.get(normalized_key)
                                    if existing is None or base_name < existing['original_name']:
                                        zip_photos[normalized_key] = {
                                            'bytes': image_bytes,
                                            'ext': ext,
                                            'original_name': base_name
                                        }
                        except Exception:
                            continue
        except Exception as zip_error:
            return JsonResponse({'success': False, 'message': f'Error reading ZIP file: {str(zip_error)}'}, status=400)
        
        if not zip_photos:
            return JsonResponse({'success': False, 'message': 'No valid images found in ZIP file!'}, status=400)
        
        logger.debug("Reupload: %d images extracted from ZIP, keys: %s", len(zip_photos), list(zip_photos.keys())[:10])
        
        # Get cards — scoped to selected IDs if provided, else all in table for current status
        card_ids = []
        if 'card_ids' in request.POST:
            try:
                card_ids = json.loads(request.POST.get('card_ids', '[]'))
            except (json.JSONDecodeError, TypeError):
                card_ids = []
        
        # Filter out empty/falsy values
        card_ids = [int(cid) for cid in card_ids if cid and str(cid).strip().isdigit()] if card_ids else []
        
        if card_ids:
            cards = IDCard.objects.filter(table=table, id__in=card_ids).order_by('id')
        else:
            # No specific IDs — reupload to ALL cards in this table (filtered by status if provided)
            status_filter = request.POST.get('status', '')
            if status_filter and status_filter in BaseService.VALID_STATUSES:
                cards = IDCard.objects.filter(table=table, status=status_filter).order_by('id')
            else:
                cards = IDCard.objects.filter(table=table).order_by('id')
        
        updated_count = 0
        matched_count = 0
        errors = []
        
        with transaction.atomic():
            batch_counter = 0
            
            for card in cards:
                field_data = card.field_data or {}
                card_updated = False
                
                for img_field in image_field_names:
                    current_value = field_data.get(img_field, '')
                    
                    # Determine what to match against
                    match_key = None
                    existing_path = None
                    
                    if current_value.startswith('PENDING:'):
                        # Extract the reference from PENDING:reference
                        match_key = BaseService.normalize_image_identifier(current_value[8:])
                    elif current_value and current_value not in ('NOT_FOUND', ''):
                        # Has existing image - extract filename for matching
                        existing_path = current_value
                        existing_filename = os.path.splitext(os.path.basename(current_value))[0]
                        match_key = BaseService.normalize_image_identifier(existing_filename)
                    else:
                        # No current value - skip unless we want to match by card data
                        # Could extend to match by NAME or other field values
                        continue
                    
                    if not match_key:
                        continue
                    
                    # Try to find matching photo in ZIP
                    if match_key in zip_photos:
                        photo_info = zip_photos[match_key]
                        matched_count += 1
                        
                        try:
                            batch_counter += 1
                            
                            # Use single-authority entry point
                            if existing_path:
                                result = ImageService.replace_image(
                                    image_bytes=photo_info['bytes'],
                                    client=client,
                                    field_name=img_field,
                                    existing_path=existing_path,
                                    card=card,
                                    batch_counter=batch_counter,
                                    original_ext=photo_info['ext'],
                                )
                            else:
                                result = ImageService.save_new_image(
                                    image_bytes=photo_info['bytes'],
                                    client=client,
                                    field_name=img_field,
                                    card=card,
                                    batch_counter=batch_counter,
                                    original_ext=photo_info['ext'],
                                )
                            
                            if result.success and result.data.get('final_value'):
                                field_data[img_field] = result.data['final_value']
                                card_updated = True
                                logger.debug("Reupload: Card %s field %s updated to %s", 
                                           card.pk, img_field, result.data['final_value'])
                            else:
                                errors.append(f"Card {card.pk}: Failed to save {img_field} - {result.message}")
                        except Exception as save_err:
                            errors.append(f"Card {card.pk}: Error saving {img_field} - {str(save_err)}")
                
                if card_updated:
                    card.field_data = field_data
                    card.save()
                    updated_count += 1
        
        # Build response
        result_msg = f"Updated {updated_count} cards with {matched_count} images matched"
        response = {
            'success': True,
            'message': result_msg,
            'updated_count': updated_count,
            'matched_count': matched_count,
            'zip_images_count': len(zip_photos),
        }
        
        if errors:
            response['errors'] = errors[:10]
            response['error_count'] = len(errors)
        
        return JsonResponse(response)
        
    except Exception as e:
        logger.error("Reupload error: %s", e)
        return JsonResponse({'success': False, 'message': str(e)}, status=400)

