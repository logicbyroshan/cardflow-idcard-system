"""
Monitoring views  (panel app)
==============================
Client-side error reporting and monitoring dashboard API.
Moved from core/views/monitoring_api.py.
"""

import json
import logging
import os
import platform
import re
import shutil
import socket
import subprocess
from datetime import datetime, timezone as dt_timezone
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods, require_POST
from django.views.decorators.csrf import csrf_protect
from django.contrib.auth.decorators import login_required

logger = logging.getLogger('core.views')

_MAX_REPORTS_PER_MIN = 10
_MAX_LOG_FIELD_LEN = 500
_SERVER_INFO_CACHE_KEY = 'panel:server-info:snapshot:v2'
_SERVER_INFO_CACHE_TTL = 300


def _sanitize_log_value(val, max_len=_MAX_LOG_FIELD_LEN):
    if not isinstance(val, str):
        val = str(val) if val is not None else ''
    val = re.sub(r'[\r\n\x00-\x1f\x7f]', ' ', val)
    return val[:max_len]


def _format_bytes(size_bytes):
    size = float(max(size_bytes or 0, 0))
    units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    idx = 0
    while size >= 1024 and idx < len(units) - 1:
        size /= 1024.0
        idx += 1
    return f"{size:.1f} {units[idx]}"


def _dir_size_bytes(root_path):
    total = 0
    stack = [root_path]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    try:
                        if entry.is_symlink():
                            continue
                        if entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                        elif entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                    except (FileNotFoundError, PermissionError, OSError):
                        continue
        except (FileNotFoundError, PermissionError, OSError):
            continue
    return total


def _memory_snapshot():
    # Keep this dependency-free for quick deployment.
    if platform.system().lower().startswith('win'):
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ('dwLength', ctypes.c_ulong),
                ('dwMemoryLoad', ctypes.c_ulong),
                ('ullTotalPhys', ctypes.c_ulonglong),
                ('ullAvailPhys', ctypes.c_ulonglong),
                ('ullTotalPageFile', ctypes.c_ulonglong),
                ('ullAvailPageFile', ctypes.c_ulonglong),
                ('ullTotalVirtual', ctypes.c_ulonglong),
                ('ullAvailVirtual', ctypes.c_ulonglong),
                ('sullAvailExtendedVirtual', ctypes.c_ulonglong),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            total = int(stat.ullTotalPhys)
            free = int(stat.ullAvailPhys)
            used = max(total - free, 0)
            pct = round((used / total) * 100, 1) if total > 0 else 0
            return {
                'total_bytes': total,
                'used_bytes': used,
                'free_bytes': free,
                'used_pct': pct,
                'total_human': _format_bytes(total),
                'used_human': _format_bytes(used),
                'free_human': _format_bytes(free),
            }

    try:
        page_size = os.sysconf('SC_PAGE_SIZE')
        total_pages = os.sysconf('SC_PHYS_PAGES')
        avail_pages = os.sysconf('SC_AVPHYS_PAGES')
        total = int(page_size * total_pages)
        free = int(page_size * avail_pages)
        used = max(total - free, 0)
        pct = round((used / total) * 100, 1) if total > 0 else 0
        return {
            'total_bytes': total,
            'used_bytes': used,
            'free_bytes': free,
            'used_pct': pct,
            'total_human': _format_bytes(total),
            'used_human': _format_bytes(used),
            'free_human': _format_bytes(free),
        }
    except Exception:
        return {
            'total_bytes': 0,
            'used_bytes': 0,
            'free_bytes': 0,
            'used_pct': 0,
            'total_human': '0 B',
            'used_human': '0 B',
            'free_human': '0 B',
        }


def _dir_size_fast(path_obj):
    """Prefer fast native 'du' on Unix; fallback to Python walker."""
    path_str = str(path_obj)
    if os.name != 'nt' and shutil.which('du'):
        try:
            proc = subprocess.run(
                ['du', '-sb', path_str],
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout:
                first_token = proc.stdout.split()[0]
                return int(first_token)
        except Exception:
            pass
    return _dir_size_bytes(path_str)


def _safe_rel_contains(parent: Path, child: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except Exception:
        return False


def _other_usage_breakdown(base_dir: Path, other_total_bytes: int, project_total_bytes: int):
    """
    Estimate where 'other system usage' is consumed on the same machine.
    We only expose labels, never absolute paths.
    """
    candidates = [
        ('System Packages', Path('/usr')),
        ('System Data', Path('/var')),
        ('Other Home Data', Path('/home')),
        ('Optional Software', Path('/opt')),
        ('Snap Packages', Path('/snap')),
        ('Temp Data', Path('/tmp')),
        ('Root Home', Path('/root')),
    ]

    if os.name == 'nt':
        # Windows fallback labels (only if paths exist)
        system_drive = Path(os.environ.get('SystemDrive', 'C:') + '\\')
        candidates = [
            ('Windows OS', system_drive / 'Windows'),
            ('Program Files', system_drive / 'Program Files'),
            ('Program Files x86', system_drive / 'Program Files (x86)'),
            ('ProgramData', system_drive / 'ProgramData'),
            ('Users Data', system_drive / 'Users'),
            ('Temp Data', Path(os.environ.get('TEMP', str(system_drive / 'Temp')))),
        ]

    parts = []
    measured_sum = 0
    for label, dir_path in candidates:
        if not dir_path.exists() or not dir_path.is_dir():
            continue

        try:
            size_bytes = _dir_size_fast(dir_path)
        except Exception:
            continue

        # If this bucket contains project root, remove project to avoid double counting.
        if _safe_rel_contains(dir_path, base_dir):
            size_bytes = max(size_bytes - project_total_bytes, 0)

        if size_bytes <= 0:
            continue

        measured_sum += size_bytes
        parts.append({
            'name': label,
            'size_bytes': int(size_bytes),
            'size_human': _format_bytes(size_bytes),
        })

    unattributed = max(other_total_bytes - measured_sum, 0)
    if unattributed > 0:
        parts.append({
            'name': 'Unattributed / Restricted',
            'size_bytes': int(unattributed),
            'size_human': _format_bytes(unattributed),
        })

    for item in parts:
        item['pct_of_other'] = round((item['size_bytes'] / other_total_bytes) * 100, 1) if other_total_bytes > 0 else 0
        item['pct_of_used_disk'] = round((item['size_bytes'] / max(other_total_bytes, 1)) * 100, 1) if other_total_bytes > 0 else 0

    parts.sort(key=lambda x: x['size_bytes'], reverse=True)
    return parts


def _database_storage_snapshot(base_dir):
    backend = settings.DATABASES.get('default', {}).get('ENGINE', '')
    db_name = settings.DATABASES.get('default', {}).get('NAME', '')

    db_info = {
        'backend': backend.split('.')[-1] if backend else 'unknown',
        'name': str(db_name) if db_name else '-',
        'size_bytes': 0,
        'size_human': '0 B',
        'status': 'unknown',
        'error': '',
    }

    try:
        if 'sqlite' in backend:
            db_file = Path(db_name) if db_name else (base_dir / 'db.sqlite3')
            if db_file.exists() and db_file.is_file():
                size_bytes = db_file.stat().st_size
                db_info.update({
                    'size_bytes': int(size_bytes),
                    'size_human': _format_bytes(size_bytes),
                    'status': 'ok',
                    'name': db_file.name,
                })
            else:
                db_info.update({'status': 'missing', 'error': 'SQLite file not found'})

        elif 'postgresql' in backend or 'postgres' in backend:
            with connection.cursor() as cursor:
                cursor.execute('SELECT pg_database_size(current_database())')
                row = cursor.fetchone()
            size_bytes = int(row[0]) if row and row[0] is not None else 0
            db_info.update({
                'size_bytes': size_bytes,
                'size_human': _format_bytes(size_bytes),
                'status': 'ok',
            })

        else:
            db_info.update({'status': 'unsupported', 'error': 'Database engine not supported for size metrics'})

    except Exception as exc:
        logger.exception("Database storage snapshot failed")
        db_info.update({
            'status': 'error',
            'error': 'Database size metrics unavailable',
        })

    return db_info


@require_POST
@csrf_protect
def api_client_errors(request):
    """Receive client-side JS errors and log them server-side."""
    if not request.user.is_authenticated:
        return JsonResponse({'status': 'ignored'}, status=200)

    rate_key = f'panel:client-errors:{request.user.pk}'
    report_count = int(cache.get(rate_key, 0) or 0)
    if report_count >= _MAX_REPORTS_PER_MIN:
        return JsonResponse({'status': 'rate_limited'}, status=429)
    if report_count <= 0:
        cache.set(rate_key, 1, 60)
    else:
        try:
            cache.incr(rate_key)
        except ValueError:
            cache.set(rate_key, 1, 60)

    try:
        body = json.loads(request.body)
        errors = body.get('errors', [])
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'status': 'bad_request'}, status=400)

    if not isinstance(errors, list) or len(errors) == 0:
        return JsonResponse({'status': 'empty'}, status=200)

    errors = errors[:50]
    username = getattr(request.user, 'username', 'unknown')

    for err in errors:
        err_type = _sanitize_log_value(err.get('type', 'unknown'), 30)
        message = _sanitize_log_value(err.get('message', ''))
        source = _sanitize_log_value(err.get('source', ''), 200)
        line = err.get('line', 0)
        if not isinstance(line, (int, float)):
            line = 0
        page_url = _sanitize_log_value(err.get('url', ''), 200)
        status_code = _sanitize_log_value(err.get('status', ''), 10)

        if err_type in ('error', 'rejection'):
            logger.warning(
                "CLIENT_JS_ERROR type=%s user=%s page=%s message=%s source=%s line=%s",
                err_type, username, page_url, message, source, line
            )
        elif err_type in ('htmx', 'htmx-network'):
            logger.warning(
                "CLIENT_HTMX_ERROR type=%s user=%s page=%s status=%s path=%s",
                err_type, username, page_url, status_code,
                _sanitize_log_value(err.get('path', ''), 200)
            )
        elif err_type == 'resource':
            logger.info(
                "CLIENT_RESOURCE_ERROR user=%s page=%s tag=%s src=%s",
                username, page_url,
                _sanitize_log_value(err.get('tag', ''), 30),
                _sanitize_log_value(err.get('src', ''), 200)
            )

    return JsonResponse({'status': 'ok', 'received': len(errors)})


@require_http_methods(["GET"])
@login_required
def api_monitoring_data(request):
    """
    Return monitoring data for the Manage Panel → Monitoring tab.
    GET /panel/api/monitoring/
    """
    from core.services.permission_service import PermissionService

    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Super admin only'}, status=403)

    from django.utils import timezone
    from datetime import timedelta
    from core.models import BackgroundTask, BackupTask

    now = timezone.now()
    since_24h = now - timedelta(hours=24)

    active_tasks = BackgroundTask.objects.filter(status__in=['pending', 'processing']).count()
    pending_tasks = BackgroundTask.objects.filter(status='pending').count()
    completed_24h = BackgroundTask.objects.filter(
        status='completed', completed_at__gte=since_24h
    ).count()
    failed_24h = BackgroundTask.objects.filter(
        status='failed', completed_at__gte=since_24h
    ).count()

    recent_qs = (
        BackgroundTask.objects
        .select_related('user')
        .order_by('-created_at')[:20]
    )

    STATUS_COLOR = {
        'pending': 'warning',
        'processing': 'info',
        'completed': 'success',
        'failed': 'danger',
        'cancelled': 'secondary',
    }

    recent_tasks = []
    for t in recent_qs:
        recent_tasks.append({
            'id': t.id,
            'task_type': t.get_task_type_display(),
            'status': t.status,
            'status_display': t.get_status_display(),
            'status_color': STATUS_COLOR.get(t.status, 'secondary'),
            'progress_pct': t.progress_percentage,
            'user': t.user.get_full_name() or t.user.username if t.user else '—',
            'created_at': t.created_at.strftime('%d-%m-%Y %H:%M'),
            'completed_at': t.completed_at.strftime('%d-%m-%Y %H:%M') if t.completed_at else None,
            'error': (t.error_message or '')[:120] if t.status == 'failed' else '',
        })

    backup_qs = (
        BackupTask.objects
        .filter(status__in=['pending', 'processing'])
        .order_by('-created_at')[:10]
    )

    backup_tasks = []
    for b in backup_qs:
        backup_tasks.append({
            'id': b.id,
            'status': b.status,
            'status_display': b.get_status_display(),
            'progress': b.progress,
            'total': b.total,
            'progress_pct': round((b.progress / b.total) * 100) if b.total > 0 else 0,
            'current_client': b.current_client or '',
            'created_at': b.created_at.strftime('%d-%m-%Y %H:%M'),
        })

    return JsonResponse({
        'success': True,
        'stats': {
            'active_tasks': active_tasks,
            'pending_tasks': pending_tasks,
            'completed_24h': completed_24h,
            'failed_24h': failed_24h,
        },
        'recent_tasks': recent_tasks,
        'backup_tasks': backup_tasks,
    })


@require_http_methods(["GET"])
@login_required
def api_server_info_snapshot(request):
    """
    Return a server snapshot for Manage Panel -> Server Info tab.
    Uses short-lived cache by default and recomputes when force_refresh=1.
    """
    from core.services.permission_service import PermissionService

    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Super admin / pro user only'}, status=403)

    force_refresh = request.GET.get('force_refresh') == '1'
    if not force_refresh:
        cached = cache.get(_SERVER_INFO_CACHE_KEY)
        if cached:
            return JsonResponse({
                'success': True,
                'cached': True,
                'cache_ttl_seconds': _SERVER_INFO_CACHE_TTL,
                'snapshot': cached,
            })

    base_dir = Path(settings.BASE_DIR)
    disk = shutil.disk_usage(str(base_dir))
    disk_used_pct = round((disk.used / disk.total) * 100, 1) if disk.total > 0 else 0

    tracked_labels = [
        ('Project Root', base_dir),
        ('venv', base_dir / 'venv'),
        ('.git', base_dir / '.git'),
        ('media', base_dir / 'media'),
        ('mediafiles', base_dir / 'mediafiles'),
        ('static', base_dir / 'static'),
        ('staticfiles', base_dir / 'staticfiles'),
        ('logs', base_dir / 'logs'),
        ('Face Cropper', base_dir / 'Face Cropper'),
        ('Face Cropper/build', base_dir / 'Face Cropper' / 'build'),
        ('Face Cropper/installer', base_dir / 'Face Cropper' / 'installer'),
        ('Face Cropper/logs', base_dir / 'Face Cropper' / 'logs'),
    ]

    path_usage_raw = []
    for label, path_obj in tracked_labels:
        if not path_obj.exists() or not path_obj.is_dir():
            continue
        size_bytes = _dir_size_fast(path_obj)
        path_usage_raw.append({
            'name': label,
            'size_bytes': size_bytes,
            'size_human': _format_bytes(size_bytes),
        })

    path_usage_raw.sort(key=lambda x: x['size_bytes'], reverse=True)
    path_usage = [p for p in path_usage_raw if p['name'] != 'Project Root']
    project_root_size = next((p['size_bytes'] for p in path_usage_raw if p['name'] == 'Project Root'), 0)

    db_info = _database_storage_snapshot(base_dir)
    db_size_bytes = int(db_info.get('size_bytes') or 0)

    disk_used_nonfree = int(disk.used)
    known_used_bytes = max(project_root_size + db_size_bytes, 0)
    other_system_used = max(disk_used_nonfree - known_used_bytes, 0)

    usage_breakdown = [
        {
            'name': 'Project Files',
            'size_bytes': project_root_size,
            'size_human': _format_bytes(project_root_size),
        },
        {
            'name': 'Database',
            'size_bytes': db_size_bytes,
            'size_human': _format_bytes(db_size_bytes),
        },
        {
            'name': 'Other System Usage',
            'size_bytes': other_system_used,
            'size_human': _format_bytes(other_system_used),
        },
    ]

    tracked_total = sum(p['size_bytes'] for p in path_usage)
    for item in path_usage:
        item['pct_of_tracked'] = round((item['size_bytes'] / tracked_total) * 100, 1) if tracked_total > 0 else 0
        item['pct_of_disk'] = round((item['size_bytes'] / disk.total) * 100, 3) if disk.total > 0 else 0

    for item in usage_breakdown:
        item['pct_of_used_disk'] = round((item['size_bytes'] / disk_used_nonfree) * 100, 1) if disk_used_nonfree > 0 else 0
        item['pct_of_total_disk'] = round((item['size_bytes'] / disk.total) * 100, 2) if disk.total > 0 else 0

    usage_breakdown.sort(key=lambda x: x['size_bytes'], reverse=True)

    other_breakdown = _other_usage_breakdown(
        base_dir=base_dir,
        other_total_bytes=other_system_used,
        project_total_bytes=project_root_size,
    )

    now = datetime.now(dt_timezone.utc)
    snapshot = {
        'fetched_at': now.isoformat(),
        'fetched_at_human': now.strftime('%d-%m-%Y %H:%M:%S UTC'),
        'host': socket.gethostname(),
        'platform': platform.platform(),
        'python_version': platform.python_version(),
        'cpu': {
            'logical_cores': os.cpu_count() or 0,
        },
        'memory': _memory_snapshot(),
        'storage': {
            'total_bytes': disk.total,
            'used_bytes': disk.used,
            'free_bytes': disk.free,
            'used_pct': disk_used_pct,
            'total_human': _format_bytes(disk.total),
            'used_human': _format_bytes(disk.used),
            'free_human': _format_bytes(disk.free),
            'tracked_total_bytes': tracked_total,
            'tracked_total_human': _format_bytes(tracked_total),
            'project_total_bytes': project_root_size,
            'project_total_human': _format_bytes(project_root_size),
            'database_total_bytes': db_size_bytes,
            'database_total_human': _format_bytes(db_size_bytes),
            'other_system_used_bytes': other_system_used,
            'other_system_used_human': _format_bytes(other_system_used),
        },
        'database': db_info,
        'usage_breakdown': usage_breakdown,
        'other_usage_breakdown': other_breakdown,
        'path_usage': path_usage,
    }

    cache.set(_SERVER_INFO_CACHE_KEY, snapshot, _SERVER_INFO_CACHE_TTL)

    return JsonResponse({
        'success': True,
        'cached': False,
        'cache_ttl_seconds': _SERVER_INFO_CACHE_TTL,
        'snapshot': snapshot,
    })
