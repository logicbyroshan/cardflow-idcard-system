"""
Staff API Views
Contains: All staff-related API endpoints (CRUD, toggle status, active clients list)
"""
import json
import logging
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from ..services.permission_service import api_require_super_admin
from ..services import StaffService
from ..services.activity_service import ActivityService
from client.models import Client
from staff.models import Staff
from accounts.rate_limit import rate_limit
from mediafiles.utils import normalize_uploaded_image

logger = logging.getLogger(__name__)


MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_UPLOAD_MIMES = {
    'image/jpeg', 'image/png', 'image/webp',
    'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
}
ALLOWED_IMAGE_UPLOAD_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.hei'}


def _parse_json_object(request):
    """Parse request JSON and require an object payload."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None, JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)

    if not isinstance(data, dict):
        return None, JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)

    return data, None


def _validate_optional_image_upload(uploaded):
    """Validate optional profile image upload."""
    if not uploaded:
        return None, None

    normalized_upload, error_message = normalize_uploaded_image(
        uploaded,
        max_bytes=MAX_IMAGE_UPLOAD_BYTES,
        allowed_extensions=ALLOWED_IMAGE_UPLOAD_EXTS,
        allowed_mime_types=ALLOWED_IMAGE_UPLOAD_MIMES,
    )
    if error_message:
        return None, JsonResponse({'success': False, 'message': error_message}, status=400)
    return normalized_upload, None


def _admin_staff_assignment_snapshot(staff_obj):
    if not staff_obj:
        return {
            'client_ids': [],
            'group_ids': [],
            'table_ids': [],
            'classes': [],
            'sections': [],
            'branches': [],
            'scope_count': 0,
        }
    return {
        'client_ids': list(staff_obj.assigned_clients.values_list('id', flat=True)),
        'group_ids': [],
        'table_ids': [],
        'classes': [],
        'sections': [],
        'branches': [],
        'scope_count': 0,
    }


@require_http_methods(["POST"])
@api_require_super_admin
@rate_limit(max_requests=10, window_seconds=60, key_prefix='staff_create')
def api_staff_create(request):
    """API endpoint to create a new admin staff"""
    try:
        # Check if it's a multipart form (file upload) or JSON
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = dict(request.POST)
            # Convert QueryDict lists to single values
            data = {k: v[0] if isinstance(v, list) and len(v) == 1 else v for k, v in data.items()}
            profile_image = request.FILES.get('profile_image')
        else:
            data, json_err = _parse_json_object(request)
            if json_err:
                return json_err
            profile_image = None

        profile_image, file_error = _validate_optional_image_upload(profile_image)
        if file_error:
            return file_error
        
        result = StaffService.create(
            data, 
            staff_type='admin_staff', 
            request=request, 
            profile_image=profile_image
        )
        
        response_data = result.to_response_dict()
        # Add email_sent at top level for JS compatibility
        if result.success and 'email_sent' in result.data:
            response_data['email_sent'] = result.data['email_sent']

        if result.success:
            created_staff_id = ((result.data or {}).get('staff') or {}).get('id')
            if created_staff_id:
                try:
                    created_staff = (
                        Staff.objects
                        .filter(id=created_staff_id, staff_type='admin_staff')
                        .select_related('user')
                        .prefetch_related('assigned_clients')
                        .first()
                    )
                    if created_staff:
                        ActivityService.log_staff_create(request, created_staff)
                        ActivityService.log_staff_assignment_change(
                            request,
                            created_staff,
                            before_snapshot={},
                            after_snapshot=_admin_staff_assignment_snapshot(created_staff),
                            reason='created',
                        )
                except Exception:
                    logger.exception('Failed to log admin staff create timeline for staff_id=%s', created_staff_id)
        
        return JsonResponse(response_data, status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)
    except Exception as e:
        logger.exception("Staff API error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)


@require_http_methods(["GET"])
@api_require_super_admin
@rate_limit(max_requests=60, window_seconds=60, key_prefix='staff_get')
def api_staff_get(request, staff_id):
    """API endpoint to get a staff's details"""
    result = StaffService.get(staff_id, include_permissions=True)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["PUT", "POST"])
@api_require_super_admin
def api_staff_update(request, staff_id):
    """API endpoint to update a staff"""
    try:
        before_staff = (
            Staff.objects
            .filter(id=staff_id, staff_type='admin_staff')
            .select_related('user')
            .prefetch_related('assigned_clients')
            .first()
        )
        before_assignment_snapshot = _admin_staff_assignment_snapshot(before_staff)

        # Check if it's a multipart form (file upload) or JSON
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = dict(request.POST)
            # Convert QueryDict lists to single values
            data = {k: v[0] if isinstance(v, list) and len(v) == 1 else v for k, v in data.items()}
            profile_image = request.FILES.get('profile_image')
        else:
            data, json_err = _parse_json_object(request)
            if json_err:
                return json_err
            profile_image = None

        profile_image, file_error = _validate_optional_image_upload(profile_image)
        if file_error:
            return file_error
        
        result = StaffService.update(staff_id, data, profile_image=profile_image)

        if result.success:
            try:
                refreshed = (
                    Staff.objects
                    .filter(id=staff_id, staff_type='admin_staff')
                    .select_related('user')
                    .prefetch_related('assigned_clients')
                    .first()
                )
                if refreshed:
                    ActivityService.log_staff_update(request, refreshed)
                    ActivityService.log_staff_assignment_change(
                        request,
                        refreshed,
                        before_snapshot=before_assignment_snapshot,
                        after_snapshot=_admin_staff_assignment_snapshot(refreshed),
                        reason='updated',
                    )
            except Exception:
                logger.exception('Failed to log admin staff update timeline for staff_id=%s', staff_id)

        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)
    except Exception as e:
        logger.exception("Staff API error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)


@require_http_methods(["DELETE", "POST"])
@api_require_super_admin
@rate_limit(max_requests=5, window_seconds=60, key_prefix='staff_delete')
def api_staff_delete(request, staff_id):
    """API endpoint to delete a staff"""
    result = StaffService.delete(staff_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST"])
@api_require_super_admin
def api_staff_toggle_status(request, staff_id):
    """API endpoint to toggle staff active/inactive status"""
    result = StaffService.toggle_status(staff_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["GET"])
@api_require_super_admin
def api_active_clients_list(request):
    """API endpoint to get list of active clients for staff assignment dropdown"""
    clients = Client.objects.filter(status='active', is_guest=False).order_by('name').values('id', 'name')
    return JsonResponse({
        'success': True,
        'clients': list(clients)
    })


@require_http_methods(["GET"])
@api_require_super_admin
def api_all_clients_for_assignment(request):
    """API endpoint to get ALL clients (active + inactive) for staff assignment dropdown.
    Super admin can assign any client to admin staff, regardless of status."""
    clients = Client.objects.filter(is_guest=False).order_by('status', 'name').values('id', 'name', 'status')
    return JsonResponse({
        'success': True,
        'clients': list(clients)
    })


@require_http_methods(["POST"])
@api_require_super_admin
@rate_limit(max_requests=5, window_seconds=60, key_prefix='staff_temp_pw')
def api_staff_set_temp_password(request, staff_id):
    """API endpoint to set a temporary password for a staff member (Super Admin only)"""
    try:
        data, json_err = _parse_json_object(request)
        if json_err:
            return json_err
        new_password = data.get('password', '').strip()
        if not new_password:
            return JsonResponse({'success': False, 'message': 'Password is required'}, status=400)
        if len(new_password) < 8:
            return JsonResponse({'success': False, 'message': 'Password must be at least 8 characters'}, status=400)

        # Validate against Django password validators
        from django.contrib.auth.password_validation import validate_password
        try:
            validate_password(new_password)
        except Exception as validation_error:
            return JsonResponse({'success': False, 'message': '; '.join(validation_error.messages)}, status=400)

        result = StaffService.set_temp_password(staff_id, new_password, request=request)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)
    except Exception as e:
        logger.exception("Staff temp password error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)