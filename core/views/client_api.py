"""
Client API Views
Contains: All client-related API endpoints (CRUD, toggle status, get staff)
"""
import json
import logging
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from ..services import ClientService
from ..services.activity_service import ActivityService
from ..services.permission_service import (
    PermissionService,
    api_require_any_admin,
    api_require_super_admin,
)
from accounts.rate_limit import rate_limit

logger = logging.getLogger(__name__)


def _check_admin_staff_client_access(user, client_id):
    """Check if user has access to a specific client. Delegates to PermissionService."""
    return PermissionService.can_access_client(user, client_id)


@require_http_methods(["POST"])
@api_require_super_admin
@rate_limit(max_requests=10, window_seconds=60, key_prefix='client_create')
def api_client_create(request):
    """API endpoint to create a new client"""
    try:
        # Check if it's a multipart form (file upload) or JSON
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = dict(request.POST)
            # Convert QueryDict lists to single values
            data = {k: v[0] if isinstance(v, list) and len(v) == 1 else v for k, v in data.items()}
            photo = request.FILES.get('photo')
        else:
            data = json.loads(request.body)
            photo = None
        
        result = ClientService.create(data, request=request, photo=photo)
        
        if result.success:
            client_name = data.get('name', data.get('school_name', 'client'))
            client_id_val = result.data.get('client_id') or result.data.get('id')
            ActivityService.log_client_create(request, type('Obj', (), {'name': client_name, 'pk': client_id_val})())
        
        response_data = result.to_response_dict()
        # Add email_sent at top level for JS compatibility
        if result.success and 'email_sent' in result.data:
            response_data['email_sent'] = result.data['email_sent']
        
        return JsonResponse(response_data, status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)
    except Exception as e:
        logger.exception("Client API error (create): %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)


@require_http_methods(["GET"])
@api_require_any_admin
def api_client_get(request, client_id):
    """API endpoint to get a client's details"""
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    result = ClientService.get(client_id, include_permissions=True)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["PUT", "POST"])
@api_require_any_admin
def api_client_update(request, client_id):
    """API endpoint to update a client"""
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    try:
        # Check if it's a multipart form (file upload) or JSON
        if request.content_type and 'multipart/form-data' in request.content_type:
            data = dict(request.POST)
            # Convert QueryDict lists to single values
            data = {k: v[0] if isinstance(v, list) and len(v) == 1 else v for k, v in data.items()}
            photo = request.FILES.get('photo')
        else:
            data = json.loads(request.body)
            photo = None
        
        # Non-super-admin users cannot modify client permissions
        if not PermissionService.is_super_admin(request.user):
            for perm in ClientService.PERMISSION_FIELDS:
                data.pop(perm, None)
        
        result = ClientService.update(client_id, data, photo=photo)
        if result.success:
            client_name = data.get('name', data.get('school_name', ''))
            if client_name:
                ActivityService.log_client_update(request, type('Obj', (), {'name': client_name, 'pk': client_id})())
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)
    except Exception as e:
        logger.exception("Client API error (update): %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)


@require_http_methods(["DELETE", "POST"])
@api_require_super_admin
@rate_limit(max_requests=5, window_seconds=60, key_prefix='client_delete')
def api_client_delete(request, client_id):
    """API endpoint to delete a client (Super Admin only)"""
    # Get client name before deletion for the activity log
    from ..models import Client
    try:
        client_obj = Client.objects.get(pk=client_id)
        client_name = client_obj.name
    except Client.DoesNotExist:
        client_name = 'Unknown'
    result = ClientService.delete(client_id)
    if result.success:
        ActivityService.log_client_delete(request, client_name, client_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST"])
@api_require_super_admin
def api_client_toggle_status(request, client_id):
    """API endpoint to toggle client active/inactive status (Super Admin only)"""
    result = ClientService.toggle_status(client_id)
    if result.success:
        new_status = result.data.get('new_status', result.data.get('status', ''))
        client_name = result.data.get('client_name', result.data.get('name', ''))
        ActivityService.log_client_status(
            request,
            type('Obj', (), {'name': client_name, 'pk': client_id})(),
            new_status,
        )
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["GET"])
@api_require_any_admin
def api_client_staff(request, client_id):
    """API endpoint to get all staff members for a specific client"""
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    result = ClientService.get_staff(client_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST"])
@api_require_super_admin
def api_client_staff_toggle_status(request, client_id, staff_id):
    """
    API endpoint for Super Admin to toggle client staff active/inactive status.
    Validates that the staff belongs to the specified client.
    """
    result = ClientService.toggle_client_staff_status(client_id, staff_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["PUT", "POST"])
@api_require_super_admin
@rate_limit(max_requests=10, window_seconds=60, key_prefix='staff_perm')
def api_client_staff_permissions(request, client_id, staff_id):
    """
    API endpoint for Super Admin to update client staff permissions.
    Super Admin can override any permission as long as it doesn't exceed client's permissions.
    """
    try:
        data = json.loads(request.body)
        result = ClientService.update_client_staff_permissions(client_id, staff_id, data)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)


@require_http_methods(["POST"])
@api_require_super_admin
@rate_limit(max_requests=5, window_seconds=60, key_prefix='client_temp_pw')
def api_client_set_temp_password(request, client_id):
    """API endpoint to set a temporary password for a client (Super Admin only)"""
    try:
        data = json.loads(request.body)
        new_password = data.get('password', '').strip()
        if not new_password:
            return JsonResponse({'success': False, 'message': 'Password is required'}, status=400)
        if len(new_password) < 6:
            return JsonResponse({'success': False, 'message': 'Password must be at least 6 characters'}, status=400)

        result = ClientService.set_temp_password(client_id, new_password, request=request)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)
    except Exception as e:
        logger.exception("Client temp password error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)