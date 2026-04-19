from __future__ import annotations

import json
from datetime import date

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone

from .services_chat import officework_allowed_members_qs, serialize_office_work_chat_message

User = get_user_model()
MAX_FILE_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_TASK_DESCRIPTION_LENGTH = 5000
MAX_TASK_COMMENT_LENGTH = 5000
MAX_TASK_COMMENT_ATTACHMENT_BYTES = 50 * 1024 * 1024
MAX_TASK_CHECKLIST_ITEMS = 60
MAX_SHARE_NOTE_LENGTH = 5000
OFFICEWORK_TASKS_TOPIC = 'officework.tasks'
OFFICEWORK_SHARE_TOPIC = 'officework.share'


def parse_int(raw, default=0):
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def parse_json_body(request):
    if not getattr(request, 'body', b''):
        return {}
    try:
        return json.loads(request.body.decode('utf-8'))
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


def parse_bool(raw, default=False):
    if isinstance(raw, bool):
        return raw
    if raw is None:
        return bool(default)
    text = str(raw).strip().lower()
    if text in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if text in {'0', 'false', 'no', 'n', 'off'}:
        return False
    return bool(default)


def allowed_members_qs():
    return officework_allowed_members_qs()


def serialize_member(user):
    full_name = (user.get_full_name() or '').strip()
    return {
        'id': user.id,
        'name': full_name or user.username or user.email or f'User {user.id}',
        'role': user.role,
        'role_display': user.get_role_display() if hasattr(user, 'get_role_display') else user.role,
    }


def serialize_chat_message(message):
    return serialize_office_work_chat_message(message)


def serialize_task(task):
    assigned_to = task.assigned_to
    created_by = task.created_by
    assigned_to_name = ''
    created_by_name = ''

    if assigned_to is not None:
        assigned_to_name = (assigned_to.get_full_name() or '').strip() or assigned_to.username or assigned_to.email or f'User {assigned_to.id}'
    if created_by is not None:
        created_by_name = (created_by.get_full_name() or '').strip() or created_by.username or created_by.email or f'User {created_by.id}'

    completion_requested_by = getattr(task, 'completion_requested_by', None)
    completion_approved_by = getattr(task, 'completion_approved_by', None)
    completion_requested_by_name = ''
    completion_approved_by_name = ''
    if completion_requested_by is not None:
        completion_requested_by_name = (
            (completion_requested_by.get_full_name() or '').strip()
            or completion_requested_by.username
            or completion_requested_by.email
            or f'User {completion_requested_by.id}'
        )
    if completion_approved_by is not None:
        completion_approved_by_name = (
            (completion_approved_by.get_full_name() or '').strip()
            or completion_approved_by.username
            or completion_approved_by.email
            or f'User {completion_approved_by.id}'
        )

    collaborator_ids = [int(item) for item in (task.collaborator_ids or []) if str(item).isdigit()]
    follower_ids = [int(item) for item in (task.follower_ids or []) if str(item).isdigit()]
    checklist_items = task.checklist_items if isinstance(task.checklist_items, list) else []

    return {
        'id': task.id,
        'title': task.title,
        'description': task.description,
        'status': task.status,
        'priority': task.priority,
        'assigned_to_id': assigned_to.id if assigned_to else None,
        'assigned_to_name': assigned_to_name,
        'collaborator_ids': collaborator_ids,
        'follower_ids': follower_ids,
        'checklist_items': checklist_items,
        'created_by_id': created_by.id if created_by else None,
        'created_by_name': created_by_name,
        'due_date': task.due_date.isoformat() if task.due_date else None,
        'completed_at': task.completed_at.isoformat() if task.completed_at else None,
        'completion_requested_at': task.completion_requested_at.isoformat() if task.completion_requested_at else None,
        'completion_requested_by_id': completion_requested_by.id if completion_requested_by else None,
        'completion_requested_by_name': completion_requested_by_name,
        'completion_approved_at': task.completion_approved_at.isoformat() if task.completion_approved_at else None,
        'completion_approved_by_id': completion_approved_by.id if completion_approved_by else None,
        'completion_approved_by_name': completion_approved_by_name,
        'created_at': task.created_at.isoformat(),
        'updated_at': task.updated_at.isoformat(),
    }


def serialize_task_comment(comment):
    sender = comment.sender
    sender_name = 'Unknown User'
    sender_role = ''
    sender_id = None
    if sender is not None:
        sender_id = sender.id
        sender_role = getattr(sender, 'role', '') or ''
        sender_name = (sender.get_full_name() or '').strip() or sender.username or sender.email or f'User {sender.id}'

    attachment = None
    if comment.attachment:
        attachment = {
            'name': comment.attachment_original_name or comment.attachment.name.rsplit('/', 1)[-1],
            'size_bytes': int(comment.attachment_size_bytes or 0),
            'content_type': comment.attachment_content_type or '',
            'download_url': reverse('api_office_work_task_comment_attachment_download', args=[comment.id]),
        }

    return {
        'id': comment.id,
        'task_id': comment.task_id,
        'message': comment.message,
        'sender_id': sender_id,
        'sender_name': sender_name,
        'sender_role': sender_role,
        'attachment': attachment,
        'created_at': comment.created_at.isoformat(),
    }


def serialize_shared_file(shared_file):
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


def parse_due_date(raw):
    raw_value = str(raw or '').strip()
    if not raw_value:
        return None
    try:
        return date.fromisoformat(raw_value)
    except ValueError:
        return 'invalid'
