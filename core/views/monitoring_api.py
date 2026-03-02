"""
Monitoring API — receives client-side error reports from error-monitor.js

Endpoint: POST /panel/api/client-errors/
- Accepts JSON: { "errors": [ { type, message, source, line, ... }, ... ] }
- Logs each error via Python logging to error.log
- Rate-limited: max 10 reports per minute per session
"""
import json
import logging
import re
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods, require_POST
from django.views.decorators.csrf import csrf_protect
from django.contrib.auth.decorators import login_required

logger = logging.getLogger('core.views')

# Rate limit: max reports per minute per session key
_MAX_REPORTS_PER_MIN = 10

# Max length for any single logged field to prevent log flooding
_MAX_LOG_FIELD_LEN = 500


def _sanitize_log_value(val, max_len=_MAX_LOG_FIELD_LEN):
    """Strip control chars / newlines from user input before logging to prevent log injection."""
    if not isinstance(val, str):
        val = str(val) if val is not None else ''
    # Remove newlines, carriage returns, and other control characters
    val = re.sub(r'[\r\n\x00-\x1f\x7f]', ' ', val)
    return val[:max_len]


@require_POST
@csrf_protect
def api_client_errors(request):
    """
    Receive client-side JS errors and log them server-side.
    Only authenticated users can report (prevents abuse).
    """
    if not request.user.is_authenticated:
        return JsonResponse({'status': 'ignored'}, status=200)

    # Simple per-session rate limiting
    session = request.session
    import time
    now = time.time()
    window_key = '_err_report_window'
    count_key = '_err_report_count'

    window_start = session.get(window_key, 0)
    report_count = session.get(count_key, 0)

    if now - window_start > 60:
        # Reset window
        session[window_key] = now
        session[count_key] = 0
        report_count = 0

    if report_count >= _MAX_REPORTS_PER_MIN:
        return JsonResponse({'status': 'rate_limited'}, status=429)

    session[count_key] = report_count + 1

    # Parse body
    try:
        body = json.loads(request.body)
        errors = body.get('errors', [])
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'status': 'bad_request'}, status=400)

    if not isinstance(errors, list) or len(errors) == 0:
        return JsonResponse({'status': 'empty'}, status=200)

    # Cap at 50 per request to prevent abuse
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


# =============================================================================
# MONITORING DASHBOARD API  (super_admin only)
# =============================================================================

@require_http_methods(["GET"])
@login_required
def api_monitoring_data(request):
    """
    Return monitoring data for the Manage Panel → Monitoring tab.

    GET /panel/api/monitoring/
    Response: { success, stats, recent_tasks, backup_tasks }
    """
    from ..services.permission_service import PermissionService

    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Super admin only'}, status=403)

    from django.utils import timezone
    from datetime import timedelta
    from ..models import BackgroundTask, BackupTask

    now = timezone.now()
    since_24h = now - timedelta(hours=24)

    # ── Background Task stats ────────────────────────────────────────────────
    active_tasks = BackgroundTask.objects.filter(status__in=['pending', 'processing']).count()
    pending_tasks = BackgroundTask.objects.filter(status='pending').count()
    completed_24h = BackgroundTask.objects.filter(
        status='completed', completed_at__gte=since_24h
    ).count()
    failed_24h = BackgroundTask.objects.filter(
        status='failed', completed_at__gte=since_24h
    ).count()

    # ── Recent Background Tasks (last 20) ────────────────────────────────────
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

    # ── Active Backup Tasks ───────────────────────────────────────────────────
    backup_qs = (
        BackupTask.objects
        .filter(status__in=['queued', 'processing'])
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
