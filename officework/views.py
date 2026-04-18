"""Office Work page and API endpoints (admin/operator collaboration)."""

import json
from datetime import date

from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from core.services.permission_service import api_require_any_admin, require_any_admin
from .models import OfficeWorkChatMessage, OfficeWorkSharedFile, OfficeWorkTask


User = get_user_model()
MAX_CHAT_MESSAGE_LENGTH = 4000
MAX_FILE_UPLOAD_BYTES = 50 * 1024 * 1024


def _parse_int(raw, default=0):
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _parse_json_body(request):
    if not getattr(request, 'body', b''):
        return {}
    try:
        return json.loads(request.body.decode('utf-8'))
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


def _allowed_members_qs():
    return User.objects.filter(role__in=('super_admin', 'admin_staff'), is_active=True).order_by('first_name', 'username', 'id')


def _serialize_member(user):
    full_name = (user.get_full_name() or '').strip()
    return {
        'id': user.id,
        'name': full_name or user.username or user.email or f'User {user.id}',
        'role': user.role,
        'role_display': user.get_role_display() if hasattr(user, 'get_role_display') else user.role,
    }


def _serialize_chat_message(message):
    sender = message.sender
    sender_name = 'Unknown User'
    sender_role = ''
    sender_id = None
    if sender is not None:
        sender_id = sender.id
        sender_role = getattr(sender, 'role', '') or ''
        sender_name = (sender.get_full_name() or '').strip() or sender.username or sender.email or f'User {sender.id}'
    return {
        'id': message.id,
        'message': message.message,
        'sender_id': sender_id,
        'sender_name': sender_name,
        'sender_role': sender_role,
        'created_at': message.created_at.isoformat(),
    }


def _serialize_task(task):
    assigned_to = task.assigned_to
    created_by = task.created_by
    assigned_to_name = ''
    created_by_name = ''

    if assigned_to is not None:
        assigned_to_name = (assigned_to.get_full_name() or '').strip() or assigned_to.username or assigned_to.email or f'User {assigned_to.id}'
    if created_by is not None:
        created_by_name = (created_by.get_full_name() or '').strip() or created_by.username or created_by.email or f'User {created_by.id}'

    return {
        'id': task.id,
        'title': task.title,
        'description': task.description,
        'status': task.status,
        'priority': task.priority,
        'assigned_to_id': assigned_to.id if assigned_to else None,
        'assigned_to_name': assigned_to_name,
        'created_by_id': created_by.id if created_by else None,
        'created_by_name': created_by_name,
        'due_date': task.due_date.isoformat() if task.due_date else None,
        'completed_at': task.completed_at.isoformat() if task.completed_at else None,
        'created_at': task.created_at.isoformat(),
        'updated_at': task.updated_at.isoformat(),
    }


def _serialize_shared_file(shared_file):
    uploader = shared_file.uploaded_by
    uploader_name = 'Unknown User'
    if uploader is not None:
        uploader_name = (uploader.get_full_name() or '').strip() or uploader.username or uploader.email or f'User {uploader.id}'

    return {
        'id': shared_file.id,
        'title': shared_file.title,
        'note': shared_file.note,
        'original_name': shared_file.original_name,
        'size_bytes': int(shared_file.size_bytes or 0),
        'uploaded_by_id': uploader.id if uploader else None,
        'uploaded_by_name': uploader_name,
        'created_at': shared_file.created_at.isoformat(),
        'download_url': reverse('api_office_work_share_download', args=[shared_file.id]),
    }


def _parse_due_date(raw):
    raw_value = str(raw or '').strip()
    if not raw_value:
        return None
    try:
        return date.fromisoformat(raw_value)
    except ValueError:
        return 'invalid'


@login_required
@require_any_admin
def office_work_page(request):
    return render(request, 'officework/office-work.html', {'active_page': 'office_work'})


@require_http_methods(['GET'])
@api_require_any_admin
def api_office_work_chat_list(request):
    limit = max(1, min(_parse_int(request.GET.get('limit'), 150), 300))
    after_id = _parse_int(request.GET.get('after_id'), 0)

    qs = OfficeWorkChatMessage.objects.select_related('sender').order_by('id')
    if after_id > 0:
        qs = qs.filter(id__gt=after_id)[:limit]
        messages = list(qs)
    else:
        latest = list(qs.reverse()[:limit])
        messages = list(reversed(latest))

    return JsonResponse({
        'success': True,
        'messages': [_serialize_chat_message(item) for item in messages],
    })


@require_http_methods(['POST'])
@api_require_any_admin
def api_office_work_chat_send(request):
    body = _parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON body.'}, status=400)

    message_text = str(body.get('message') or '').strip()
    if not message_text:
        return JsonResponse({'success': False, 'message': 'Message is required.'}, status=400)

    if len(message_text) > MAX_CHAT_MESSAGE_LENGTH:
        message_text = message_text[:MAX_CHAT_MESSAGE_LENGTH]

    message = OfficeWorkChatMessage.objects.create(
        sender=request.user,
        message=message_text,
    )
    message = OfficeWorkChatMessage.objects.select_related('sender').get(pk=message.pk)

    return JsonResponse({
        'success': True,
        'message': 'Chat message sent.',
        'item': _serialize_chat_message(message),
    })


@require_http_methods(['GET'])
@api_require_any_admin
def api_office_work_tasks_list(request):
    tasks = OfficeWorkTask.objects.select_related('created_by', 'assigned_to').all()[:300]
    members = _allowed_members_qs()

    return JsonResponse({
        'success': True,
        'tasks': [_serialize_task(task) for task in tasks],
        'members': [_serialize_member(member) for member in members],
        'status_choices': [
            OfficeWorkTask.STATUS_TODO,
            OfficeWorkTask.STATUS_IN_PROGRESS,
            OfficeWorkTask.STATUS_DONE,
        ],
        'priority_choices': [
            OfficeWorkTask.PRIORITY_LOW,
            OfficeWorkTask.PRIORITY_NORMAL,
            OfficeWorkTask.PRIORITY_HIGH,
        ],
    })


@require_http_methods(['POST'])
@api_require_any_admin
def api_office_work_task_create(request):
    body = _parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON body.'}, status=400)

    title = str(body.get('title') or '').strip()
    description = str(body.get('description') or '').strip()
    status = str(body.get('status') or OfficeWorkTask.STATUS_TODO).strip().lower()
    priority = str(body.get('priority') or OfficeWorkTask.PRIORITY_NORMAL).strip().lower()

    if not title:
        return JsonResponse({'success': False, 'message': 'Task title is required.'}, status=400)

    valid_statuses = {OfficeWorkTask.STATUS_TODO, OfficeWorkTask.STATUS_IN_PROGRESS, OfficeWorkTask.STATUS_DONE}
    if status not in valid_statuses:
        status = OfficeWorkTask.STATUS_TODO

    valid_priorities = {OfficeWorkTask.PRIORITY_LOW, OfficeWorkTask.PRIORITY_NORMAL, OfficeWorkTask.PRIORITY_HIGH}
    if priority not in valid_priorities:
        priority = OfficeWorkTask.PRIORITY_NORMAL

    assigned_to = None
    assigned_to_id = _parse_int(body.get('assigned_to_id'), 0)
    if assigned_to_id > 0:
        assigned_to = get_object_or_404(_allowed_members_qs(), id=assigned_to_id)

    due_date = _parse_due_date(body.get('due_date'))
    if due_date == 'invalid':
        return JsonResponse({'success': False, 'message': 'Invalid due_date format. Use YYYY-MM-DD.'}, status=400)

    completed_at = timezone.now() if status == OfficeWorkTask.STATUS_DONE else None

    task = OfficeWorkTask.objects.create(
        title=title[:180],
        description=description,
        status=status,
        priority=priority,
        created_by=request.user,
        assigned_to=assigned_to,
        due_date=due_date,
        completed_at=completed_at,
    )
    task = OfficeWorkTask.objects.select_related('created_by', 'assigned_to').get(pk=task.pk)

    return JsonResponse({
        'success': True,
        'message': 'Task created.',
        'task': _serialize_task(task),
    })


@require_http_methods(['POST'])
@api_require_any_admin
def api_office_work_task_update(request, task_id):
    task = get_object_or_404(OfficeWorkTask.objects.select_related('created_by', 'assigned_to'), pk=task_id)

    body = _parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON body.'}, status=400)

    if 'title' in body:
        title = str(body.get('title') or '').strip()
        if not title:
            return JsonResponse({'success': False, 'message': 'Task title cannot be empty.'}, status=400)
        task.title = title[:180]

    if 'description' in body:
        task.description = str(body.get('description') or '').strip()

    if 'priority' in body:
        new_priority = str(body.get('priority') or '').strip().lower()
        valid_priorities = {OfficeWorkTask.PRIORITY_LOW, OfficeWorkTask.PRIORITY_NORMAL, OfficeWorkTask.PRIORITY_HIGH}
        if new_priority not in valid_priorities:
            return JsonResponse({'success': False, 'message': 'Invalid priority.'}, status=400)
        task.priority = new_priority

    if 'status' in body:
        new_status = str(body.get('status') or '').strip().lower()
        valid_statuses = {OfficeWorkTask.STATUS_TODO, OfficeWorkTask.STATUS_IN_PROGRESS, OfficeWorkTask.STATUS_DONE}
        if new_status not in valid_statuses:
            return JsonResponse({'success': False, 'message': 'Invalid status.'}, status=400)
        task.status = new_status
        if new_status == OfficeWorkTask.STATUS_DONE and task.completed_at is None:
            task.completed_at = timezone.now()
        elif new_status != OfficeWorkTask.STATUS_DONE:
            task.completed_at = None

    if 'assigned_to_id' in body:
        assigned_to_id = _parse_int(body.get('assigned_to_id'), 0)
        if assigned_to_id <= 0:
            task.assigned_to = None
        else:
            task.assigned_to = get_object_or_404(_allowed_members_qs(), id=assigned_to_id)

    if 'due_date' in body:
        parsed_due_date = _parse_due_date(body.get('due_date'))
        if parsed_due_date == 'invalid':
            return JsonResponse({'success': False, 'message': 'Invalid due_date format. Use YYYY-MM-DD.'}, status=400)
        task.due_date = parsed_due_date

    task.save()
    task = OfficeWorkTask.objects.select_related('created_by', 'assigned_to').get(pk=task.pk)

    return JsonResponse({
        'success': True,
        'message': 'Task updated.',
        'task': _serialize_task(task),
    })


@require_http_methods(['POST'])
@api_require_any_admin
def api_office_work_task_delete(request, task_id):
    task = get_object_or_404(OfficeWorkTask, pk=task_id)
    task.delete()
    return JsonResponse({'success': True, 'message': 'Task deleted.'})


@require_http_methods(['GET'])
@api_require_any_admin
def api_office_work_share_list(request):
    shared_files = OfficeWorkSharedFile.objects.select_related('uploaded_by').all()[:300]
    return JsonResponse({
        'success': True,
        'files': [_serialize_shared_file(item) for item in shared_files],
    })


@require_http_methods(['POST'])
@api_require_any_admin
def api_office_work_share_upload(request):
    upload = request.FILES.get('file')
    if upload is None:
        return JsonResponse({'success': False, 'message': 'Please choose a file.'}, status=400)

    size_bytes = int(getattr(upload, 'size', 0) or 0)
    if size_bytes <= 0:
        return JsonResponse({'success': False, 'message': 'File is empty.'}, status=400)

    if size_bytes > MAX_FILE_UPLOAD_BYTES:
        return JsonResponse({'success': False, 'message': 'File is too large (max 50 MB).'}, status=400)

    title = str(request.POST.get('title') or '').strip()
    note = str(request.POST.get('note') or '').strip()

    shared_file = OfficeWorkSharedFile.objects.create(
        uploaded_by=request.user,
        title=title[:200],
        note=note,
        original_name=(getattr(upload, 'name', '') or '')[:255],
        file=upload,
        size_bytes=size_bytes,
    )
    shared_file = OfficeWorkSharedFile.objects.select_related('uploaded_by').get(pk=shared_file.pk)

    return JsonResponse({
        'success': True,
        'message': 'File shared successfully.',
        'file': _serialize_shared_file(shared_file),
    })


@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_office_work_share_download(request, file_id):
    shared_file = get_object_or_404(OfficeWorkSharedFile, pk=file_id)
    if not shared_file.file:
        raise Http404('File not found.')

    try:
        file_handle = shared_file.file.open('rb')
    except FileNotFoundError:
        raise Http404('File missing from storage.')

    download_name = shared_file.original_name or shared_file.file.name.rsplit('/', 1)[-1] or f'office-file-{shared_file.id}'
    return FileResponse(file_handle, as_attachment=True, filename=download_name)


@require_http_methods(['POST'])
@api_require_any_admin
def api_office_work_share_delete(request, file_id):
    shared_file = get_object_or_404(OfficeWorkSharedFile, pk=file_id)
    if shared_file.file:
        shared_file.file.delete(save=False)
    shared_file.delete()
    return JsonResponse({'success': True, 'message': 'Shared file deleted.'})
