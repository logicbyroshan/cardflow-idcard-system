"""
Client API Views
Contains: All client-related API endpoints (CRUD, toggle status, get staff)
"""
import json
import logging
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.utils import timezone
from ..services import ClientService
from ..services.activity_service import ActivityService
from ..services.notification_service import NotificationService
from ..services.permission_service import (
    PermissionService,
    api_require_any_admin,
    api_require_super_admin,
)
from ..models import ClientMessage, User
from accounts.rate_limit import rate_limit
from mediafiles.utils import normalize_uploaded_image

logger = logging.getLogger(__name__)


MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_UPLOAD_MIMES = {
    'image/jpeg', 'image/png', 'image/webp',
    'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
}
ALLOWED_IMAGE_UPLOAD_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.hei'}


def _validate_optional_image_upload(uploaded):
    """Validate optional client/staff photo uploads without changing response schema."""
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


def _check_admin_staff_client_access(user, client_id):
    """Check if user has access to a specific client.

    Manage Client permission grants full Manage Clients surface access for
    admin_staff (same capability level as super_admin on this page/API).
    """
    if PermissionService.is_admin_staff(user) and _has_manage_client_page_permission(user):
        return True
    return PermissionService.can_access_client(user, client_id)


def _has_manage_client_page_permission(user):
    """Return True when user can use full Manage Clients operations."""
    return PermissionService.is_super_admin(user) or PermissionService.has(user, 'perm_idcard_client_list')


def _manage_client_permission_denied_response():
    """Standard deny payload for missing Manage Client permission."""
    return JsonResponse({'success': False, 'message': 'Manage Client permission required'}, status=403)


def _serialize_client_message(item):
    sent_by_user = item.sent_by
    if sent_by_user:
        sender_name = sent_by_user.get_full_name() or sent_by_user.username
    else:
        sender_name = 'System'

    return {
        'id': item.id,
        'message': item.message,
        'scope': item.scope,
        'scope_display': item.get_scope_display(),
        'recipient_count': item.recipient_count,
        'sent_by_name': sender_name,
        'created_at': item.created_at.isoformat(),
        'created_at_display': timezone.localtime(item.created_at).strftime('%d-%m-%Y %H:%M'),
    }


@require_http_methods(["POST"])
@api_require_any_admin
@rate_limit(max_requests=10, window_seconds=60, key_prefix='client_create')
def api_client_create(request):
    """API endpoint to create a new client"""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
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

        photo, file_error = _validate_optional_image_upload(photo)
        if file_error:
            return file_error
        
        result = ClientService.create(data, request=request, photo=photo)

        if result.success and PermissionService.is_admin_staff(request.user):
            try:
                created_client_id = ((result.data or {}).get('client') or {}).get('id')
                if created_client_id:
                    from client.models import Client
                    created_client = Client.objects.filter(id=created_client_id).first()
                    staff = getattr(request.user, 'staff_profile', None)
                    if created_client and staff:
                        staff.assigned_clients.add(created_client)
            except Exception:
                logger.warning('Could not auto-assign newly created client to admin_staff user=%s', request.user.pk)
        
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
@rate_limit(max_requests=60, window_seconds=60, key_prefix='client_get')
def api_client_get(request, client_id):
    """API endpoint to get a client's details"""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    result = ClientService.get(client_id, include_permissions=True)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["PUT", "POST"])
@api_require_any_admin
def api_client_update(request, client_id):
    """API endpoint to update a client"""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
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

        photo, file_error = _validate_optional_image_upload(photo)
        if file_error:
            return file_error
        
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
@api_require_any_admin
@rate_limit(max_requests=5, window_seconds=60, key_prefix='client_delete')
def api_client_delete(request, client_id):
    """API endpoint to delete a client."""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    # Get client name before deletion for the activity log
    from client.models import Client
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
@api_require_any_admin
def api_client_toggle_status(request, client_id):
    """API endpoint to toggle client active/inactive status"""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
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
@rate_limit(max_requests=60, window_seconds=60, key_prefix='client_staff_get')
def api_client_staff(request, client_id):
    """API endpoint to get all staff members for a specific client"""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    result = ClientService.get_staff(client_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST"])
@api_require_any_admin
def api_client_staff_toggle_status(request, client_id, staff_id):
    """
    API endpoint to toggle client staff active/inactive status.
    Validates that the staff belongs to the specified client.
    """
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
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
@api_require_any_admin
@rate_limit(max_requests=5, window_seconds=60, key_prefix='client_temp_pw')
def api_client_set_temp_password(request, client_id):
    """API endpoint to set a temporary password for a client."""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    try:
        data = json.loads(request.body)
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

        result = ClientService.set_temp_password(client_id, new_password, request=request)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)
    except Exception as e:
        logger.exception("Client temp password error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)


@require_http_methods(["GET"])
@api_require_any_admin
@rate_limit(max_requests=60, window_seconds=60, key_prefix='client_msg_list')
def api_client_messages(request, client_id):
    """API endpoint to fetch admin-sent message history for a client."""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)

    from client.models import Client

    client = Client.objects.filter(id=client_id).select_related('user').first()
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)

    rows = (
        ClientMessage.objects
        .filter(client_id=client_id)
        .select_related('sent_by')
        .order_by('-created_at')[:80]
    )

    return JsonResponse({
        'success': True,
        'client': {
            'id': client.id,
            'name': client.name,
        },
        'messages': [_serialize_client_message(item) for item in rows],
    })


@require_http_methods(["POST"])
@api_require_any_admin
@rate_limit(max_requests=20, window_seconds=60, key_prefix='client_msg_send')
def api_client_message_send(request, client_id):
    """API endpoint to send one-way messages to client/client staff users."""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)

    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)

    message_text = (payload.get('message') or '').strip()
    scope = (payload.get('scope') or 'client_only').strip()

    if not message_text:
        return JsonResponse({'success': False, 'message': 'Message is required'}, status=400)
    if len(message_text) > 2000:
        return JsonResponse({'success': False, 'message': 'Message is too long (max 2000 characters)'}, status=400)
    if scope not in ('client_only', 'client_and_staff'):
        return JsonResponse({'success': False, 'message': 'Invalid recipient scope'}, status=400)

    from client.models import Client

    client = Client.objects.filter(id=client_id).select_related('user').first()
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)

    recipient_users = []
    if client.user_id and client.user.is_active:
        recipient_users.append(client.user)

    if scope == 'client_and_staff':
        staff_users = list(
            User.objects.filter(
                staff_profile__staff_type='client_staff',
                staff_profile__client_id=client_id,
                is_active=True,
            ).only('id')
        )
        recipient_users.extend(staff_users)

    recipient_ids = sorted({u.id for u in recipient_users if u and u.id})
    if not recipient_ids:
        return JsonResponse({'success': False, 'message': 'No active recipients found for this client'}, status=400)

    sender_name = request.user.get_full_name() or request.user.username
    notif_result = NotificationService.create_notification(
        title=f'Client Message - {client.name}',
        message=message_text,
        priority='normal',
        category='announcement',
        target='selected',
        target_user_ids=recipient_ids,
        created_by=request.user,
        send_email=False,
    )
    if not notif_result.success:
        return JsonResponse(notif_result.to_response_dict(), status=400)

    notif_id = ((notif_result.data or {}).get('notification') or {}).get('id')
    message_row = ClientMessage.objects.create(
        client=client,
        sent_by=request.user,
        message=message_text,
        scope=scope,
        notification_id=notif_id,
        recipient_count=len(recipient_ids),
    )

    ActivityService.log(
        'notification_create',
        f'Client message sent to {client.name} ({message_row.get_scope_display()})',
        request=request,
        target_model='ClientMessage',
        target_id=message_row.id,
        target_name=client.name,
    )

    return JsonResponse({
        'success': True,
        'message': f'Message sent to {len(recipient_ids)} user(s)',
        'client_message': _serialize_client_message(message_row),
        'sender_name': sender_name,
    })