from __future__ import annotations

from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.http import require_http_methods

from accounts.rate_limit import rate_limit
from core.services.permission_service import api_require_any_admin, require_any_admin
from .models import OfficeWorkChatGroup, OfficeWorkChatGroupMember, OfficeWorkChatMessage
from .services_chat import (
    MAX_CHAT_ATTACHMENT_BYTES,
    MAX_CHAT_MESSAGE_LENGTH,
    create_officework_chat_group,
    create_office_work_chat_message,
    list_visible_groups_payload,
    mark_officework_user_presence,
    replace_officework_chat_group_members,
    resolve_group_for_user,
    user_can_manage_officework_groups,
)
from .upload_security import is_blocked_upload_name, safe_download_filename
from .views_common import parse_int, parse_json_body, serialize_chat_message


@login_required
@require_any_admin
def office_work_page(request):
    mark_officework_user_presence(request.user)
    return render(
        request,
        'officework/office-work.html',
        {
            'active_page': 'office_work',
            'can_manage_groups': user_can_manage_officework_groups(request.user),
        },
    )


@require_http_methods(['GET'])
@rate_limit(max_requests=180, window_seconds=60, key_prefix='ow_chat_groups_list')
@api_require_any_admin
def api_office_work_chat_groups_list(request):
    mark_officework_user_presence(request.user)
    payload = list_visible_groups_payload(request.user)
    return JsonResponse({
        'success': True,
        'groups': payload['groups'],
        'available_members': payload['available_members'],
        'can_manage_groups': payload['can_manage_groups'],
    })


@require_http_methods(['POST'])
@rate_limit(max_requests=20, window_seconds=60, key_prefix='ow_chat_group_create')
@api_require_any_admin
def api_office_work_chat_group_create(request):
    mark_officework_user_presence(request.user)
    body = parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON body.'}, status=400)

    name = str(body.get('name') or '').strip()
    member_ids = body.get('member_ids') or []

    try:
        group = create_officework_chat_group(actor=request.user, name=name, member_ids=member_ids)
    except ValueError as exc:
        return JsonResponse({'success': False, 'message': str(exc)}, status=400)
    except PermissionDenied:
        return JsonResponse({'success': False, 'message': 'Not allowed.'}, status=403)

    payload = list_visible_groups_payload(request.user)
    created = next((item for item in payload['groups'] if int(item['id']) == int(group.id)), None)
    return JsonResponse({
        'success': True,
        'message': 'Group created.',
        'group': created,
        'groups': payload['groups'],
    })


@require_http_methods(['POST'])
@rate_limit(max_requests=30, window_seconds=60, key_prefix='ow_chat_group_members_update')
@api_require_any_admin
def api_office_work_chat_group_members_update(request, group_id):
    mark_officework_user_presence(request.user)
    body = parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON body.'}, status=400)

    member_ids = body.get('member_ids') or []
    group = get_object_or_404(OfficeWorkChatGroup.objects.filter(is_active=True), id=group_id)

    try:
        replace_officework_chat_group_members(actor=request.user, group=group, member_ids=member_ids)
    except PermissionDenied:
        return JsonResponse({'success': False, 'message': 'Not allowed.'}, status=403)

    payload = list_visible_groups_payload(request.user)
    return JsonResponse({
        'success': True,
        'message': 'Group members updated.',
        'groups': payload['groups'],
    })


@require_http_methods(['GET'])
@rate_limit(max_requests=240, window_seconds=60, key_prefix='ow_chat_list')
@api_require_any_admin
def api_office_work_chat_list(request):
    mark_officework_user_presence(request.user)
    limit = max(1, min(parse_int(request.GET.get('limit'), 150), 300))
    after_id = parse_int(request.GET.get('after_id'), 0)
    group_id = parse_int(request.GET.get('group_id'), 0)

    try:
        group = resolve_group_for_user(user=request.user, group_id=group_id if group_id > 0 else None)
    except PermissionDenied:
        return JsonResponse({'success': False, 'message': 'Group access denied.'}, status=403)

    if group is None:
        return JsonResponse({'success': False, 'message': 'No chat groups available.'}, status=400)

    qs = OfficeWorkChatMessage.objects.select_related('sender', 'group').filter(group=group).order_by('id')
    if after_id > 0:
        qs = qs.filter(id__gt=after_id)[:limit]
        messages = list(qs)
    else:
        latest = list(qs.reverse()[:limit])
        messages = list(reversed(latest))

    return JsonResponse({
        'success': True,
        'active_group_id': group.id,
        'messages': [serialize_chat_message(item) for item in messages],
    })


@require_http_methods(['POST'])
@rate_limit(max_requests=80, window_seconds=60, key_prefix='ow_chat_send')
@api_require_any_admin
def api_office_work_chat_send(request):
    mark_officework_user_presence(request.user)
    is_multipart = 'multipart/form-data' in str(request.META.get('CONTENT_TYPE') or '').lower()
    body = None if is_multipart else parse_json_body(request)
    if body is None and not is_multipart:
        return JsonResponse({'success': False, 'message': 'Invalid JSON body.'}, status=400)

    payload = body or {}
    if is_multipart:
        payload = request.POST

    message_text = str(payload.get('message') or '').strip()
    group_id = parse_int(payload.get('group_id'), 0)
    attachment = request.FILES.get('file') if is_multipart else None

    if len(message_text) > MAX_CHAT_MESSAGE_LENGTH:
        message_text = message_text[:MAX_CHAT_MESSAGE_LENGTH]

    if attachment is not None:
        size_bytes = int(getattr(attachment, 'size', 0) or 0)
        if size_bytes <= 0:
            return JsonResponse({'success': False, 'message': 'Attachment is empty.'}, status=400)
        if size_bytes > MAX_CHAT_ATTACHMENT_BYTES:
            return JsonResponse({'success': False, 'message': 'Attachment too large (max 50 MB).'}, status=400)
        if is_blocked_upload_name(getattr(attachment, 'name', '')):
            return JsonResponse({'success': False, 'message': 'This file type is not allowed for security reasons.'}, status=400)

    try:
        group = resolve_group_for_user(user=request.user, group_id=group_id if group_id > 0 else None)
    except PermissionDenied:
        return JsonResponse({'success': False, 'message': 'Group access denied.'}, status=403)

    if group is None:
        return JsonResponse({'success': False, 'message': 'No chat groups available.'}, status=400)

    try:
        item = create_office_work_chat_message(
            sender=request.user,
            message_text=message_text,
            group=group,
            attachment=attachment,
        )
    except ValueError as exc:
        return JsonResponse({'success': False, 'message': str(exc)}, status=400)
    except PermissionDenied:
        return JsonResponse({'success': False, 'message': 'Not allowed.'}, status=403)

    return JsonResponse({
        'success': True,
        'message': 'Chat message sent.',
        'item': item,
    })


@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_office_work_chat_attachment_download(request, message_id):
    mark_officework_user_presence(request.user)
    message = get_object_or_404(
        OfficeWorkChatMessage.objects.select_related('group'),
        id=message_id,
    )
    if not message.attachment:
        raise Http404('Attachment not found.')

    memberships = OfficeWorkChatGroupMember.objects.filter(group=message.group, user=request.user)
    if not memberships.exists():
        raise Http404('Attachment not found.')

    try:
        file_handle = message.attachment.open('rb')
    except FileNotFoundError:
        raise Http404('Attachment missing from storage.')

    download_name = safe_download_filename(
        message.attachment_original_name or message.attachment.name.rsplit('/', 1)[-1],
        fallback=f'chat-file-{message.id}',
    )
    return FileResponse(file_handle, as_attachment=True, filename=download_name)
