"""
Manage Panel views  (panel app)
================================
Main manage-panel page, email-logs API, and notifications page.
Moved from core/views/admin_page_views.py.
"""

import logging

from django.conf import settings as django_settings
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import Count, Q
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_http_methods

from core.models import User, Notification, EmailLog
from idcards.models import IDCard
from client.models import Client
from core.services.permission_service import require_super_admin

logger = logging.getLogger(__name__)


# ── Notifications page (all authenticated users) ─────────────────────────

@login_required
def notifications_page(request):
    """Full notifications page for all authenticated users."""
    return render(request, 'notifications.html', {'active_page': 'notifications'})


# ── Manage Panel ─────────────────────────────────────────────────────────

@require_super_admin
def manage_panel(request):
    """Manage Panel page — notifications, backups, logs, monitoring."""
    import sys
    import django

    context = {
        'is_super_admin': True,
        'active_page': 'manage_panel',
        'django_version': django.get_version(),
        'python_version': f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        'total_clients': Client.objects.count(),
        'total_cards': IDCard.objects.count(),
        'active_tasks': 0,
        'total_notifications': Notification.objects.filter(is_active=True).count(),
        'email_backend': getattr(django_settings, 'EMAIL_BACKEND', 'SMTP').split('.')[-1].replace('Backend', ''),
        'email_from': getattr(django_settings, 'DEFAULT_FROM_EMAIL', 'Not configured'),
        'debug_mode': django_settings.DEBUG,
    }

    user_counts = User.objects.filter(is_active=True).aggregate(
        total=Count('id'),
        admin_staff=Count('id', filter=Q(role='admin_staff')),
        client_staff=Count('id', filter=Q(role='client_staff')),
    )
    context['total_users'] = user_counts['total']
    context['total_admin_staff'] = user_counts['admin_staff']
    context['total_client_staff'] = user_counts['client_staff']
    return render(request, 'manage-panel.html', context)


# ── Email Logs API ────────────────────────────────────────────────────────

@require_super_admin
@require_http_methods(['GET'])
def api_email_logs(request):
    """Return paginated email log entries for the Email Management tab."""
    status_filter = request.GET.get('status', '')
    email_type_filter = request.GET.get('email_type', '')

    # B1: guard against non-integer query params (would cause HTTP 500)
    try:
        page = int(request.GET.get('page', 1))
    except (ValueError, TypeError):
        page = 1
    try:
        per_page = int(request.GET.get('per_page', 50))
    except (ValueError, TypeError):
        per_page = 50
    # B2: clamp per_page to prevent memory-exhaustion DoS
    per_page = min(max(1, per_page), 200)

    # B3: explicit ordering for stable pagination
    qs = EmailLog.objects.order_by('-created_at')
    if status_filter:
        qs = qs.filter(status=status_filter)
    if email_type_filter:
        qs = qs.filter(email_type=email_type_filter)

    paginator = Paginator(qs, per_page)
    page_obj = paginator.get_page(page)

    logs = [
        {
            'id': log.id,
            'recipient_name': log.recipient_name,
            'recipient_email': log.recipient_email,
            'subject': log.subject,
            'email_type': log.email_type,
            'email_type_display': log.get_email_type_display(),
            'status': log.status,
            'status_display': log.get_status_display(),
            'error_message': log.error_message,
            'created_at': log.created_at.strftime('%d-%m-%Y %H:%M'),
            'sent_at': log.sent_at.strftime('%d-%m-%Y %H:%M') if log.sent_at else None,
        }
        for log in page_obj
    ]

    # P1: single aggregated query instead of 4 separate COUNT queries
    _sc_qs = EmailLog.objects.values('status').annotate(n=Count('id'))
    _sc_map = {row['status']: row['n'] for row in _sc_qs}

    return JsonResponse({
        'success': True,
        'logs': logs,
        'total': paginator.count,
        'page': page,
        'total_pages': paginator.num_pages,
        'status_counts': {
            'on_hold': _sc_map.get(EmailLog.STATUS_ON_HOLD, 0),
            'pending': _sc_map.get(EmailLog.STATUS_PENDING, 0),
            'sent':    _sc_map.get(EmailLog.STATUS_SENT, 0),
            'failed':  _sc_map.get(EmailLog.STATUS_FAILED, 0),
        },
    })


# ── Email Resend API ──────────────────────────────────────────────────────

@require_super_admin
@require_http_methods(['POST'])
def api_email_resend(request, log_id):
    """Resend a welcome/activation email for on_hold or failed email log entries.
    Generates a new temporary password for the user and resends the welcome email."""
    import secrets
    import string
    from django.utils import timezone
    from core.utils.email_utils import send_welcome_email

    try:
        log = EmailLog.objects.get(id=log_id)
    except EmailLog.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Log entry not found.'}, status=404)

    if log.status not in [EmailLog.STATUS_ON_HOLD, EmailLog.STATUS_FAILED]:
        return JsonResponse({'success': False, 'message': 'Only on_hold or failed emails can be resent.'})

    try:
        user = User.objects.get(email=log.recipient_email, is_active=True)
    except User.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'No active user found with that email address.'})

    # S3 fix: generate a new temporary password but do NOT save it yet.
    # Saving the password before confirming email delivery would lock the user
    # out if SMTP fails — they'd have a new unknown password with no way to log in.
    chars = string.ascii_letters + string.digits
    new_password = ''.join(secrets.choice(chars) for _ in range(10))

    try:
        success, message = send_welcome_email(
            name=log.recipient_name or user.get_full_name() or user.username,
            email=log.recipient_email,
            password=new_password,
            role=user.role,
            request=request,
        )
    except Exception as e:
        logger.error('api_email_resend error for log %s: %s', log_id, e)
        log.status = EmailLog.STATUS_FAILED
        log.error_message = str(e)
        log.save(update_fields=['status', 'error_message'])
        # Password intentionally NOT changed — email never reached the user
        return JsonResponse({'success': False, 'message': 'Failed to send email. Password was not changed.'}, status=500)

    if success:
        # Only now save the new password — email delivery confirmed
        user.set_password(new_password)
        user.save(update_fields=['password'])
        log.status = EmailLog.STATUS_SENT
        log.sent_at = timezone.now()
        log.error_message = ''
        log.save(update_fields=['status', 'sent_at', 'error_message'])
    else:
        log.status = EmailLog.STATUS_FAILED
        log.error_message = message
        log.save(update_fields=['status', 'error_message'])

    return JsonResponse({
        'success': success,
        'message': message if success else f'Failed: {message}',
        'new_status': log.status,
        'new_status_display': log.get_status_display(),
    })

