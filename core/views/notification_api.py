"""
Notification API Views
======================
Thin views: parse request → call NotificationService → return response.
"""

import json
import logging

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required

from ..services.notification_service import NotificationService
from ..services.permission_service import (
    api_require_super_admin,
    api_require_any_authenticated,
)

logger = logging.getLogger(__name__)


# ── User-facing endpoints (any authenticated user) ──────────

@login_required
@api_require_any_authenticated
@require_http_methods(["GET"])
def api_notifications_list(request):
    """Get notifications for the current user (with read/unread status)."""
    try:
        limit = min(int(request.GET.get('limit', 20)), 50)
        offset = max(int(request.GET.get('offset', 0)), 0)
    except (ValueError, TypeError):
        limit, offset = 20, 0
    unread_only = request.GET.get('unread_only', '').lower() == 'true'

    data = NotificationService.get_notifications_for_user(
        user=request.user,
        limit=limit,
        offset=offset,
        unread_only=unread_only,
    )
    return JsonResponse({'success': True, **data})


@login_required
@api_require_any_authenticated
@require_http_methods(["GET"])
def api_notifications_unread_count(request):
    """Fast endpoint for notification badge count."""
    count = NotificationService.get_unread_count(request.user)
    return JsonResponse({'success': True, 'unread_count': count})


@login_required
@api_require_any_authenticated
@require_http_methods(["POST"])
def api_notification_mark_read(request, notification_id):
    """Mark a single notification as read."""
    result = NotificationService.mark_as_read(request.user, notification_id)
    return JsonResponse(result.to_response_dict())


@login_required
@api_require_any_authenticated
@require_http_methods(["POST"])
def api_notifications_mark_all_read(request):
    """Mark all notifications as read for the current user."""
    result = NotificationService.mark_all_as_read(request.user)
    return JsonResponse(result.to_response_dict())


# ── Admin endpoints (super admin only) ──────────────────────

@login_required
@api_require_super_admin
@require_http_methods(["GET"])
def api_panel_notifications_list(request):
    """List all notifications for admin panel management."""
    try:
        limit = min(int(request.GET.get('limit', 50)), 100)
        offset = max(int(request.GET.get('offset', 0)), 0)
    except (ValueError, TypeError):
        limit, offset = 50, 0
    search = request.GET.get('search', '')

    data = NotificationService.list_all_notifications(
        limit=limit, offset=offset, search=search
    )
    return JsonResponse({'success': True, **data})


@login_required
@api_require_super_admin
@require_http_methods(["POST"])
def api_panel_notification_create(request):
    """Create and broadcast a notification."""
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid JSON.'}, status=400)

    result = NotificationService.create_notification(
        title=body.get('title', ''),
        message=body.get('message', ''),
        priority=body.get('priority', 'normal'),
        category=body.get('category', 'general'),
        target=body.get('target', 'all'),
        target_user_ids=body.get('target_user_ids'),
        created_by=request.user,
        send_email=body.get('send_email', False),
    )

    status = 200 if result.success else 400
    return JsonResponse(result.to_response_dict(), status=status)


@login_required
@api_require_super_admin
@require_http_methods(["DELETE"])
def api_panel_notification_delete(request, notification_id):
    """Delete (deactivate) a notification."""
    result = NotificationService.delete_notification(notification_id)
    status = 200 if result.success else 404
    return JsonResponse(result.to_response_dict(), status=status)


@login_required
@api_require_super_admin
@require_http_methods(["GET"])
def api_panel_target_users(request):
    """Get users grouped by role for the target user picker."""
    grouped = NotificationService.get_target_user_options()
    return JsonResponse({'success': True, 'users': grouped})
