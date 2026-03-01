"""
Backup API views
================

Endpoints consumed by the dashboard backup modal, the client-selection page,
and the Manage Panel backup management tab.

All destructive actions require a 10-digit confirmation code.
"""

import json
import logging
import os
import random
import string

from django.conf import settings as django_settings
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q
from django.http import JsonResponse, FileResponse
from django.shortcuts import render, get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from core.models import BackupTask, User
from core.services.permission_service import require_super_admin
from client.models import Client
from idcards.models import IDCardGroup, IDCardTable, IDCard

logger = logging.getLogger(__name__)


# ─── Helper ──────────────────────────────────────────────────────────────

def _generate_code() -> str:
    """Generate a 10-digit numeric code."""
    return ''.join(random.choices(string.digits, k=10))


def _json_error(msg, status=400):
    return JsonResponse({'success': False, 'message': msg}, status=status)


# ─── Page views ──────────────────────────────────────────────────────────

@login_required
@require_super_admin
def backup_select_clients(request):
    """
    Page: shows all clients with sort/filter for backup selection.
    Only accessible after the confirmation code has been verified.
    """
    task_id = request.GET.get('task')
    if not task_id:
        return render(request, 'backup-select-clients.html', {'error': 'No backup task specified.'})

    task = get_object_or_404(BackupTask, pk=task_id, created_by=request.user, status='pending')

    # Sort parameter
    sort = request.GET.get('sort', 'most_data')

    clients_qs = Client.objects.filter(status='active').annotate(
        total_cards=Count('id_card_groups__tables__id_cards'),
        total_tables=Count('id_card_groups__tables', distinct=True),
    )

    if sort == 'most_data':
        clients_qs = clients_qs.order_by('-total_cards', '-created_at')
    elif sort == 'latest':
        clients_qs = clients_qs.order_by('-created_at')
    elif sort == 'oldest':
        clients_qs = clients_qs.order_by('created_at')
    elif sort == 'name':
        clients_qs = clients_qs.order_by('name')
    else:
        clients_qs = clients_qs.order_by('-total_cards')

    context = {
        'task': task,
        'clients': clients_qs,
        'current_sort': sort,
        'is_super_admin': True,
    }
    return render(request, 'backup-select-clients.html', context)


# ─── API endpoints ───────────────────────────────────────────────────────

@login_required
@require_super_admin
@require_http_methods(['POST'])
def api_backup_initiate(request):
    """
    Step 1 — Dashboard modal submits the 10-digit code.

    Creates a BackupTask in *pending* state and returns its ``task_id``
    so the frontend can redirect to the client-selection page.
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return _json_error('Invalid request body.')

    code = str(body.get('code', '')).strip()
    if len(code) != 10 or not code.isdigit():
        return _json_error('Please enter a valid 10-digit confirmation code.')

    # Create the task
    task = BackupTask.objects.create(
        created_by=request.user,
        confirmation_code=code,
        status='pending',
    )

    return JsonResponse({
        'success': True,
        'task_id': task.pk,
        'redirect_url': f'/panel/backup/select-clients/?task={task.pk}',
    })


@login_required
@require_super_admin
@require_http_methods(['POST'])
def api_backup_start(request):
    """
    Step 2 — Client-selection page submits chosen client IDs.

    Validates, stores them on the task, and launches the background worker.
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return _json_error('Invalid request body.')

    task_id = body.get('task_id')
    client_ids = body.get('client_ids', [])

    if not task_id:
        return _json_error('Missing task_id.')
    if not client_ids or not isinstance(client_ids, list):
        return _json_error('Please select at least one client.')

    task = get_object_or_404(BackupTask, pk=task_id, created_by=request.user)
    if task.status != 'pending':
        return _json_error('This backup task has already been started.')

    # Validate client IDs
    valid_clients = Client.objects.filter(pk__in=client_ids, status='active')
    if not valid_clients.exists():
        return _json_error('No valid active clients selected.')

    # Snapshot names for display
    names = {str(c.pk): c.name for c in valid_clients}
    task.client_ids = [c.pk for c in valid_clients]
    task.client_names = names
    task.total = valid_clients.count()
    task.save(update_fields=['client_ids', 'client_names', 'total'])

    # Launch background processing
    from core.services.backup_service import start_backup
    start_backup(task.pk)

    return JsonResponse({
        'success': True,
        'message': f'Backup started for {valid_clients.count()} client(s). You can track progress in the Manage Panel.',
    })


@login_required
@require_super_admin
@require_http_methods(['GET'])
def api_backup_status(request, task_id):
    """Poll backup progress from the Manage Panel or the selection page."""
    task = get_object_or_404(BackupTask, pk=task_id)

    data = {
        'success': True,
        'id': task.pk,
        'status': task.status,
        'progress': task.progress,
        'total': task.total,
        'progress_pct': task.progress_percentage,
        'current_client': task.current_client,
        'error_message': task.error_message,
        'auto_delete_at': task.auto_delete_at.isoformat() if task.auto_delete_at else None,
        'is_auto_delete_cancelled': task.is_auto_delete_cancelled,
        'time_remaining': task.time_remaining_seconds,
        'zip_files': task.zip_files,
        'client_names': task.client_names,
        'created_at': task.created_at.isoformat(),
    }
    return JsonResponse(data)


@login_required
@require_super_admin
@require_http_methods(['GET'])
def api_backup_list(request):
    """List all backup tasks (recent first) for the Manage Panel."""
    tasks = BackupTask.objects.order_by('-created_at')[:20]
    result = []
    for t in tasks:
        result.append({
            'id': t.pk,
            'status': t.status,
            'progress': t.progress,
            'total': t.total,
            'progress_pct': t.progress_percentage,
            'current_client': t.current_client,
            'auto_delete_at': t.auto_delete_at.isoformat() if t.auto_delete_at else None,
            'is_auto_delete_cancelled': t.is_auto_delete_cancelled,
            'time_remaining': t.time_remaining_seconds,
            'client_names': t.client_names,
            'created_at': t.created_at.isoformat(),
            'zip_count': len(t.zip_files or {}),
            'error_message': t.error_message,
        })
    return JsonResponse({'success': True, 'backups': result})


@login_required
@require_super_admin
@require_http_methods(['POST'])
def api_backup_cancel_auto_delete(request, task_id):
    """Cancel the 24-hour auto-delete timer (requires 10-digit code)."""
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return _json_error('Invalid request body.')

    code = str(body.get('code', '')).strip()
    if len(code) != 10 or not code.isdigit():
        return _json_error('Please enter a valid 10-digit code.')

    task = get_object_or_404(BackupTask, pk=task_id)
    if task.status != 'completed':
        return _json_error('Can only cancel auto-delete on completed backups.')

    if task.confirmation_code != code:
        return _json_error('Incorrect confirmation code.')

    task.is_auto_delete_cancelled = True
    task.save(update_fields=['is_auto_delete_cancelled'])

    return JsonResponse({'success': True, 'message': 'Auto-delete cancelled. Files will be kept until manually deleted.'})


@login_required
@require_super_admin
@require_http_methods(['POST'])
def api_backup_delete_now(request, task_id):
    """Immediately delete backup files (requires 10-digit code)."""
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return _json_error('Invalid request body.')

    code = str(body.get('code', '')).strip()
    if len(code) != 10 or not code.isdigit():
        return _json_error('Please enter a valid 10-digit code.')

    task = get_object_or_404(BackupTask, pk=task_id)
    if task.status not in ('completed', 'failed'):
        return _json_error('Cannot delete an active or already deleted backup.')

    if task.confirmation_code != code:
        return _json_error('Incorrect confirmation code.')

    from core.services.backup_service import delete_backup_files
    delete_backup_files(task.pk)

    return JsonResponse({'success': True, 'message': 'Backup files deleted successfully.'})


@login_required
@require_super_admin
@require_http_methods(['GET'])
def api_backup_download(request, task_id, client_id):
    """Download a specific client's ZIP from a completed backup."""
    task = get_object_or_404(BackupTask, pk=task_id, status='completed')
    info = (task.zip_files or {}).get(str(client_id))
    if not info:
        return _json_error('ZIP file not found for this client.', 404)

    file_path = info.get('path', '')
    abs_path = os.path.join(django_settings.MEDIA_ROOT, file_path)
    if not os.path.isfile(abs_path):
        return _json_error('ZIP file no longer exists on disk.', 404)

    return FileResponse(
        open(abs_path, 'rb'),
        as_attachment=True,
        filename=info.get('filename', 'backup.zip'),
    )


@login_required
@require_super_admin
@require_http_methods(['GET'])
def api_backup_generate_code(request):
    """Generate a 10-digit code for the backup confirmation modal."""
    return JsonResponse({'success': True, 'code': _generate_code()})
