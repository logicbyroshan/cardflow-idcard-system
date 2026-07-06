"""
Statistics Dashboard Views
Real data only — no random/mock fallbacks.
"""
from datetime import datetime, timedelta

from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from django.db.models import Count, Q

from core.services.permission_service import PermissionService
from core.services.live_presence_service import LiveClientPresenceService
from django.contrib.auth import get_user_model
User = get_user_model()
from client.models import Client
from accounts.models import UserDeviceSession
from stats.models import StatsSnapshot, ServerLoadAlert
from core.models import BackgroundTask

import logging
logger = logging.getLogger(__name__)


def _get_user_role(user):
    return str(getattr(user, 'role', '') or '').strip().lower()


@login_required
def statistics_page(request):
    """Render the main statistics dashboard for pro users and super admins."""
    if not PermissionService.can_use_pro_user_options(request.user):
        return redirect('dashboard')

    context = {
        'active_page': 'impersonate',
        'pro_tab': 'statistics',
        'user_role': _get_user_role(request.user),
    }
    return render(request, 'stats/statistics.html', context)


def _take_hourly_snapshot(user):
    """Write a real snapshot right now if the last one is older than 1 hour."""
    from idcards.models import IDCard

    now = timezone.now()
    latest = StatsSnapshot.objects.order_by('-timestamp').first()
    if latest and (now - latest.timestamp) < timedelta(hours=1):
        return  # not time yet

    live_clients = LiveClientPresenceService.get_live_client_ids_for_user(user) or []
    live_clients_count = len(live_clients)
    live_assistants_count = LiveClientPresenceService.get_live_assistant_count_for_user(user) or 0
    live_users_count = UserDeviceSession.objects.values('user_id').distinct().count()

    hour_ago = now - timedelta(hours=1)
    cards_created = IDCard.objects.filter(created_at__gte=hour_ago).count()
    processing_jobs = BackgroundTask.objects.filter(status__in=['pending', 'processing']).count()

    peak = max(live_clients_count + live_assistants_count, live_users_count)

    StatsSnapshot.objects.create(
        timestamp=now,
        active_clients=live_clients_count,
        active_assistants=live_assistants_count,
        peak_active_users=peak,
        total_cards_created=cards_created,
        batch_jobs_count=processing_jobs,
    )


@login_required
def api_statistics_data(request):
    """
    JSON API — real activity metrics over time.
    Supports range: 'hourly' (last 24 h), 'daily' (last 30 d),
                    'weekly' (last 12 wk), 'monthly' (last 12 mo).

    Graph always returns points sorted oldest → newest so the chart
    renders left = past, right = latest.
    """
    from core.models import ActivityLog
    from idcards.models import IDCard

    if not PermissionService.can_use_pro_user_options(request.user):
        return JsonResponse({'success': False, 'message': 'Access denied.'}, status=403)

    _take_hourly_snapshot(request.user)

    range_type = str(request.GET.get('range', 'hourly')).strip().lower()
    if range_type not in ('hourly', 'daily', 'weekly', 'monthly'):
        range_type = 'hourly'

    now = timezone.now()
    labels           = []
    client_activity  = []
    assistant_activity = []
    batch_jobs       = []
    cards_created    = []
    all_user_activity = []

    snapshots_qs = StatsSnapshot.objects.order_by('timestamp')

    if range_type == 'hourly':
        # Last 24 hours, one bucket per hour.  We build exactly 24 slots:
        # slot[0] = 25 h ago → slot[23] = current hour (most recent on right).
        start_time = now - timedelta(hours=24)
        snapshots = list(snapshots_qs.filter(timestamp__gte=start_time))

        for i in range(24):
            slot_start = start_time + timedelta(hours=i)
            slot_end   = slot_start + timedelta(hours=1)
            # Label = the hour the slot ends (e.g. "09:00" means 08–09)
            labels.append(slot_end.strftime('%H:00'))

            # Aggregate all snapshots that fall into this hour bucket
            bucket = [s for s in snapshots
                      if slot_start <= s.timestamp < slot_end]

            if bucket:
                ca = int(sum(s.active_clients   for s in bucket) / len(bucket))
                aa = int(sum(s.active_assistants for s in bucket) / len(bucket))
                bj = int(sum(s.batch_jobs_count  for s in bucket) / len(bucket))
                cc = sum(s.total_cards_created   for s in bucket)
            else:
                ca = aa = bj = cc = 0

            client_activity.append(ca)
            assistant_activity.append(aa)
            batch_jobs.append(bj)
            cards_created.append(cc)

            # Real distinct active users from ActivityLog for this hour
            au = ActivityLog.objects.filter(
                created_at__gte=slot_start,
                created_at__lt=slot_end,
            ).values('user_id').distinct().count()
            # Supplement with presence-based count if ActivityLog is sparse
            all_user_activity.append(max(au, ca + aa))

    elif range_type == 'daily':
        start_time = now - timedelta(days=30)
        snapshots = list(snapshots_qs.filter(timestamp__gte=start_time))

        for i in range(30):
            day = (start_time + timedelta(days=i + 1)).date()
            labels.append(day.strftime('%b %d'))

            day_start = timezone.make_aware(datetime.combine(day, datetime.min.time()))
            day_end   = timezone.make_aware(datetime.combine(day, datetime.max.time()))

            bucket = [s for s in snapshots if s.timestamp.date() == day]
            if bucket:
                ca = int(sum(s.active_clients   for s in bucket) / len(bucket))
                aa = int(sum(s.active_assistants for s in bucket) / len(bucket))
                bj = sum(s.batch_jobs_count  for s in bucket)
                cc = sum(s.total_cards_created for s in bucket)
            else:
                # Fall back to real DB counts for days before snapshots started
                ca = ActivityLog.objects.filter(
                    created_at__range=(day_start, day_end),
                    user__role='client',
                ).values('user').distinct().count()
                aa = ActivityLog.objects.filter(
                    created_at__range=(day_start, day_end),
                    user__role__in=('assistant', 'client_staff'),
                ).values('user').distinct().count()
                bj = BackgroundTask.objects.filter(
                    created_at__range=(day_start, day_end),
                ).count()
                cc = IDCard.objects.filter(
                    created_at__range=(day_start, day_end),
                ).count()

            client_activity.append(ca)
            assistant_activity.append(aa)
            batch_jobs.append(bj)
            cards_created.append(cc)

            au = ActivityLog.objects.filter(
                created_at__range=(day_start, day_end),
            ).values('user_id').distinct().count()
            all_user_activity.append(max(au, ca + aa))

    elif range_type == 'weekly':
        start_time = now - timedelta(weeks=12)
        snapshots = list(snapshots_qs.filter(timestamp__gte=start_time))

        for i in range(12):
            wk_start = start_time + timedelta(weeks=i)
            wk_end   = wk_start + timedelta(weeks=1)
            iso_wk   = wk_start.isocalendar()[1]
            labels.append(f'Wk {iso_wk}')

            bucket = [s for s in snapshots
                      if wk_start <= s.timestamp < wk_end]
            if bucket:
                ca = int(sum(s.active_clients   for s in bucket) / len(bucket))
                aa = int(sum(s.active_assistants for s in bucket) / len(bucket))
                bj = sum(s.batch_jobs_count  for s in bucket)
                cc = sum(s.total_cards_created for s in bucket)
            else:
                ca = ActivityLog.objects.filter(
                    created_at__gte=wk_start, created_at__lt=wk_end,
                    user__role='client',
                ).values('user').distinct().count()
                aa = ActivityLog.objects.filter(
                    created_at__gte=wk_start, created_at__lt=wk_end,
                    user__role__in=('assistant', 'client_staff'),
                ).values('user').distinct().count()
                bj = BackgroundTask.objects.filter(
                    created_at__gte=wk_start, created_at__lt=wk_end,
                ).count()
                cc = IDCard.objects.filter(
                    created_at__gte=wk_start, created_at__lt=wk_end,
                ).count()

            client_activity.append(ca)
            assistant_activity.append(aa)
            batch_jobs.append(bj)
            cards_created.append(cc)

            au = ActivityLog.objects.filter(
                created_at__gte=wk_start, created_at__lt=wk_end,
            ).values('user_id').distinct().count()
            all_user_activity.append(max(au, ca + aa))

    else:  # monthly
        for i in range(12):
            # Work backward from current month
            # month_offset: 11 = 11 months ago, 0 = current month
            offset = 11 - i
            # Compute year/month
            target_month = now.month - offset
            target_year  = now.year
            while target_month < 1:
                target_month += 12
                target_year  -= 1

            import calendar
            _, last_day = calendar.monthrange(target_year, target_month)
            mo_start = timezone.make_aware(datetime(target_year, target_month, 1, 0, 0, 0))
            mo_end   = timezone.make_aware(datetime(target_year, target_month, last_day, 23, 59, 59))
            labels.append(mo_start.strftime('%b %Y'))

            bucket = [s for s in StatsSnapshot.objects.filter(
                timestamp__gte=mo_start, timestamp__lte=mo_end
            )]
            if bucket:
                ca = int(sum(s.active_clients   for s in bucket) / len(bucket))
                aa = int(sum(s.active_assistants for s in bucket) / len(bucket))
                bj = sum(s.batch_jobs_count  for s in bucket)
                cc = sum(s.total_cards_created for s in bucket)
            else:
                from core.models import ActivityLog as AL
                ca = AL.objects.filter(
                    created_at__range=(mo_start, mo_end),
                    user__role='client',
                ).values('user').distinct().count()
                aa = AL.objects.filter(
                    created_at__range=(mo_start, mo_end),
                    user__role__in=('assistant', 'client_staff'),
                ).values('user').distinct().count()
                bj = BackgroundTask.objects.filter(
                    created_at__range=(mo_start, mo_end),
                ).count()
                cc = IDCard.objects.filter(
                    created_at__range=(mo_start, mo_end),
                ).count()

            client_activity.append(ca)
            assistant_activity.append(aa)
            batch_jobs.append(bj)
            cards_created.append(cc)

            from core.models import ActivityLog as AL2
            au = AL2.objects.filter(
                created_at__range=(mo_start, mo_end),
            ).values('user_id').distinct().count()
            all_user_activity.append(max(au, ca + aa))

    # ── Live summary metrics ────────────────────────────────────────────
    current_live_clients    = len(LiveClientPresenceService.get_live_client_ids_for_user(request.user))
    current_live_assistants = LiveClientPresenceService.get_live_assistant_count_for_user(request.user)
    current_live_sessions   = UserDeviceSession.objects.values('user_id').distinct().count()
    current_active_users    = max(current_live_sessions,
                                  current_live_clients + current_live_assistants)

    # Overwrite the last data point with actual live numbers (most-recent on right)
    if client_activity:
        client_activity[-1]   = max(client_activity[-1],   current_live_clients)
    if assistant_activity:
        assistant_activity[-1] = max(assistant_activity[-1], current_live_assistants)
    if all_user_activity:
        all_user_activity[-1] = max(all_user_activity[-1],  current_active_users)

    total_batch_jobs  = BackgroundTask.objects.count()
    completed_jobs    = BackgroundTask.objects.filter(status='completed').count()
    processing_jobs   = BackgroundTask.objects.filter(status__in=['pending', 'processing']).count()
    success_rate      = int(completed_jobs / total_batch_jobs * 100) if total_batch_jobs > 0 else 100

    # Historical peak
    peak_snap         = StatsSnapshot.objects.order_by('-peak_active_users').first()
    peak_active_users = max(peak_snap.peak_active_users if peak_snap else 0,
                            current_active_users)

    # Busiest 2-hour window (hourly range only)
    busiest_hour_str = '—'
    if range_type == 'hourly' and len(all_user_activity) >= 2:
        max_sum = -1
        max_idx = -1
        for idx in range(len(all_user_activity) - 1):
            s = all_user_activity[idx] + all_user_activity[idx + 1]
            if s > max_sum:
                max_sum = s
                max_idx = idx
        if max_idx != -1:
            try:
                start_hour = int(labels[max_idx].split(':')[0])
                end_hour   = (start_hour + 2) % 24
                busiest_hour_str = f'{start_hour:02d}:00 - {end_hour:02d}:00'
            except Exception:
                pass

    # Total unique IDs from IDCards ever created
    from idcards.models import IDCard as IDCard2
    total_cards_ever = IDCard2.objects.count()

    return JsonResponse({
        'success': True,
        'labels':             labels,
        'client_activity':    client_activity,
        'assistant_activity': assistant_activity,
        'all_user_activity':  all_user_activity,
        'batch_jobs_count':   batch_jobs,
        'cards_created':      cards_created,
        'summary': {
            'current_active_users':    current_active_users,
            'live_clients':            current_live_clients,
            'live_assistants':         current_live_assistants,
            'peak_active_users':       peak_active_users,
            'peak_working_hour':       busiest_hour_str,
            'total_batch_jobs':        total_batch_jobs,
            'batch_jobs_success_rate': success_rate,
            'batch_jobs_processing':   processing_jobs,
            'total_cards_ever':        total_cards_ever,
        },
    })


# ── Server load alert helpers ──────────────────────────────────────────────────

LOAD_THRESHOLDS = [
    # (min_users, level, subject_prefix, body_intro)
    (100, ServerLoadAlert.LEVEL_DANGER,
     '🚨 CRITICAL: Server Will Crash',
     '100 or more concurrent users are active right now. The server is at serious risk of crashing. Please scale immediately.'),
    (75, ServerLoadAlert.LEVEL_CRITICAL,
     '⚠️ WARNING: Server Is Struggling',
     '75 or more concurrent users are active right now. The server is struggling. Please investigate and scale if needed.'),
    (50, ServerLoadAlert.LEVEL_WARNING,
     '🟡 NOTICE: Server Is Slow',
     '50 or more concurrent users are active right now. Response times may be degrading. Monitor the situation.'),
]

# Minimum minutes between consecutive alerts of the same level
ALERT_COOLDOWN_MINUTES = 30


def _get_admin_emails():
    """Return emails of all active super_admin / pro_user accounts."""
    admins = User.objects.filter(
        is_active=True,
        role__in=('super_admin', 'pro_user'),
    ).values_list('email', flat=True)
    return [e for e in admins if e and '@' in e]


def check_and_send_load_alerts(concurrent_users: int):
    """
    Called from the api_statistics_data view (and optionally a cron/management
    command).  Sends a single email per alert level per cooldown window.
    """
    from django.conf import settings
    from core.utils.threaded_email import send_html_email_async

    admin_emails = _get_admin_emails()
    if not admin_emails:
        logger.warning('check_and_send_load_alerts: no admin emails found, skipping.')
        return

    now = timezone.now()

    for (threshold, level, subject, intro) in LOAD_THRESHOLDS:
        if concurrent_users < threshold:
            continue  # below this threshold, skip

        alert, _ = ServerLoadAlert.objects.get_or_create(level=level)
        cooldown_ok = (
            alert.last_sent is None or
            (now - alert.last_sent) >= timedelta(minutes=ALERT_COOLDOWN_MINUTES)
        )
        if not cooldown_ok:
            break  # already alerted recently for this (or higher) level

        subject_full = f'[Adarsh Panel] {subject} — {concurrent_users} users online'
        panel_url = getattr(settings, 'PANEL_URL', '') or 'https://panel.adarshbhopal.in'

        plain = (
            f'{intro}\n\n'
            f'Concurrent users right now: {concurrent_users}\n'
            f'Threshold triggered: {threshold}+\n'
            f'Time: {now.strftime("%Y-%m-%d %H:%M:%S %Z")}\n\n'
            f'Please log in to the panel and check server health:\n{panel_url}/panel/statistics/\n\n'
            f'— Adarsh ID Cards Auto-Alert System'
        )

        level_color = {'warning': '#f59e0b', 'critical': '#ef4444', 'danger': '#7f1d1d'}.get(level, '#333')
        html = f"""
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:{level_color};color:#fff;border-radius:8px 8px 0 0;padding:20px 24px;">
            <h2 style="margin:0;font-size:20px;">{subject}</h2>
          </div>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
            <p style="font-size:15px;color:#111;">{intro}</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:8px;color:#6b7280;font-size:13px;width:50%;">Concurrent users</td>
                  <td style="padding:8px;font-weight:700;font-size:15px;">{concurrent_users}</td></tr>
              <tr style="background:#f3f4f6;"><td style="padding:8px;color:#6b7280;font-size:13px;">Threshold</td>
                  <td style="padding:8px;font-weight:700;font-size:15px;">{threshold}+</td></tr>
              <tr><td style="padding:8px;color:#6b7280;font-size:13px;">Time (UTC)</td>
                  <td style="padding:8px;font-size:13px;">{now.strftime('%Y-%m-%d %H:%M:%S')}</td></tr>
            </table>
            <a href="{panel_url}/panel/statistics/"
               style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;
                      border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
              Open Statistics Dashboard →
            </a>
            <p style="margin-top:24px;font-size:12px;color:#9ca3af;">
              This is an automated alert from the Adarsh ID Cards panel.<br>
              Alerts repeat at most once every {ALERT_COOLDOWN_MINUTES} minutes per severity level.
            </p>
          </div>
        </div>
        """

        try:
            send_html_email_async(
                subject=subject_full,
                plain_content=plain,
                html_content=html,
                from_email=None,  # uses DEFAULT_FROM_EMAIL
                recipient_list=admin_emails,
                skip_logging=True,
                email_type='alert',
            )
            alert.last_sent  = now
            alert.last_count = concurrent_users
            alert.save(update_fields=['last_sent', 'last_count'])
            logger.info('Server load alert [%s] sent to %s (%d users online)',
                        level, admin_emails, concurrent_users)
        except Exception:
            logger.exception('Failed to send server load alert [%s]', level)

        break  # only send the highest applicable alert


@login_required
def api_check_server_load(request):
    """
    Lightweight endpoint polled every ~2 minutes by the statistics page JS.
    Returns the current concurrent-user count and any active alert level,
    and triggers email alerts when thresholds are crossed.
    """
    if not PermissionService.can_use_pro_user_options(request.user):
        return JsonResponse({'success': False}, status=403)

    live_clients    = len(LiveClientPresenceService.get_live_client_ids_for_user(request.user))
    live_assistants = LiveClientPresenceService.get_live_assistant_count_for_user(request.user)
    live_sessions   = UserDeviceSession.objects.values('user_id').distinct().count()
    concurrent      = max(live_sessions, live_clients + live_assistants)

    # Determine alert level for the UI
    alert_level = None
    if concurrent >= 100:
        alert_level = 'danger'
    elif concurrent >= 75:
        alert_level = 'critical'
    elif concurrent >= 50:
        alert_level = 'warning'

    # Fire emails asynchronously (won't block the response)
    if alert_level:
        try:
            check_and_send_load_alerts(concurrent)
        except Exception:
            logger.exception('api_check_server_load: alert dispatch failed')

    return JsonResponse({
        'success':      True,
        'concurrent':   concurrent,
        'alert_level':  alert_level,
    })
