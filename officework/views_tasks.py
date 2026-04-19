from __future__ import annotations

import uuid

from django.contrib.auth.decorators import login_required
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from accounts.rate_limit import rate_limit
from core.services.permission_service import api_require_any_admin, require_any_admin
from core.services.realtime_service import publish_topic_event

from .models import OfficeWorkTask, OfficeWorkTaskComment
from .upload_security import is_blocked_upload_name, safe_download_filename
from .views_common import (
    MAX_TASK_DESCRIPTION_LENGTH,
    MAX_TASK_CHECKLIST_ITEMS,
    MAX_TASK_COMMENT_ATTACHMENT_BYTES,
    MAX_TASK_COMMENT_LENGTH,
    OFFICEWORK_TASKS_TOPIC,
    allowed_members_qs,
    parse_bool,
    parse_due_date,
    parse_int,
    parse_json_body,
    serialize_member,
    serialize_task_comment,
    serialize_task,
)


def _allowed_member_map():
    members = list(allowed_members_qs())
    return {member.id: member for member in members}


def _sanitize_member_id_list(raw_values, member_map):
    cleaned = []
    seen = set()
    values = raw_values if isinstance(raw_values, (list, tuple)) else []
    for raw in values:
        member_id = parse_int(raw, 0)
        if member_id <= 0 or member_id not in member_map or member_id in seen:
            continue
        seen.add(member_id)
        cleaned.append(member_id)
    return cleaned


def _is_task_owner_or_primary_assignee(user, task):
    user_id = int(getattr(user, 'id', 0) or 0)
    return user_id > 0 and user_id in {int(task.created_by_id or 0), int(task.assigned_to_id or 0)}


def _ensure_followers(task):
    follower_ids = []
    seen = set()
    for member_id in (
        int(task.created_by_id or 0),
        int(task.assigned_to_id or 0),
        *[parse_int(item, 0) for item in (task.collaborator_ids or [])],
        *[parse_int(item, 0) for item in (task.follower_ids or [])],
    ):
        if member_id <= 0 or member_id in seen:
            continue
        seen.add(member_id)
        follower_ids.append(member_id)
    task.follower_ids = follower_ids


def _normalize_checklist_items(raw_items, member_map, existing_items, actor_id, creator_id):
    if not isinstance(raw_items, list):
        raise ValueError('Checklist items must be an array.')

    existing_by_id = {}
    for existing in existing_items if isinstance(existing_items, list) else []:
        if not isinstance(existing, dict):
            continue
        existing_id = str(existing.get('id') or '').strip()
        if existing_id:
            existing_by_id[existing_id] = existing

    normalized = []
    now_iso = timezone.now().isoformat()

    for raw in raw_items[:MAX_TASK_CHECKLIST_ITEMS]:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get('title') or '').strip()
        if not title:
            continue
        item_id = str(raw.get('id') or '').strip() or f'ck_{uuid.uuid4().hex[:12]}'
        assigned_to_id = parse_int(raw.get('assigned_to_id'), 0)
        if assigned_to_id not in member_map:
            assigned_to_id = None
        is_done = parse_bool(raw.get('is_done'), False)

        previous = existing_by_id.get(item_id) or {}
        was_done = bool(previous.get('is_done'))
        previous_assignee = parse_int(previous.get('assigned_to_id'), 0)
        effective_assignee = assigned_to_id or previous_assignee or 0

        done_by_id = parse_int(previous.get('done_by_id'), 0) or None
        done_at = str(previous.get('done_at') or '').strip() or None

        if is_done and not was_done:
            allowed_to_mark = actor_id == creator_id or (effective_assignee > 0 and actor_id == effective_assignee)
            if not allowed_to_mark:
                raise PermissionError('Only the task creator or assigned checklist member can mark this item done.')
            done_by_id = actor_id
            done_at = now_iso
        elif not is_done:
            allowed_to_unmark = actor_id == creator_id or (effective_assignee > 0 and actor_id == effective_assignee)
            if was_done and not allowed_to_unmark:
                raise PermissionError('Only the task creator or assigned checklist member can reopen this item.')
            done_by_id = None
            done_at = None

        normalized.append({
            'id': item_id,
            'title': title[:220],
            'assigned_to_id': effective_assignee if effective_assignee > 0 else None,
            'is_done': bool(is_done),
            'done_by_id': done_by_id,
            'done_at': done_at,
        })

    return normalized


def _task_query_set():
    return OfficeWorkTask.objects.select_related(
        'created_by',
        'assigned_to',
        'completion_requested_by',
        'completion_approved_by',
    )


def _resolve_approval_decision(body):
    if 'approval_decision' in body:
        return str(body.get('approval_decision') or '').strip().lower()
    if 'approve_completion' in body:
        return 'approve' if parse_bool(body.get('approve_completion'), False) else 'reject'
    return ''


@require_http_methods(['GET'])
@rate_limit(max_requests=180, window_seconds=60, key_prefix='ow_tasks_list')
@api_require_any_admin
def api_office_work_tasks_list(request):
    tasks = _task_query_set().all()[:300]
    members = allowed_members_qs()

    return JsonResponse({
        'success': True,
        'tasks': [serialize_task(task) for task in tasks],
        'members': [serialize_member(member) for member in members],
        'status_choices': [
            OfficeWorkTask.STATUS_TODO,
            OfficeWorkTask.STATUS_IN_PROGRESS,
            OfficeWorkTask.STATUS_DONE,
            OfficeWorkTask.STATUS_PENDING,
        ],
        'priority_choices': [
            OfficeWorkTask.PRIORITY_LOW,
            OfficeWorkTask.PRIORITY_NORMAL,
            OfficeWorkTask.PRIORITY_HIGH,
        ],
    })


@require_http_methods(['POST'])
@rate_limit(max_requests=60, window_seconds=60, key_prefix='ow_task_create')
@api_require_any_admin
def api_office_work_task_create(request):
    body = parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON body.'}, status=400)

    title = str(body.get('title') or '').strip()
    description = str(body.get('description') or '').strip()
    priority = str(body.get('priority') or OfficeWorkTask.PRIORITY_NORMAL).strip().lower()

    if not title:
        return JsonResponse({'success': False, 'message': 'Task title is required.'}, status=400)

    valid_priorities = {OfficeWorkTask.PRIORITY_LOW, OfficeWorkTask.PRIORITY_NORMAL, OfficeWorkTask.PRIORITY_HIGH}
    if priority not in valid_priorities:
        priority = OfficeWorkTask.PRIORITY_NORMAL

    member_map = _allowed_member_map()

    assigned_to = None
    assigned_to_id = parse_int(body.get('assigned_to_id'), 0)
    if assigned_to_id > 0:
        assigned_to = member_map.get(assigned_to_id)
        if assigned_to is None:
            return JsonResponse({'success': False, 'message': 'Invalid assigned member.'}, status=400)

    collaborator_ids = _sanitize_member_id_list(body.get('collaborator_ids') or [], member_map)
    collaborator_ids = [member_id for member_id in collaborator_ids if member_id != assigned_to_id and member_id != request.user.id]

    checklist_items = []
    raw_checklist = body.get('checklist_items')
    if raw_checklist is not None:
        try:
            checklist_items = _normalize_checklist_items(
                raw_items=raw_checklist,
                member_map=member_map,
                existing_items=[],
                actor_id=int(request.user.id or 0),
                creator_id=int(request.user.id or 0),
            )
        except ValueError as exc:
            return JsonResponse({'success': False, 'message': str(exc)}, status=400)
        except PermissionError as exc:
            return JsonResponse({'success': False, 'message': str(exc)}, status=403)

    due_date = parse_due_date(body.get('due_date'))
    if due_date == 'invalid':
        return JsonResponse({'success': False, 'message': 'Invalid due_date format. Use YYYY-MM-DD.'}, status=400)

    task = OfficeWorkTask.objects.create(
        title=title[:180],
        description=description[:MAX_TASK_DESCRIPTION_LENGTH],
        status=OfficeWorkTask.STATUS_TODO,
        priority=priority,
        created_by=request.user,
        assigned_to=assigned_to,
        collaborator_ids=collaborator_ids,
        checklist_items=checklist_items,
        due_date=due_date,
    )
    _ensure_followers(task)
    task.save(update_fields=['follower_ids'])

    task = _task_query_set().get(pk=task.pk)
    task_payload = serialize_task(task)

    publish_topic_event(
        topic=OFFICEWORK_TASKS_TOPIC,
        event_type='officework.task.created',
        payload={
            'task': task_payload,
            'task_id': task.id,
            'actor_id': request.user.id,
        },
    )

    return JsonResponse({
        'success': True,
        'message': 'Card created in To Do.',
        'task': task_payload,
    })


@require_http_methods(['POST'])
@rate_limit(max_requests=120, window_seconds=60, key_prefix='ow_task_update')
@api_require_any_admin
def api_office_work_task_update(request, task_id):
    task = get_object_or_404(_task_query_set(), pk=task_id)

    body = parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON body.'}, status=400)

    actor_id = int(request.user.id or 0)
    creator_id = int(task.created_by_id or 0)
    approval_decision = _resolve_approval_decision(body)
    response_message = 'Task updated.'

    member_map = _allowed_member_map()

    if 'title' in body:
        title = str(body.get('title') or '').strip()
        if not title:
            return JsonResponse({'success': False, 'message': 'Task title cannot be empty.'}, status=400)
        task.title = title[:180]

    if 'description' in body:
        task.description = str(body.get('description') or '').strip()[:MAX_TASK_DESCRIPTION_LENGTH]

    if 'priority' in body:
        new_priority = str(body.get('priority') or '').strip().lower()
        valid_priorities = {OfficeWorkTask.PRIORITY_LOW, OfficeWorkTask.PRIORITY_NORMAL, OfficeWorkTask.PRIORITY_HIGH}
        if new_priority not in valid_priorities:
            return JsonResponse({'success': False, 'message': 'Invalid priority.'}, status=400)
        task.priority = new_priority

    if 'collaborator_ids' in body:
        if not _is_task_owner_or_primary_assignee(request.user, task):
            return JsonResponse({'success': False, 'message': 'Only task creator or primary assignee can edit collaborators.'}, status=403)
        collaborator_ids = _sanitize_member_id_list(body.get('collaborator_ids') or [], member_map)
        collaborator_ids = [
            member_id for member_id in collaborator_ids
            if member_id != int(task.created_by_id or 0) and member_id != int(task.assigned_to_id or 0)
        ]
        task.collaborator_ids = collaborator_ids

    if 'follower_ids' in body:
        if not _is_task_owner_or_primary_assignee(request.user, task):
            return JsonResponse({'success': False, 'message': 'Only task creator or primary assignee can edit followers.'}, status=403)
        task.follower_ids = _sanitize_member_id_list(body.get('follower_ids') or [], member_map)

    if 'checklist_items' in body:
        if not _is_task_owner_or_primary_assignee(request.user, task):
            return JsonResponse({'success': False, 'message': 'Only task creator or primary assignee can edit checklist items.'}, status=403)
        try:
            task.checklist_items = _normalize_checklist_items(
                raw_items=body.get('checklist_items'),
                member_map=member_map,
                existing_items=task.checklist_items,
                actor_id=actor_id,
                creator_id=creator_id,
            )
        except ValueError as exc:
            return JsonResponse({'success': False, 'message': str(exc)}, status=400)
        except PermissionError as exc:
            return JsonResponse({'success': False, 'message': str(exc)}, status=403)

    if 'status' in body:
        new_status = str(body.get('status') or '').strip().lower()
        valid_statuses = {
            OfficeWorkTask.STATUS_TODO,
            OfficeWorkTask.STATUS_IN_PROGRESS,
            OfficeWorkTask.STATUS_DONE,
            OfficeWorkTask.STATUS_PENDING,
        }
        if new_status not in valid_statuses:
            return JsonResponse({'success': False, 'message': 'Invalid status.'}, status=400)
        if new_status == OfficeWorkTask.STATUS_DONE and actor_id != creator_id:
            task.status = OfficeWorkTask.STATUS_PENDING
            task.completed_at = None
            task.completion_requested_at = timezone.now()
            task.completion_requested_by = request.user
            task.completion_approved_at = None
            task.completion_approved_by = None
            response_message = 'Completion request sent to task creator for approval.'
        else:
            task.status = new_status
            if new_status == OfficeWorkTask.STATUS_DONE:
                task.completed_at = timezone.now()
                task.completion_approved_at = timezone.now()
                task.completion_approved_by = request.user
                if not task.completion_requested_at:
                    task.completion_requested_at = timezone.now()
                if task.completion_requested_by_id is None:
                    task.completion_requested_by = request.user
            else:
                task.completed_at = None
                if new_status != OfficeWorkTask.STATUS_PENDING:
                    task.completion_requested_at = None
                    task.completion_requested_by = None
                task.completion_approved_at = None
                task.completion_approved_by = None

    if 'assigned_to_id' in body:
        assigned_to_id = parse_int(body.get('assigned_to_id'), 0)
        if assigned_to_id <= 0:
            task.assigned_to = None
        else:
            task.assigned_to = member_map.get(assigned_to_id)
            if task.assigned_to is None:
                return JsonResponse({'success': False, 'message': 'Invalid assigned member.'}, status=400)

    if approval_decision:
        if actor_id != creator_id:
            return JsonResponse({'success': False, 'message': 'Only the task creator can approve completion.'}, status=403)
        if approval_decision not in {'approve', 'reject'}:
            return JsonResponse({'success': False, 'message': 'Invalid approval decision.'}, status=400)
        if approval_decision == 'approve':
            task.status = OfficeWorkTask.STATUS_DONE
            task.completed_at = timezone.now()
            task.completion_approved_at = timezone.now()
            task.completion_approved_by = request.user
            if not task.completion_requested_at:
                task.completion_requested_at = timezone.now()
            if task.completion_requested_by_id is None:
                task.completion_requested_by = request.user
            response_message = 'Completion approved. Card moved to Done.'
        else:
            task.status = OfficeWorkTask.STATUS_IN_PROGRESS
            task.completed_at = None
            task.completion_approved_at = None
            task.completion_approved_by = None
            task.completion_requested_at = None
            task.completion_requested_by = None
            response_message = 'Completion rejected. Card moved back to In Progress.'

    if 'due_date' in body:
        parsed_due_date = parse_due_date(body.get('due_date'))
        if parsed_due_date == 'invalid':
            return JsonResponse({'success': False, 'message': 'Invalid due_date format. Use YYYY-MM-DD.'}, status=400)
        task.due_date = parsed_due_date

    _ensure_followers(task)
    task.save()
    task = _task_query_set().get(pk=task.pk)
    task_payload = serialize_task(task)

    publish_topic_event(
        topic=OFFICEWORK_TASKS_TOPIC,
        event_type='officework.task.updated',
        payload={
            'task': task_payload,
            'task_id': task.id,
            'actor_id': request.user.id,
        },
    )

    return JsonResponse({
        'success': True,
        'message': response_message,
        'task': task_payload,
    })


@require_http_methods(['POST'])
@rate_limit(max_requests=60, window_seconds=60, key_prefix='ow_task_delete')
@api_require_any_admin
def api_office_work_task_delete(request, task_id):
    task = get_object_or_404(OfficeWorkTask, pk=task_id)
    deleted_task_id = int(task.id)
    task.delete()

    publish_topic_event(
        topic=OFFICEWORK_TASKS_TOPIC,
        event_type='officework.task.deleted',
        payload={
            'task_id': deleted_task_id,
            'actor_id': request.user.id,
        },
    )

    return JsonResponse({'success': True, 'message': 'Task deleted.'})


@require_http_methods(['GET'])
@rate_limit(max_requests=240, window_seconds=60, key_prefix='ow_task_comment_list')
@api_require_any_admin
def api_office_work_task_comments_list(request, task_id):
    task = get_object_or_404(OfficeWorkTask, pk=task_id)
    comments = OfficeWorkTaskComment.objects.select_related('sender').filter(task=task).order_by('id')[:500]
    return JsonResponse({
        'success': True,
        'task_id': task.id,
        'comments': [serialize_task_comment(item) for item in comments],
    })


@require_http_methods(['POST'])
@rate_limit(max_requests=80, window_seconds=60, key_prefix='ow_task_comment_create')
@api_require_any_admin
def api_office_work_task_comment_create(request, task_id):
    task = get_object_or_404(OfficeWorkTask, pk=task_id)

    is_multipart = 'multipart/form-data' in str(request.META.get('CONTENT_TYPE') or '').lower()
    body = None if is_multipart else parse_json_body(request)
    if body is None and not is_multipart:
        return JsonResponse({'success': False, 'message': 'Invalid JSON body.'}, status=400)

    payload = body or {}
    if is_multipart:
        payload = request.POST

    message_text = str(payload.get('message') or '').strip()
    if len(message_text) > MAX_TASK_COMMENT_LENGTH:
        message_text = message_text[:MAX_TASK_COMMENT_LENGTH]

    attachment = request.FILES.get('file') if is_multipart else None
    if not message_text and attachment is None:
        return JsonResponse({'success': False, 'message': 'Message or attachment is required.'}, status=400)

    if attachment is not None:
        size_bytes = int(getattr(attachment, 'size', 0) or 0)
        if size_bytes <= 0:
            return JsonResponse({'success': False, 'message': 'Attachment is empty.'}, status=400)
        if size_bytes > MAX_TASK_COMMENT_ATTACHMENT_BYTES:
            return JsonResponse({'success': False, 'message': 'Attachment too large (max 50 MB).'}, status=400)
        if is_blocked_upload_name(getattr(attachment, 'name', '')):
            return JsonResponse({'success': False, 'message': 'This file type is not allowed for security reasons.'}, status=400)

    comment = OfficeWorkTaskComment.objects.create(
        task=task,
        sender=request.user,
        message=message_text,
        attachment=attachment,
        attachment_original_name=(getattr(attachment, 'name', '') or '')[:255],
        attachment_size_bytes=int(getattr(attachment, 'size', 0) or 0) if attachment is not None else 0,
        attachment_content_type=str(getattr(attachment, 'content_type', '') or '')[:160],
    )
    comment = OfficeWorkTaskComment.objects.select_related('sender').get(pk=comment.pk)
    comment_payload = serialize_task_comment(comment)

    publish_topic_event(
        topic=OFFICEWORK_TASKS_TOPIC,
        event_type='officework.task.comment.created',
        payload={
            'task_id': task.id,
            'comment': comment_payload,
            'actor_id': request.user.id,
        },
    )

    return JsonResponse({
        'success': True,
        'message': 'Comment posted.',
        'comment': comment_payload,
    })


@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_office_work_task_comment_attachment_download(request, comment_id):
    comment = get_object_or_404(OfficeWorkTaskComment, id=comment_id)
    if not comment.attachment:
        raise Http404('Attachment not found.')

    try:
        file_handle = comment.attachment.open('rb')
    except FileNotFoundError:
        raise Http404('Attachment missing from storage.')

    download_name = safe_download_filename(
        comment.attachment_original_name or comment.attachment.name.rsplit('/', 1)[-1],
        fallback=f'task-comment-file-{comment.id}',
    )
    return FileResponse(file_handle, as_attachment=True, filename=download_name)
