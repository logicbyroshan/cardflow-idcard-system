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
