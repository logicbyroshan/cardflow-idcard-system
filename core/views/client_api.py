"""
Client API Views
Contains: All client-related API endpoints (CRUD, toggle status, get staff)
"""
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
import json
from ..services import ClientService
from ..services.activity_service import ActivityService
from ..services.permission_service import PermissionService, api_require_any_admin
from .base import api_super_admin_required


def _check_admin_staff_client_access(user, client_id):
    """Check if admin_staff has access to a specific client. Returns True if allowed."""
    if PermissionService.is_super_admin(user):
        return True
    staff_profile = getattr(user, 'staff_profile', None)
    if staff_profile and staff_profile.staff_type == 'admin_staff':
        return staff_profile.assigned_clients.filter(id=client_id).exists()
    return False


@csrf_exempt
@require_http_methods(["POST"])
@api_super_admin_required
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
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@csrf_exempt
@require_http_methods(["GET"])
@api_require_any_admin
def api_client_get(request, client_id):
    """API endpoint to get a client's details"""
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    result = ClientService.get(client_id, include_permissions=True)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@csrf_exempt
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
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


@csrf_exempt
@require_http_methods(["DELETE", "POST"])
@api_super_admin_required
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


@csrf_exempt
@require_http_methods(["POST"])
@api_super_admin_required
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


@csrf_exempt
@require_http_methods(["GET"])
@api_require_any_admin
def api_client_staff(request, client_id):
    """API endpoint to get all staff members for a specific client"""
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    result = ClientService.get_staff(client_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
