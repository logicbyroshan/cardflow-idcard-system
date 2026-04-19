from __future__ import annotations

from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from accounts.rate_limit import rate_limit
from core.services.permission_service import api_require_any_admin
from core.services.realtime_service import publish_topic_event

from .models import OfficeWorkTask
from .views_common import (
    MAX_TASK_DESCRIPTION_LENGTH,
    OFFICEWORK_TASKS_TOPIC,
    allowed_members_qs,
    parse_due_date,
    parse_int,
    parse_json_body,
    serialize_member,
    serialize_task,
)


@require_http_methods(['GET'])
@rate_limit(max_requests=180, window_seconds=60, key_prefix='ow_tasks_list')
@api_require_any_admin
def api_office_work_tasks_list(request):
    tasks = OfficeWorkTask.objects.select_related('created_by', 'assigned_to').all()[:300]
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
    status = str(body.get('status') or OfficeWorkTask.STATUS_TODO).strip().lower()
    priority = str(body.get('priority') or OfficeWorkTask.PRIORITY_NORMAL).strip().lower()

    if not title:
        return JsonResponse({'success': False, 'message': 'Task title is required.'}, status=400)

    valid_statuses = {
        OfficeWorkTask.STATUS_TODO,
        OfficeWorkTask.STATUS_IN_PROGRESS,
        OfficeWorkTask.STATUS_DONE,
        OfficeWorkTask.STATUS_PENDING,
    }
    if status not in valid_statuses:
        status = OfficeWorkTask.STATUS_TODO

    valid_priorities = {OfficeWorkTask.PRIORITY_LOW, OfficeWorkTask.PRIORITY_NORMAL, OfficeWorkTask.PRIORITY_HIGH}
    if priority not in valid_priorities:
        priority = OfficeWorkTask.PRIORITY_NORMAL

    assigned_to = None
    assigned_to_id = parse_int(body.get('assigned_to_id'), 0)
    if assigned_to_id > 0:
        assigned_to = get_object_or_404(allowed_members_qs(), id=assigned_to_id)

    due_date = parse_due_date(body.get('due_date'))
    if due_date == 'invalid':
        return JsonResponse({'success': False, 'message': 'Invalid due_date format. Use YYYY-MM-DD.'}, status=400)

    completed_at = timezone.now() if status == OfficeWorkTask.STATUS_DONE else None

    task = OfficeWorkTask.objects.create(
        title=title[:180],
        description=description[:MAX_TASK_DESCRIPTION_LENGTH],
        status=status,
        priority=priority,
        created_by=request.user,
        assigned_to=assigned_to,
        due_date=due_date,
        completed_at=completed_at,
    )
    task = OfficeWorkTask.objects.select_related('created_by', 'assigned_to').get(pk=task.pk)
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
        'message': 'Task created.',
        'task': task_payload,
    })


@require_http_methods(['POST'])
@rate_limit(max_requests=120, window_seconds=60, key_prefix='ow_task_update')
@api_require_any_admin
def api_office_work_task_update(request, task_id):
    task = get_object_or_404(OfficeWorkTask.objects.select_related('created_by', 'assigned_to'), pk=task_id)

    body = parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON body.'}, status=400)

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
        task.status = new_status
        if new_status == OfficeWorkTask.STATUS_DONE and task.completed_at is None:
            task.completed_at = timezone.now()
        elif new_status != OfficeWorkTask.STATUS_DONE:
            task.completed_at = None

    if 'assigned_to_id' in body:
        assigned_to_id = parse_int(body.get('assigned_to_id'), 0)
        if assigned_to_id <= 0:
            task.assigned_to = None
        else:
            task.assigned_to = get_object_or_404(allowed_members_qs(), id=assigned_to_id)

    if 'due_date' in body:
        parsed_due_date = parse_due_date(body.get('due_date'))
        if parsed_due_date == 'invalid':
            return JsonResponse({'success': False, 'message': 'Invalid due_date format. Use YYYY-MM-DD.'}, status=400)
        task.due_date = parsed_due_date

    task.save()
    task = OfficeWorkTask.objects.select_related('created_by', 'assigned_to').get(pk=task.pk)
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
        'message': 'Task updated.',
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
