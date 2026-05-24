"""
Client API Views
Contains: All client-related API endpoints (CRUD, toggle status, get staff)
"""
import json
import logging
import os
from datetime import timedelta
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods
from django.utils import timezone
from django.db import OperationalError, ProgrammingError
from client.models import Client
from client.services_staff import ClientStaffService
from staff.models import Staff
from ..services import ClientService, StaffService
from ..services.activity_service import ActivityService
from ..services.cache_version_service import CacheVersionService
from ..services.notification_service import NotificationService
from ..services.permission_service import (
    PermissionService,
    api_require_any_admin,
    api_require_super_admin,
)
from ..models import ClientMessage, Notification, User
from accounts.rate_limit import rate_limit
from mediafiles.utils import normalize_uploaded_image

logger = logging.getLogger(__name__)


CLIENT_STAFF_ALLOWED_PERMISSION_FIELDS = list(ClientStaffService.STAFF_PERMISSION_FIELDS)


TEMP_MESSAGE_DURATIONS = {
    '6h': timedelta(hours=6),
    '12h': timedelta(hours=12),
    '24h': timedelta(hours=24),
    '2d': timedelta(days=2),
    '3d': timedelta(days=3),
    '7d': timedelta(days=7),
}


MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_UPLOAD_MIMES = {
    'image/jpeg', 'image/png', 'image/webp',
    'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence',
    'application/octet-stream', 'image/octet-stream',
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

    Admin staff access is always scoped to assigned clients.
    """
    return PermissionService.can_access_client(user, client_id)


def _has_manage_client_page_permission(user):
    """Return True when user can use full Manage Clients operations."""
    return PermissionService.is_super_admin(user) or PermissionService.has(user, 'perm_idcard_client_list')


def _has_manage_client_staff_page_permission(user):
    """Return True when user can use Manage Assistent operations."""
    return (
        PermissionService.is_super_admin(user)
        or PermissionService.has(user, 'perm_idcard_client_list')
        or PermissionService.has(user, 'perm_manage_client_staff')
    )


def _manage_client_permission_denied_response():
    """Standard deny payload for missing Manage Client permission."""
    return JsonResponse({'success': False, 'message': 'Manage Client permission required'}, status=403)


def _manage_client_staff_permission_denied_response():
    """Standard deny payload for missing Manage Assistent permission."""
    return JsonResponse({'success': False, 'message': 'Manage Assistent permission required'}, status=403)


def _serialize_admin_client_staff(staff_obj, include_permissions=True):
    data = StaffService.serialize(staff_obj, include_permissions=include_permissions)
    data['client_id'] = staff_obj.client_id
    data['client_name'] = getattr(staff_obj.client, 'name', '')
    data['assigned_group_ids'] = list(staff_obj.assigned_groups.values_list('id', flat=True))
    data['assigned_table_ids'] = list(staff_obj.assigned_table_ids or [])
    data['allowed_classes'] = list(staff_obj.allowed_classes or [])
    data['allowed_sections'] = list(staff_obj.allowed_sections or [])
    data['allowed_branches'] = list(staff_obj.allowed_branches or [])
    data['assignment_scopes'] = list(staff_obj.assignment_scopes or [])
    return data


def _staff_assignment_snapshot(staff_obj):
    """Normalized assignment state for activity timeline diff logging."""
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

    table_ids = []
    for value in (staff_obj.assigned_table_ids or []):
        try:
            num = int(str(value).strip())
        except (TypeError, ValueError):
            continue
        if num > 0:
            table_ids.append(num)

    return {
        'client_ids': [int(staff_obj.client_id)] if getattr(staff_obj, 'client_id', None) else [],
        'group_ids': list(staff_obj.assigned_groups.values_list('id', flat=True)),
        'table_ids': table_ids,
        'classes': list(staff_obj.allowed_classes or []),
        'sections': list(staff_obj.allowed_sections or []),
        'branches': list(staff_obj.allowed_branches or []),
        'scope_count': len(staff_obj.assignment_scopes or []),
    }


def _build_admin_client_staff_payload(payload):
    data = {}
    for key in ('name', 'email', 'phone', 'address', 'is_active', 'password'):
        if key in payload:
            data[key] = payload.get(key)

    # Preserve assignment payload fields when present (assign drawer updates).
    for key in (
        'assigned_groups',
        'assigned_group_ids',
        'assigned_table_ids',
        'assignment_id_source',
        'allowed_classes',
        'allowed_sections',
        'allowed_branches',
        'assignment_scopes',
    ):
        if key in payload:
            data[key] = payload.get(key)

    for perm in CLIENT_STAFF_ALLOWED_PERMISSION_FIELDS:
        if perm in payload:
            data[perm] = payload.get(perm)

    # Sensitive permissions are never delegable to client staff.
    data['perm_idcard_approve'] = False
    data['perm_idcard_delete_from_pool'] = False
    return data


def _parse_client_id(raw_client_id):
    try:
        client_id = int(raw_client_id)
    except (TypeError, ValueError):
        return None
    return client_id if client_id > 0 else None


def _get_admin_manageable_client_staff(user, staff_id):
    staff_obj = (
        Staff.objects
        .filter(id=staff_id, staff_type='client_staff')
        .select_related('user', 'client')
        .first()
    )
    if not staff_obj:
        return None, JsonResponse({'success': False, 'message': 'Staff not found'}, status=404)
    if not _check_admin_staff_client_access(user, staff_obj.client_id):
        return None, JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    return staff_obj, None


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
        'visibility': item.visibility,
        'visibility_display': item.get_visibility_display(),
        'expires_at': item.expires_at.isoformat() if item.expires_at else None,
        'expires_at_display': timezone.localtime(item.expires_at).strftime('%d-%m-%Y %H:%M') if item.expires_at else None,
        'is_expired': item.is_expired,
        'notification_active': bool(getattr(item, 'notification', None) and item.notification.is_active),
        'recipient_count': item.recipient_count,
        'sent_by_name': sender_name,
        'created_at': item.created_at.isoformat(),
        'created_at_display': timezone.localtime(item.created_at).strftime('%d-%m-%Y %H:%M'),
    }


def _parse_message_visibility(payload):
    visibility = (payload.get('visibility') or 'permanent').strip().lower()
    if visibility not in ('permanent', 'temporary'):
        return None, None, 'Invalid message type'

    if visibility == 'permanent':
        return visibility, None, None

    duration_code = (payload.get('temporary_duration') or '').strip().lower()
    duration = TEMP_MESSAGE_DURATIONS.get(duration_code)
    if not duration:
        return None, None, 'Please select a valid temporary duration'

    return visibility, timezone.now() + duration, None


def _resolve_client_message_recipients(client_obj, scope):
    recipient_users = []
    if client_obj.user_id and client_obj.user.is_active:
        recipient_users.append(client_obj.user)

    if scope == 'client_and_staff':
        staff_users = list(
            User.objects.filter(
                staff_profile__staff_type='client_staff',
                staff_profile__client_id=client_obj.id,
                is_active=True,
            ).only('id')
        )
        recipient_users.extend(staff_users)

    return sorted({u.id for u in recipient_users if u and u.id})


def _is_missing_client_message_table_error(exc):
    error_text = str(exc or '').lower()
    return (
        'core_clientmessage' in error_text
        and ('no such table' in error_text or 'does not exist' in error_text or 'undefined table' in error_text)
    )


def _client_message_table_unavailable_response():
    return JsonResponse(
        {
            'success': False,
            'message': 'Client message storage is not initialized yet. Please run migrations.',
        },
        status=503,
    )


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
        # Handle explicit logo removal request when no new photo uploaded
        remove_logo_flag = data.get('remove_logo')
        try:
            remove_requested = str(remove_logo_flag).lower() in ('1', 'true', 'yes')
        except Exception:
            remove_requested = False
        if remove_requested and not photo:
            # Delete existing logo file safely
            client_obj = Client.objects.filter(id=client_id).first()
            if client_obj:
                logo_field = getattr(client_obj, 'logo', None)
                try:
                    if logo_field and logo_field.name:
                        logo_field.delete(save=False)
                except Exception:
                    logger.warning('Could not delete client logo file for client_id=%s (remove flag)', client_id)
                client_obj.logo = None
                client_obj.save(update_fields=['logo'])
        
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
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
    result = ClientService.get(client_id, include_permissions=True)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["GET"])
@api_require_any_admin
@rate_limit(max_requests=60, window_seconds=60, key_prefix='client_logo_get')
def api_client_logo_get(request, client_id):
    """Return the current client logo for the manage-client drawer preview."""
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)

    client = Client.objects.filter(id=client_id).only('id', 'logo').first()
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)

    logo_field = getattr(client, 'logo', None)
    logo_url = logo_field.url if logo_field else None
    return JsonResponse({
        'success': True,
        'logo_url': logo_url,
        'photo_url': logo_url,
        'website_logo_url': logo_url,
    })


@require_http_methods(["POST", "PUT"])
@api_require_any_admin
def api_client_logo_upload(request, client_id):
    """Upload and replace the client logo."""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)

    uploaded = request.FILES.get('logo') or request.FILES.get('photo') or request.FILES.get('image')
    uploaded, file_error = _validate_optional_image_upload(uploaded)
    if file_error:
        return file_error
    if not uploaded:
        return JsonResponse({'success': False, 'message': 'Logo file is required'}, status=400)

    client = Client.objects.filter(id=client_id).first()
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)

    old_logo = getattr(client, 'logo', None)
    client.logo = uploaded
    client.save()
    try:
        if old_logo and old_logo.name and old_logo.name != uploaded.name:
            old_logo.storage.delete(old_logo.name)
    except Exception:
        logger.warning('Could not remove previous client logo file for client_id=%s', client_id)

    return JsonResponse({
        'success': True,
        'message': 'Logo uploaded successfully',
        'logo_url': client.logo.url if client.logo else None,
    })


@require_http_methods(["DELETE", "POST"])
@api_require_any_admin
def api_client_logo_delete(request, client_id):
    """Remove the current client logo."""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)

    client = Client.objects.filter(id=client_id).first()
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)

    logo_field = getattr(client, 'logo', None)
    try:
        if logo_field and logo_field.name:
            logo_field.delete(save=False)
    except Exception:
        logger.warning('Could not delete client logo file for client_id=%s', client_id)

    client.logo = None
    client.save()
    return JsonResponse({'success': True, 'message': 'Logo deleted successfully'})


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
    
    if PermissionService.is_admin_staff(request.user):
        return JsonResponse({'success': False, 'message': 'Only super admin can delete clients'}, status=403)
        
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)
        
    # Get client object with card count annotation
    from django.db.models import Count
    from client.models import Client
    
    try:
        client_obj = Client.objects.annotate(
            card_count=Count('id_card_groups__tables__id_cards', distinct=True)
        ).get(pk=client_id)
        
        client_name = client_obj.name
        
        # Enforce no-cards rule
        if client_obj.card_count > 0:
            return JsonResponse({
                'success': False, 
                'message': f'Cannot delete client "{client_name}" because it has {client_obj.card_count} active ID cards. Please delete all cards belonging to this client first.'
            }, status=400)
            
    except Client.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)
        
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
@rate_limit(max_requests=60, window_seconds=60, key_prefix='admin_client_staff_clients')
def api_admin_client_staff_clients(request):
    """List clients that can be assigned to client staff from admin pages."""
    if not _has_manage_client_staff_page_permission(request.user):
        return _manage_client_staff_permission_denied_response()

    clients_qs = Client.objects.select_related('user').order_by('name')
    if PermissionService.is_super_admin(request.user):
        pass
    else:
        accessible_ids = PermissionService.get_accessible_client_ids(request.user)
        clients_qs = clients_qs.filter(id__in=accessible_ids)

    return JsonResponse({
        'success': True,
        'clients': [
            {
                'id': c.id,
                'name': c.name,
                'status': c.status,
                'is_user_active': bool(c.user and c.user.is_active),
            }
            for c in clients_qs
        ],
    })


@require_http_methods(["GET"])
@api_require_any_admin
@rate_limit(max_requests=60, window_seconds=60, key_prefix='admin_client_staff_get')
def api_admin_client_staff_get(request, staff_id):
    """Get details for a client staff member from admin pages."""
    if not _has_manage_client_staff_page_permission(request.user):
        return _manage_client_staff_permission_denied_response()

    staff_obj, denied_response = _get_admin_manageable_client_staff(request.user, staff_id)
    if denied_response:
        return denied_response

    return JsonResponse({
        'success': True,
        'staff': _serialize_admin_client_staff(staff_obj, include_permissions=True),
    })


@require_http_methods(["POST"])
@api_require_any_admin
@rate_limit(max_requests=10, window_seconds=60, key_prefix='admin_client_staff_create')
def api_admin_client_staff_create(request):
    """Create a client staff member from admin pages."""
    if not _has_manage_client_staff_page_permission(request.user):
        return _manage_client_staff_permission_denied_response()

    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)

    client_id = _parse_client_id(payload.get('client_id'))
    if not client_id:
        return JsonResponse({'success': False, 'message': 'Please select a client'}, status=400)
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)

    client_obj = Client.objects.filter(id=client_id).first()
    if not client_obj:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)

    data = _build_admin_client_staff_payload(payload)
    result = StaffService.create(
        data,
        staff_type='client_staff',
        client=client_obj,
        request=request,
    )
    if not result.success:
        return JsonResponse(result.to_response_dict(), status=400)

    created_staff_id = ((result.data or {}).get('staff') or {}).get('id')
    created_staff = (
        Staff.objects
        .filter(id=created_staff_id, staff_type='client_staff')
        .select_related('user', 'client')
        .prefetch_related('assigned_groups')
        .first()
    )

    if created_staff:
        try:
            ActivityService.log_staff_create(request, created_staff)
            ActivityService.log_staff_assignment_change(
                request,
                created_staff,
                before_snapshot={},
                after_snapshot=_staff_assignment_snapshot(created_staff),
                reason='created',
            )
        except Exception:
            logger.exception('Failed to log client staff create timeline for staff_id=%s', created_staff.id)

    return JsonResponse({
        'success': True,
        'message': result.message,
        'staff': _serialize_admin_client_staff(created_staff, include_permissions=True) if created_staff else None,
    })


@require_http_methods(["POST", "PUT"])
@api_require_any_admin
@rate_limit(max_requests=15, window_seconds=60, key_prefix='admin_client_staff_update')
def api_admin_client_staff_update(request, staff_id):
    """Update a client staff member from admin pages."""
    if not _has_manage_client_staff_page_permission(request.user):
        return _manage_client_staff_permission_denied_response()

    staff_obj, denied_response = _get_admin_manageable_client_staff(request.user, staff_id)
    if denied_response:
        return denied_response

    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)

    incoming_client_id = _parse_client_id(payload.get('client_id'))
    if incoming_client_id and incoming_client_id != staff_obj.client_id:
        return JsonResponse({'success': False, 'message': 'Changing assigned client is not supported. Create a new staff for another client.'}, status=400)

    data = _build_admin_client_staff_payload(payload)
    before_assignment_snapshot = _staff_assignment_snapshot(staff_obj)

    result = StaffService.update(staff_obj.id, data)
    if not result.success:
        return JsonResponse(result.to_response_dict(), status=400)

    refreshed = (
        Staff.objects
        .filter(id=staff_obj.id, staff_type='client_staff')
        .select_related('user', 'client')
        .prefetch_related('assigned_groups')
        .first()
    )

    if refreshed:
        try:
            ActivityService.log_staff_update(request, refreshed)
            ActivityService.log_staff_assignment_change(
                request,
                refreshed,
                before_snapshot=before_assignment_snapshot,
                after_snapshot=_staff_assignment_snapshot(refreshed),
                reason='updated',
            )
        except Exception:
            logger.exception('Failed to log client staff update timeline for staff_id=%s', refreshed.id)

    return JsonResponse({
        'success': True,
        'message': result.message,
        'staff': _serialize_admin_client_staff(refreshed, include_permissions=True) if refreshed else None,
    })


@require_http_methods(["POST", "DELETE"])
@api_require_any_admin
@rate_limit(max_requests=10, window_seconds=60, key_prefix='admin_client_staff_delete')
def api_admin_client_staff_delete(request, staff_id):
    """Delete a client staff member from admin pages."""
    if not _has_manage_client_staff_page_permission(request.user):
        return _manage_client_staff_permission_denied_response()

    staff_obj, denied_response = _get_admin_manageable_client_staff(request.user, staff_id)
    if denied_response:
        return denied_response

    result = StaffService.delete(staff_obj.id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST"])
@api_require_any_admin
@rate_limit(max_requests=20, window_seconds=60, key_prefix='admin_client_staff_toggle')
def api_admin_client_staff_toggle_status(request, staff_id):
    """Toggle active/inactive status for a client staff member from admin pages."""
    if not _has_manage_client_staff_page_permission(request.user):
        return _manage_client_staff_permission_denied_response()

    staff_obj, denied_response = _get_admin_manageable_client_staff(request.user, staff_id)
    if denied_response:
        return denied_response

    result = StaffService.toggle_status(staff_obj.id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST"])
@api_require_any_admin
@rate_limit(max_requests=5, window_seconds=60, key_prefix='admin_client_staff_temp_pw')
def api_admin_client_staff_set_temp_password(request, staff_id):
    """Set temporary password for a client staff member from admin pages."""
    if not _has_manage_client_staff_page_permission(request.user):
        return _manage_client_staff_permission_denied_response()

    staff_obj, denied_response = _get_admin_manageable_client_staff(request.user, staff_id)
    if denied_response:
        return denied_response

    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)

    new_password = (payload.get('password') or '').strip()
    if not new_password:
        return JsonResponse({'success': False, 'message': 'Password is required'}, status=400)
    if len(new_password) < 8:
        return JsonResponse({'success': False, 'message': 'Password must be at least 8 characters'}, status=400)

    from django.contrib.auth.password_validation import validate_password
    try:
        validate_password(new_password, user=staff_obj.user)
    except Exception as validation_error:
        return JsonResponse({'success': False, 'message': '; '.join(validation_error.messages)}, status=400)

    result = StaffService.set_temp_password(staff_obj.id, new_password, request=request)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["GET"])
@api_require_any_admin
def api_admin_client_class_section_options(request, client_id):
    """
    API: Get distinct class and section values from all cards of a specific client.
    Used by admin side assistant management to assign classes/sections.
    """
    from idcards.models import IDCard, IDCardTable
    from idcards.models import IDCardGroup

    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)

    client = Client.objects.filter(id=client_id).first()
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)

    raw_group_ids = request.GET.get('group_ids', '').strip()
    id_source = (request.GET.get('id_source', '') or '').strip().lower()
    if id_source not in ('group', 'table'):
        id_source = 'auto'

    resolved_id_source = id_source
    if resolved_id_source == 'auto':
        group_count = IDCardGroup.objects.filter(client=client).count()
        resolved_id_source = 'table' if group_count <= 1 else 'group'

    group_ids = []
    if raw_group_ids:
        try:
            group_ids = sorted({int(x) for x in raw_group_ids.split(',') if str(x).strip().isdigit()})
        except Exception:
            group_ids = []

    # Resolve effective tables.
    tables_qs = IDCardTable.objects.filter(group__client=client, deleted_by_client=False)

    if group_ids:
        valid_group_ids = set(
            IDCardGroup.objects.filter(client=client, id__in=group_ids).values_list('id', flat=True)
        )
        valid_table_ids = set(
            IDCardTable.objects.filter(group__client=client, id__in=group_ids).values_list('id', flat=True)
        )

        if resolved_id_source == 'table':
            if valid_table_ids:
                tables_qs = tables_qs.filter(id__in=list(valid_table_ids))
            elif valid_group_ids:
                tables_qs = tables_qs.filter(group_id__in=list(valid_group_ids))
            else:
                tables_qs = tables_qs.none()
        elif resolved_id_source == 'group':
            if valid_group_ids:
                tables_qs = tables_qs.filter(group_id__in=list(valid_group_ids))
            elif valid_table_ids:
                tables_qs = tables_qs.filter(id__in=list(valid_table_ids))
            else:
                tables_qs = tables_qs.none()

    tables = list(tables_qs.values('id', 'fields'))

    classes = set()
    sections = set()
    branches = set()
    class_sections = {}
    class_counts = {}
    section_counts = {}
    class_section_counts = {}
    table_field_map = {}
    has_class_field = False
    has_section_field = False
    has_branch_field = False

    for table in tables:
        class_field = None
        section_field = None
        branch_field = None
        for field in (table.get('fields') or []):
            ft = field.get('type', '').lower()
            fn = field.get('name', '')
            fn_lower = fn.lower()
            if ft == 'class' or fn.lower() == 'class':
                class_field = fn
            elif ft == 'section' or fn.lower() == 'section':
                section_field = fn
            elif (
                ft == 'branch'
                or fn_lower == 'branch'
                or fn_lower == 'stream'
                or fn_lower == 'course'
                or 'branch' in fn_lower
                or 'stream' in fn_lower
                or 'course' in fn_lower
            ):
                branch_field = fn

        if class_field: has_class_field = True
        if section_field: has_section_field = True
        if branch_field: has_branch_field = True

        if class_field or section_field or branch_field:
            table_field_map[table['id']] = (class_field, section_field, branch_field)

    table_ids = list(table_field_map.keys())
    if table_ids:
        cards = IDCard.objects.filter(table_id__in=table_ids).values_list('table_id', 'field_data').iterator(chunk_size=1000)
    else:
        cards = []

    for table_id, fd in cards:
        if not fd: continue
        class_field, section_field, branch_field = table_field_map.get(table_id, (None, None, None))
        class_val = ''
        section_val = ''
        if class_field:
            val = fd.get(class_field, '') or fd.get(class_field.upper(), '') or fd.get(class_field.lower(), '')
            if val:
                class_val = str(val).strip()
                if class_val: classes.add(class_val)
        if section_field:
            val = fd.get(section_field, '') or fd.get(section_field.upper(), '') or fd.get(section_field.lower(), '')
            if val:
                section_val = str(val).strip()
                if section_val: sections.add(section_val)
        if branch_field:
            val = fd.get(branch_field, '') or fd.get(branch_field.upper(), '') or fd.get(branch_field.lower(), '')
            if val:
                branch_val = str(val).strip()
                if branch_val: branches.add(branch_val)

        if class_val:
            if class_val not in class_sections:
                class_sections[class_val] = set()
            if section_val:
                class_sections[class_val].add(section_val)
            class_counts[class_val] = class_counts.get(class_val, 0) + 1
        if section_val:
            section_counts[section_val] = section_counts.get(section_val, 0) + 1
        if class_val and section_val:
            class_section_counts.setdefault(class_val, {})
            class_section_counts[class_val][section_val] = class_section_counts[class_val].get(section_val, 0) + 1

    return JsonResponse({
        'success': True,
        'resolved_id_source': resolved_id_source,
        'classes': sorted(classes),
        'sections': sorted(sections),
        'branches': sorted(branches),
        'has_class_field': has_class_field,
        'has_section_field': has_section_field,
        'has_branch_field': has_branch_field,
        'class_sections': {k: sorted(v) for k, v in sorted(class_sections.items())},
        'class_counts': {k: int(v) for k, v in sorted(class_counts.items())},
        'section_counts': {k: int(v) for k, v in sorted(section_counts.items())},
        'class_section_counts': {k: {sk: int(sv) for sk, sv in sorted(sv.items())} for k, sv in sorted(class_section_counts.items())},
    })


@require_http_methods(["GET"])
@api_require_any_admin
def api_admin_client_groups_list(request, client_id):
    """
    API: Get list of assignable groups for a specific client.
    Similar to the client-side api_client_groups_list but for admin use.
    """
    from idcards.models import IDCardGroup, IDCardTable
    from client.models import Client

    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

    client = Client.objects.filter(id=client_id).first()
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)

    groups_qs = IDCardGroup.objects.filter(client=client).order_by('name')
    group_count = groups_qs.count()

    # If only one group, show tables as assignable units (matches client-side behavior)
    if group_count <= 1:
        tables_qs = IDCardTable.objects.filter(
            group__client=client,
            deleted_by_client=False,
        ).order_by('name').values('id', 'name', 'group_id')
        groups_data = [
            {
                'id': t['id'],
                'name': t['name'],
                'group_id': t['group_id'],
                'source': 'table',
            }
            for t in tables_qs
        ]
    else:
        groups_data = [
            {
                'id': g.id,
                'name': g.name,
                'group_id': g.id,
                'source': 'group',
            }
            for g in groups_qs
        ]

    return JsonResponse({
        'success': True,
        'groups': groups_data
    })


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

    try:
        rows = (
            ClientMessage.objects
            .filter(client_id=client_id)
            .select_related('sent_by', 'notification')
            .order_by('-created_at')[:80]
        )
    except (OperationalError, ProgrammingError) as exc:
        if _is_missing_client_message_table_error(exc):
            logger.warning('ClientMessage table unavailable while listing history: %s', exc)
            return _client_message_table_unavailable_response()
        raise

    return JsonResponse({
        'success': True,
        'client': {
            'id': client.id,
            'name': client.name,
        },
        'messages': [_serialize_client_message(item) for item in rows],
    })


def _bump_client_message_cache_versions(client_id, recipient_user_ids=None):
    """Invalidate client message drawer caches for affected client/users."""
    try:
        client_id = int(client_id)
    except (TypeError, ValueError):
        return

    CacheVersionService.bump('client_messages_drawer_client', f'client:{client_id}')

    for raw_uid in (recipient_user_ids or []):
        try:
            uid = int(raw_uid)
        except (TypeError, ValueError):
            continue
        if uid > 0:
            CacheVersionService.bump('client_messages_drawer_user', f'user:{uid}')


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

    visibility, expires_at, visibility_error = _parse_message_visibility(payload)
    if visibility_error:
        return JsonResponse({'success': False, 'message': visibility_error}, status=400)

    from client.models import Client

    client = Client.objects.filter(id=client_id).select_related('user').first()
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)

    try:
        ClientMessage.objects.only('id').first()
    except (OperationalError, ProgrammingError) as exc:
        if _is_missing_client_message_table_error(exc):
            logger.warning('ClientMessage table unavailable while sending message: %s', exc)
            return _client_message_table_unavailable_response()
        raise

    recipient_ids = _resolve_client_message_recipients(client, scope)
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
    try:
        message_row = ClientMessage.objects.create(
            client=client,
            sent_by=request.user,
            message=message_text,
            scope=scope,
            visibility=visibility,
            expires_at=expires_at,
            notification_id=notif_id,
            recipient_count=len(recipient_ids),
        )
    except (OperationalError, ProgrammingError) as exc:
        if _is_missing_client_message_table_error(exc):
            logger.warning('ClientMessage table unavailable while creating message row: %s', exc)
            if notif_id:
                Notification.objects.filter(id=notif_id).update(is_active=False)
            return _client_message_table_unavailable_response()
        raise

    _bump_client_message_cache_versions(client.id, recipient_ids)

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


@require_http_methods(["GET"])
@api_require_any_admin
@rate_limit(max_requests=60, window_seconds=60, key_prefix='client_msg_targets')
def api_client_message_targets(request):
    """Return client options for group message targeting."""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()

    from client.models import Client

    query = (request.GET.get('q') or '').strip()
    try:
        limit = max(20, min(int(request.GET.get('limit', 400)), 1000))
    except (TypeError, ValueError):
        limit = 400

    qs = Client.objects.select_related('user').order_by('name')
    if query:
        qs = qs.filter(name__icontains=query)

    rows = list(qs[:limit])
    return JsonResponse({
        'success': True,
        'clients': [
            {
                'id': item.id,
                'name': item.name,
                'status': item.status,
                'is_user_active': bool(item.user and item.user.is_active),
                'logo_url': item.logo.url if item.logo else None,
                'photo_url': item.logo.url if item.logo else None,
                'website_logo_url': item.logo.url if item.logo else None,
            }
            for item in rows
        ],
    })



@require_http_methods(["GET"])
@api_require_any_admin
def api_client_logo_get(request, client_id):
    """Retrieve current logo URL for a client."""
    from client.models import Client
    client = get_object_or_404(Client, id=client_id)
    return JsonResponse({
        'success': True,
        'logo_url': client.logo.url if client.logo else None
    })


@require_http_methods(["POST"])
@api_require_any_admin
def api_client_logo_upload(request, client_id):
    """Upload a new logo for a client."""
    from client.models import Client
    client = get_object_or_404(Client, id=client_id)

    if 'logo' not in request.FILES:
        return JsonResponse({'success': False, 'message': 'No logo file provided'}, status=400)

    logo_file = request.FILES['logo']
    # Basic validation
    if not logo_file.content_type.startswith('image/'):
        return JsonResponse({'success': False, 'message': 'File must be an image'}, status=400)

    if logo_file.size > 2 * 1024 * 1024:  # 2MB limit
        return JsonResponse({'success': False, 'message': 'Image too large (max 2MB)'}, status=400)

    client.logo = logo_file
    client.save()

    return JsonResponse({
        'success': True,
        'message': 'Logo uploaded successfully',
        'logo_url': client.logo.url
    })


@require_http_methods(["POST"])
@api_require_any_admin
def api_client_logo_delete(request, client_id):
    """Delete the client logo."""
    from client.models import Client
    client = get_object_or_404(Client, id=client_id)

    if client.logo:
        client.logo.delete(save=False)
        client.logo = None
        client.save()

    return JsonResponse({'success': True, 'message': 'Logo deleted successfully'})


@require_http_methods(["POST"])
@api_require_any_admin
@rate_limit(max_requests=10, window_seconds=60, key_prefix='client_msg_group_send')
def api_client_messages_group_send(request):
    """Send one-way client messages to selected clients or all clients."""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()

    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)

    message_text = (payload.get('message') or '').strip()
    scope = (payload.get('scope') or 'client_only').strip()
    target_mode = (payload.get('target_mode') or 'selected').strip()

    if not message_text:
        return JsonResponse({'success': False, 'message': 'Message is required'}, status=400)
    if len(message_text) > 2000:
        return JsonResponse({'success': False, 'message': 'Message is too long (max 2000 characters)'}, status=400)
    if scope not in ('client_only', 'client_and_staff'):
        return JsonResponse({'success': False, 'message': 'Invalid recipient scope'}, status=400)
    if target_mode not in ('selected', 'all'):
        return JsonResponse({'success': False, 'message': 'Invalid target mode'}, status=400)

    visibility, expires_at, visibility_error = _parse_message_visibility(payload)
    if visibility_error:
        return JsonResponse({'success': False, 'message': visibility_error}, status=400)

    selected_ids = []
    raw_client_ids = payload.get('client_ids') or []
    if target_mode == 'selected':
        if not isinstance(raw_client_ids, list):
            return JsonResponse({'success': False, 'message': 'client_ids must be a list'}, status=400)
        for raw_id in raw_client_ids:
            try:
                selected_ids.append(int(raw_id))
            except (TypeError, ValueError):
                continue
        selected_ids = sorted(set(selected_ids))
        if not selected_ids:
            return JsonResponse({'success': False, 'message': 'Select at least one client'}, status=400)

    from client.models import Client

    clients_qs = Client.objects.select_related('user').order_by('name')
    if target_mode == 'selected':
        clients_qs = clients_qs.filter(id__in=selected_ids)

    clients = list(clients_qs)
    if not clients:
        return JsonResponse({'success': False, 'message': 'No clients found for this request'}, status=400)

    try:
        ClientMessage.objects.only('id').first()
    except (OperationalError, ProgrammingError) as exc:
        if _is_missing_client_message_table_error(exc):
            logger.warning('ClientMessage table unavailable while group sending message: %s', exc)
            return _client_message_table_unavailable_response()
        raise

    sent_items = []
    skipped_clients = []
    failed_clients = []
    total_recipients = 0

    for client in clients:
        recipient_ids = _resolve_client_message_recipients(client, scope)
        if not recipient_ids:
            skipped_clients.append({'id': client.id, 'name': client.name})
            continue

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
            failed_clients.append({'id': client.id, 'name': client.name})
            continue

        notif_id = ((notif_result.data or {}).get('notification') or {}).get('id')
        try:
            row = ClientMessage.objects.create(
                client=client,
                sent_by=request.user,
                message=message_text,
                scope=scope,
                visibility=visibility,
                expires_at=expires_at,
                notification_id=notif_id,
                recipient_count=len(recipient_ids),
            )
        except (OperationalError, ProgrammingError) as exc:
            if _is_missing_client_message_table_error(exc):
                logger.warning('ClientMessage table unavailable while creating group message row: %s', exc)
                if notif_id:
                    Notification.objects.filter(id=notif_id).update(is_active=False)
                return _client_message_table_unavailable_response()
            raise
        _bump_client_message_cache_versions(client.id, recipient_ids)
        sent_items.append({'id': row.id, 'client_id': client.id, 'client_name': client.name})
        total_recipients += len(recipient_ids)

    if not sent_items:
        return JsonResponse({
            'success': False,
            'message': 'No messages were sent. Check selected clients and recipients.',
            'skipped_clients': skipped_clients,
            'failed_clients': failed_clients,
        }, status=400)

    ActivityService.log(
        'notification_create',
        f'Group client message sent ({len(sent_items)} clients, {scope})',
        request=request,
        target_model='ClientMessage',
        target_id=sent_items[0]['id'],
        target_name='Group Client Message',
    )

    return JsonResponse({
        'success': True,
        'message': f'Message sent to {len(sent_items)} client(s)',
        'sent_count': len(sent_items),
        'recipient_count': total_recipients,
        'skipped_count': len(skipped_clients),
        'failed_count': len(failed_clients),
    })


@require_http_methods(["POST"])
@api_require_any_admin
@rate_limit(max_requests=20, window_seconds=60, key_prefix='client_msg_delete')
def api_client_message_delete(request, client_id, message_id):
    """Hide a sent message from client-side surfaces while preserving sender history."""
    if not _has_manage_client_page_permission(request.user):
        return _manage_client_permission_denied_response()
    if not _check_admin_staff_client_access(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied. You are not assigned to this client.'}, status=403)

    try:
        row = (
            ClientMessage.objects
            .filter(id=message_id, client_id=client_id)
            .select_related('notification', 'client')
            .first()
        )
    except (OperationalError, ProgrammingError) as exc:
        if _is_missing_client_message_table_error(exc):
            logger.warning('ClientMessage table unavailable while deleting message: %s', exc)
            return _client_message_table_unavailable_response()
        raise
    if not row:
        return JsonResponse({'success': False, 'message': 'Message not found'}, status=404)

    recipient_user_ids = []
    if row.notification_id and row.notification is not None:
        recipient_user_ids = list(row.notification.target_users.values_list('id', flat=True))

    if row.notification_id:
        Notification.objects.filter(id=row.notification_id).update(is_active=False)

    _bump_client_message_cache_versions(client_id, recipient_user_ids)

    ActivityService.log(
        'notification_update',
        f'Client message manually removed from recipients for {row.client.name}',
        request=request,
        target_model='ClientMessage',
        target_id=row.id,
        target_name=row.client.name,
    )

    return JsonResponse({'success': True, 'message': 'Message removed from client inbox'})