"""
Dashboard views — dashboard page, cropper page, and dashboard API endpoints.
Split from base.py for maintainability.
"""
import logging
from django.core.cache import cache
from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.urls import reverse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.db.models import Count, F, Max, Q, Min
from django.utils import timezone

from client.models import Client
from staff.models import Staff
from idcards.models import IDCard, IDCardTable
from ..models import User
from ..services import IDCardService
from ..services.activity_service import ActivityService
from ..utils.htmx import is_htmx
from ..services.permission_service import (
    PermissionService,
    require_any_admin,
    api_require_any_admin,
    api_require_any_authenticated,
)
from .base_helpers import (
    get_user_role,
    ACTIVITY_FEED_MAX,
    GLOBAL_SEARCH_DB_LIMIT,
    GLOBAL_SEARCH_RESULT_LIMIT,
)

logger = logging.getLogger(__name__)
RECENT_ACTIVITY_FALLBACK_HOURS = 48


def _parse_dashboard_limit(raw_limit, *, default=500, max_limit=500):
    """Parse and clamp dashboard limit query params."""
    try:
        limit = int(raw_limit)
    except (ValueError, TypeError):
        limit = default
    return min(max(limit, 1), max_limit)


def _get_dashboard_recent_activities(*, user, limit):
    """Prefer last 48 hours; fall back to overall recent feed when needed."""
    recent_window = ActivityService.get_recent(
        limit=limit,
        hours=RECENT_ACTIVITY_FALLBACK_HOURS,
        user=user,
    )
    if len(recent_window) >= limit:
        return recent_window
    return ActivityService.get_recent(limit=limit, hours=None, user=user)


# ── Services ─────────────────────────────────────────────────────────────
@login_required
@require_any_admin
def adarsh_cropper(request):
    """Adarsh Cropper service page — admin & admin staff only."""
    context = {
        'active_page': 'adarsh_cropper',
        'user_role': get_user_role(request.user),
    }
    return render(request, 'services/adarsh-cropper.html', context)


# ── Login As User (Pro User only) ─────────────────────────────────────
@login_required
def login_as_user_page(request):
    """Dedicated page for Pro User impersonation."""
    if request.user.role != 'pro_user':
        return redirect('dashboard')
    context = {
        'active_page': 'impersonate',
        'user_role': get_user_role(request.user),
    }
    return render(request, 'impersonate/login-as-user.html', context)


# ── Pro User Deep History (Pro User only) ─────────────────────────────
@login_required
def pro_user_activity_logs_page(request):
    """Dedicated page for Pro User deep user-history audit."""
    if request.user.role != 'pro_user':
        return redirect('dashboard')
    context = {
        'active_page': 'pro_user_activity_logs',
        'user_role': get_user_role(request.user),
    }
    return render(request, 'pro_user/user-deep-history.html', context)


@login_required
def pro_user_activity_logs_detail_page(request, user_id):
    """Dedicated detail page for a selected user's deep history (Pro User only)."""
    if request.user.role != 'pro_user':
        return redirect('dashboard')

    target_user = get_object_or_404(User, id=user_id)
    context = {
        'active_page': 'pro_user_activity_logs',
        'user_role': get_user_role(request.user),
        'audit_target': {
            'id': target_user.id,
            'name': (target_user.get_full_name() or target_user.username or target_user.email or f'User {target_user.id}').strip(),
            'email_or_username': target_user.email or target_user.username or '-',
            'role_display': target_user.get_role_display() if hasattr(target_user, 'get_role_display') else (target_user.role or '-'),
        },
    }
    return render(request, 'pro_user/user-deep-history-detail.html', context)


# Dashboard
@login_required
@require_any_admin
def dashboard(request):
    """Main dashboard view - Super Admin & Admin Staff"""
    # Mobile users should use the PWA mobile app, not the desktop dashboard
    import re
    ua = request.META.get('HTTP_USER_AGENT', '')
    if re.search(r'Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini', ua, re.I):
        return redirect('/panel/app/')

    # Scope cache keys per user for admin_staff (they only see assigned clients)
    user = request.user
    is_scoped = PermissionService.is_admin_staff(user)
    cache_suffix = f':{user.pk}' if is_scoped else ''

    # Pre-fetch accessible client IDs ONCE for admin_staff users.
    # This must be computed before any cache block so it's always available
    # when is_scoped=True, regardless of which cache keys hit/miss.
    accessible_ids = PermissionService.get_accessible_client_ids(user) if is_scoped else []

    # Combine card status counts into a single aggregate query (cached 30s)
    # Exclude 'pool' status from total count
    card_cache_key = f'dashboard_card_stats{cache_suffix}'
    card_stats = cache.get(card_cache_key)
    if card_stats is None:
        card_qs = IDCard.objects.all()
        if is_scoped:
            card_qs = card_qs.filter(table__group__client_id__in=accessible_ids)
        card_stats = card_qs.aggregate(
            total=Count('id', filter=Q(status__in=['pending', 'verified', 'approved', 'download'])),
            pending=Count('id', filter=Q(status='pending')),
            verified=Count('id', filter=Q(status='verified')),
            approved=Count('id', filter=Q(status='approved')),
            downloaded=Count('id', filter=Q(status='download')),
            pool=Count('id', filter=Q(status='pool')),
        )
        cache.set(card_cache_key, card_stats, 30)

    context = {
        'active_page': 'dashboard',
        'user_role': get_user_role(request.user),
        'total_id_cards': card_stats['total'],
        'pending_cards': card_stats['pending'],
        'verified_cards': card_stats['verified'],
        'approved_cards': card_stats['approved'],
        'downloaded_cards': card_stats['downloaded'],
        'pool_cards': card_stats.get('pool', 0),
    }
    # Consolidate count queries with aggregate (cached 60s)
    client_cache_key = f'dashboard_client_stats{cache_suffix}'
    client_stats = cache.get(client_cache_key)
    if client_stats is None:
        client_qs = Client.objects.all()
        if is_scoped:
            client_qs = client_qs.filter(id__in=accessible_ids)
        client_stats = client_qs.aggregate(
            total=Count('id'),
            active=Count('id', filter=Q(status='active')),
        )
        cache.set(client_cache_key, client_stats, 60)

    staff_cache_key = f'dashboard_staff_stats{cache_suffix}'
    staff_stats = cache.get(staff_cache_key)
    if staff_stats is None:
        # Team Overview "Total/Active Staff" should represent admin staff only.
        staff_qs = Staff.objects.filter(staff_type='admin_staff')
        staff_stats = staff_qs.aggregate(
            total=Count('id'),
            active=Count('id', filter=Q(user__is_active=True)),
        )
        cache.set(staff_cache_key, staff_stats, 60)

    cs_cache_key = f'dashboard_cs_stats{cache_suffix}'
    cs_stats = cache.get(cs_cache_key)
    if cs_stats is None:
        cs_qs = Staff.objects.filter(staff_type='client_staff')
        if is_scoped:
            cs_qs = cs_qs.filter(client_id__in=accessible_ids)
        cs_stats = cs_qs.aggregate(
            total=Count('id'),
            active=Count('id', filter=Q(user__is_active=True)),
        )
        cache.set(cs_cache_key, cs_stats, 60)
    context.update({
        'total_clients': client_stats['total'],
        'active_clients': client_stats['active'],
        'total_staff': staff_stats['total'],
        'active_staff': staff_stats['active'],
        'client_staff_count': cs_stats['total'],
        'active_client_staff_count': cs_stats['active'],
        # Prefer last 48 hours; fallback to latest overall feed for fuller history.
        'recent_activities': _get_dashboard_recent_activities(user=request.user, limit=ACTIVITY_FEED_MAX),
    })
    return render(request, 'index.html', context)


@require_http_methods(["GET"])
@api_require_any_admin
def api_dashboard_card_stats(request):
    """API endpoint for live dashboard card stats refresh."""
    try:
        user = request.user
        is_scoped = PermissionService.is_admin_staff(user)
        cache_suffix = f':{user.pk}' if is_scoped else ':sa'
        cache_key = f'dash_card_stats_api{cache_suffix}'

        stats = cache.get(cache_key)
        if stats is None:
            accessible_ids = PermissionService.get_accessible_client_ids(user) if is_scoped else []

            card_qs = IDCard.objects.all()
            if is_scoped:
                card_qs = card_qs.filter(table__group__client_id__in=accessible_ids)

            agg = card_qs.aggregate(
                total=Count('id', filter=Q(status__in=['pending', 'verified', 'approved', 'download'])),
                pending=Count('id', filter=Q(status='pending')),
                verified=Count('id', filter=Q(status='verified')),
                approved=Count('id', filter=Q(status='approved')),
                downloaded=Count('id', filter=Q(status='download')),
                pool=Count('id', filter=Q(status='pool')),
            )
            stats = {
                'total': agg.get('total', 0),
                'pending': agg.get('pending', 0),
                'verified': agg.get('verified', 0),
                'approved': agg.get('approved', 0),
                'downloaded': agg.get('downloaded', 0),
                'pool': agg.get('pool', 0),
            }
            cache.set(cache_key, stats, 20)

        return JsonResponse({'success': True, 'stats': stats})
    except Exception as e:
        logger.exception('api_dashboard_card_stats error: %s', e)
        return JsonResponse({'success': False, 'error': 'An error occurred. Please try again.'}, status=500)


@require_http_methods(["GET"])
@api_require_any_admin
def api_recent_client_updates(request):
    """API endpoint to get recent clients with their ID card status counts"""
    try:
        limit = _parse_dashboard_limit(request.GET.get('limit', 500), default=500, max_limit=500)
        user = request.user

        # Cache per-user with 20-second TTL — tolerable staleness for a dashboard poll.
        # admin_staff sees a scoped view (their assigned clients only), so the key
        # must include user.pk to prevent cross-user data leakage.
        is_scoped = PermissionService.is_admin_staff(user)
        cache_key = f'dash_rcu:{user.pk if is_scoped else "sa"}:{limit}'
        cached = cache.get(cache_key)
        if cached is not None:
            return JsonResponse({'success': True, 'clients': cached})

        # Get recent clients - scoped by PermissionService
        # Show all accessible clients (including inactive) for dashboard recents.
        # Order by most-recently-approved card data, then newest-created client.
        base_qs = Client.objects.all()
        clients = PermissionService.get_accessible_clients(
            user, base_qs
        ).annotate(
            latest_approved=Max(
                'id_card_groups__tables__id_cards__updated_at',
                filter=Q(id_card_groups__tables__id_cards__status='approved')
            )
        ).order_by(
            F('latest_approved').desc(nulls_last=True),
            F('created_at').desc(nulls_last=True),
            F('id').desc(),
        )[:limit]
        
        results = []
        
        # Batch-fetch card counts for all clients in 1 query (instead of N)
        card_counts_qs = IDCard.objects.filter(
            table__group__client__in=clients
        ).values('table__group__client_id').annotate(
            pending=Count('id', filter=Q(status='pending')),
            verified=Count('id', filter=Q(status='verified')),
            approved=Count('id', filter=Q(status='approved')),
            downloaded=Count('id', filter=Q(status='download')),
            pool=Count('id', filter=Q(status='pool')),
        )
        counts_map = {item['table__group__client_id']: item for item in card_counts_qs}
        
        # Batch-fetch first table IDs in 1 query (instead of N)
        first_table_qs = IDCardTable.objects.filter(
            group__client__in=clients
        ).values('group__client_id').annotate(first_table_id=Min('id'))
        first_table_map = {item['group__client_id']: item['first_table_id'] for item in first_table_qs}
        
        # Batch-fetch all tables with per-table card counts
        tables_qs = IDCardTable.objects.filter(
            group__client__in=clients
        ).values('id', 'name', 'group__client_id').annotate(
            pending=Count('id_cards', filter=Q(id_cards__status='pending')),
            verified=Count('id_cards', filter=Q(id_cards__status='verified')),
            approved=Count('id_cards', filter=Q(id_cards__status='approved')),
            downloaded=Count('id_cards', filter=Q(id_cards__status='download')),
            pool=Count('id_cards', filter=Q(id_cards__status='pool')),
        ).order_by('id')
        tables_map = {}
        for t in tables_qs:
            cid = t['group__client_id']
            if cid not in tables_map:
                tables_map[cid] = []
            tables_map[cid].append({
                'id': t['id'],
                'name': t['name'],
                'pending': t['pending'],
                'verified': t['verified'],
                'approved': t['approved'],
                'downloaded': t['downloaded'],
                'pool': t['pool'],
            })
        
        for client in clients:
            cc = counts_map.get(client.id, {})
            results.append({
                'id': client.id,
                'client_id': client.id,
                'name': client.name,
                'status': client.status,
                'initial': client.name[0].upper() if client.name else 'C',
                'first_table_id': first_table_map.get(client.id),
                'tables': tables_map.get(client.id, []),
                'pending': cc.get('pending', 0),
                'verified': cc.get('verified', 0),
                'approved': cc.get('approved', 0),
                'downloaded': cc.get('downloaded', 0),
                'pool': cc.get('pool', 0),
            })

        cache.set(cache_key, results, 20)
        return JsonResponse({
            'success': True,
            'clients': results
        })
    except Exception as e:
        logger.exception('api_recent_client_updates error: %s', e)
        return JsonResponse({
            'success': False,
            'error': 'An error occurred. Please try again.'
        }, status=500)


@require_http_methods(["GET"])
@api_require_any_admin
def api_print_reprint_overview(request):
    """
    Dashboard API: per-client counts for Card Printing and Card Reprinting stages.
    Returns expandable table data matching the Recent Client Updates pattern.
    """
    try:
        from cardprint.models import PrintRequest
        from reprintcard.models import ReprintRequest

        limit = _parse_dashboard_limit(request.GET.get('limit', 500), default=500, max_limit=500)
        user = request.user

        # 20-second per-user cache — same pattern as api_recent_client_updates.
        is_scoped = PermissionService.is_admin_staff(user)
        cache_key = f'dash_ppr:{user.pk if is_scoped else "sa"}:{limit}'
        cached = cache.get(cache_key)
        if cached is not None:
            return JsonResponse({'success': True, **cached})

        # Show all accessible clients (including inactive) for both admin roles.
        base_qs = Client.objects.all()
        accessible_clients = PermissionService.get_accessible_clients(user, base_qs)

        # Order print clients by latest generate-list activity, then newest client.
        print_clients_qs = accessible_clients.annotate(
            latest_generate_update=Max(
                'id_card_groups__tables__print_requests__updated_at',
                filter=Q(id_card_groups__tables__print_requests__status='generate_list')
            )
        ).order_by(
            F('latest_generate_update').desc(nulls_last=True),
            F('created_at').desc(nulls_last=True),
            F('id').desc(),
        )[:limit]

        # Order reprint clients by latest request-list activity, then newest client.
        reprint_clients_qs = accessible_clients.annotate(
            latest_request_update=Max(
                'id_card_groups__tables__reprint_requests__updated_at',
                filter=Q(id_card_groups__tables__reprint_requests__status='requested')
            )
        ).order_by(
            F('latest_request_update').desc(nulls_last=True),
            F('created_at').desc(nulls_last=True),
            F('id').desc(),
        )[:limit]

        print_clients_list = list(print_clients_qs)
        reprint_clients_list = list(reprint_clients_qs)
        client_ids = list({c.id for c in (print_clients_list + reprint_clients_list)})

        # ── Print counts per client ──────────────────────────────────
        print_counts_qs = PrintRequest.objects.filter(
            table__group__client_id__in=client_ids
        ).values('table__group__client_id').annotate(
            generate_list=Count('id', filter=Q(status='generate_list')),
            finalized=Count('id', filter=Q(status='finalized')),
            pool=Count('id', filter=Q(status='pool')),
        )
        print_map = {r['table__group__client_id']: r for r in print_counts_qs}

        # ── Print counts per table ───────────────────────────────────
        print_table_qs = PrintRequest.objects.filter(
            table__group__client_id__in=client_ids
        ).values('table__id', 'table__name', 'table__group__client_id', 'table__created_at').annotate(
            generate_list=Count('id', filter=Q(status='generate_list')),
            finalized=Count('id', filter=Q(status='finalized')),
            pool=Count('id', filter=Q(status='pool')),
            latest_generate_update=Max('updated_at', filter=Q(status='generate_list')),
        ).order_by('table__id')
        print_tables_map = {}
        for t in print_table_qs:
            cid = t['table__group__client_id']
            if cid not in print_tables_map:
                print_tables_map[cid] = []
            print_tables_map[cid].append({
                'id': t['table__id'],
                'name': t['table__name'],
                'generate_list': t['generate_list'],
                'finalized': t['finalized'],
                'pool': t['pool'],
                'latest_generate_update': t.get('latest_generate_update'),
                'table_created_at': t.get('table__created_at'),
            })

        for cid, tables in print_tables_map.items():
            tables.sort(
                key=lambda x: (
                    x.get('latest_generate_update') is not None,
                    x.get('latest_generate_update') or x.get('table_created_at'),
                    x.get('table_created_at'),
                    x.get('id') or 0,
                ),
                reverse=True,
            )

        # ── Reprint source counts per client (Download cards only) ─
        reprint_source_qs = IDCard.objects.filter(
            table__group__client_id__in=client_ids,
            status='download',
        ).values('table__group__client_id').annotate(
            download_list=Count('id')
        )
        reprint_source_map = {r['table__group__client_id']: r for r in reprint_source_qs}

        # ── Reprint request/confirmed counts per client ──────────────
        reprint_counts_qs = ReprintRequest.objects.filter(
            table__group__client_id__in=client_ids,
            card__status='download',
        ).values('table__group__client_id').annotate(
            requested=Count('id', filter=Q(status='requested')),
            confirmed=Count('id', filter=Q(status='confirmed')),
        )
        reprint_map = {r['table__group__client_id']: r for r in reprint_counts_qs}

        # ── Reprint source counts per table ──────────────────────────
        reprint_source_table_qs = IDCard.objects.filter(
            table__group__client_id__in=client_ids,
            status='download',
        ).values('table__id', 'table__name', 'table__group__client_id', 'table__created_at').annotate(
            download_list=Count('id')
        ).order_by('table__id')
        reprint_source_table_map = {}
        for t in reprint_source_table_qs:
            cid = t['table__group__client_id']
            if cid not in reprint_source_table_map:
                reprint_source_table_map[cid] = {}
            reprint_source_table_map[cid][t['table__id']] = {
                'id': t['table__id'],
                'name': t['table__name'],
                'download_list': t['download_list'],
                'requested': 0,
                'confirmed': 0,
                'latest_update': None,
                'table_created_at': t.get('table__created_at'),
            }

        # ── Reprint request/confirmed counts per table ───────────────
        reprint_table_qs = ReprintRequest.objects.filter(
            table__group__client_id__in=client_ids,
            card__status='download',
        ).values('table__id', 'table__name', 'table__group__client_id', 'table__created_at').annotate(
            requested=Count('id', filter=Q(status='requested')),
            confirmed=Count('id', filter=Q(status='confirmed')),
            latest_update=Max('updated_at', filter=Q(status='requested')),
        ).order_by('table__id')

        for t in reprint_table_qs:
            cid = t['table__group__client_id']
            if cid not in reprint_source_table_map:
                reprint_source_table_map[cid] = {}
            if t['table__id'] not in reprint_source_table_map[cid]:
                reprint_source_table_map[cid][t['table__id']] = {
                    'id': t['table__id'],
                    'name': t['table__name'],
                    'download_list': 0,
                    'requested': 0,
                    'confirmed': 0,
                    'latest_update': None,
                    'table_created_at': t.get('table__created_at'),
                }
            reprint_source_table_map[cid][t['table__id']]['requested'] = t['requested']
            reprint_source_table_map[cid][t['table__id']]['confirmed'] = t['confirmed']
            reprint_source_table_map[cid][t['table__id']]['latest_update'] = t['latest_update']
            if not reprint_source_table_map[cid][t['table__id']].get('table_created_at'):
                reprint_source_table_map[cid][t['table__id']]['table_created_at'] = t.get('table__created_at')

        reprint_tables_map = {}
        for cid, table_map in reprint_source_table_map.items():
            tables = list(table_map.values())
            tables.sort(
                key=lambda x: (
                    x.get('latest_update') is not None,
                    x.get('latest_update') or x.get('table_created_at'),
                    x.get('table_created_at'),
                    x.get('id') or 0,
                ),
                reverse=True,
            )
            reprint_tables_map[cid] = tables

        # Total requested should represent all accessible clients, not just the limited list.
        reprint_total_requested = ReprintRequest.objects.filter(
            table__group__client__in=accessible_clients,
            card__status='download',
            status='requested',
        ).count()

        # ── Build per-client results ─────────────────────────────────
        print_clients = []
        reprint_clients = []

        for c in print_clients_list:
            pc = print_map.get(c.id, {})
            print_clients.append({
                'id': c.id,
                'name': c.name,
                'status': c.status,
                'generate_list': pc.get('generate_list', 0),
                'finalized': pc.get('finalized', 0),
                'pool': pc.get('pool', 0),
                'tables': [
                    {
                        'id': t['id'],
                        'name': t['name'],
                        'generate_list': t['generate_list'],
                        'finalized': t['finalized'],
                        'pool': t['pool'],
                    }
                    for t in print_tables_map.get(c.id, [])
                ],
            })


        for c in reprint_clients_list:
            rc = reprint_map.get(c.id, {})
            source = reprint_source_map.get(c.id, {})
            reprint_clients.append({
                'id': c.id,
                'name': c.name,
                'status': c.status,
                'download_list': source.get('download_list', 0),
                'reprint_list': source.get('download_list', 0),
                'requested': rc.get('requested', 0),
                'confirmed': rc.get('confirmed', 0),
                'tables': [
                    {
                        'id': t['id'],
                        'name': t['name'],
                        'download_list': t.get('download_list', 0),
                        'requested': t.get('requested', 0),
                        'confirmed': t.get('confirmed', 0),
                    }
                    for t in reprint_tables_map.get(c.id, [])
                ],
            })

        payload = {
            'print_clients': print_clients,
            'reprint_clients': reprint_clients,
            'reprint_total_requested': reprint_total_requested,
        }
        cache.set(cache_key, payload, 20)
        return JsonResponse({
            'success': True,
            'print_clients': print_clients,
            'reprint_clients': reprint_clients,
            'reprint_total_requested': reprint_total_requested,
        })
    except Exception as e:
        logger.exception('api_print_reprint_overview error: %s', e)
        return JsonResponse({
            'success': False,
            'error': 'An error occurred. Please try again.'
        }, status=500)


@require_http_methods(["GET"])
@api_require_any_admin
def api_recent_activity(request):
    """API endpoint for the Recent Activity feed on the dashboard."""
    try:
        limit = _parse_dashboard_limit(
            request.GET.get('limit', ACTIVITY_FEED_MAX),
            default=ACTIVITY_FEED_MAX,
            max_limit=ACTIVITY_FEED_MAX,
        )
        activities = _get_dashboard_recent_activities(user=request.user, limit=limit)
        return JsonResponse({'success': True, 'activities': activities})
    except Exception as e:
        logger.exception('api_recent_activity error: %s', e)
        return JsonResponse({'success': False, 'error': 'An error occurred. Please try again.'}, status=500)


@require_http_methods(["GET"])
@api_require_any_authenticated
def api_global_search(request):
    """API endpoint for global search across all ID cards within clients"""
    try:
        query = request.GET.get('q', '').strip()
        filter_type = request.GET.get('filter', 'all')
        raw_table_id = (request.GET.get('table_id') or '').strip()

        scoped_table_id = None
        if raw_table_id:
            if not raw_table_id.isdigit():
                return JsonResponse({'success': False, 'message': 'Invalid table scope.'}, status=400)
            scoped_table_id = int(raw_table_id)
            if scoped_table_id <= 0:
                return JsonResponse({'success': False, 'message': 'Invalid table scope.'}, status=400)
        
        if not query or len(query) < 2:
            return JsonResponse({
                'success': True,
                'results': [],
                'message': 'Please enter at least 2 characters to search'
            })

        user = request.user
        scope_sig = f'table:{scoped_table_id}' if scoped_table_id else 'all'
        cache_key = f'global-search:{user.id}:{scope_sig}:{filter_type}:{query.lower()}'
        cached = cache.get(cache_key)
        if cached is not None:
            return JsonResponse(cached)
        
        results = []
        query_upper = query.upper()
        image_field_types = {'photo', 'mother_photo', 'father_photo', 'image', 'signature'}
        non_searchable_field_types = {'file', 'barcode', 'qr_code'}
        non_searchable_name_tokens = ('BARCODE', 'QR', 'FILE')
        
        # Build base queryset - scope by user role
        base_cards = IDCard.objects.select_related(
            'table', 'table__group', 'table__group__client'
        ).only(
            'id', 'field_data', 'status', 'photo',
            'table__id', 'table__name', 'table__fields',
            'table__group__id', 'table__group__client__id', 'table__group__client__name',
        ).filter(
            field_data__icontains=query
        )
        
        # Scope by role
        is_client_role = user.role in ('client', 'client_staff')
        if PermissionService.is_super_admin(user):
            pass  # super_admin sees all
        elif user.role in ('client', 'client_staff'):
            from client.services import ClientAccessService
            client = ClientAccessService.get_client_for_user(user)
            if client:
                base_cards = base_cards.filter(table__group__client=client)
            else:
                base_cards = base_cards.none()
        else:
            # Admin staff sees only assigned clients — use PermissionService
            accessible_ids = PermissionService.get_accessible_client_ids(user)
            if accessible_ids:
                base_cards = base_cards.filter(table__group__client_id__in=accessible_ids)
            else:
                base_cards = base_cards.none()

        if scoped_table_id:
            scoped_table = IDCardTable.objects.select_related('group').filter(id=scoped_table_id).first()
            if not scoped_table:
                return JsonResponse({'success': False, 'message': 'Table not found.'}, status=404)

            if not PermissionService.can_access_client(user, scoped_table.group.client_id):
                return JsonResponse({'success': False, 'message': 'Access denied.'}, status=403)

            if user.role in ('client', 'client_staff'):
                from client.services import ClientAccessService
                if not ClientAccessService.can_access_table(user, scoped_table):
                    return JsonResponse({'success': False, 'message': 'Access denied.'}, status=403)

            base_cards = base_cards.filter(table_id=scoped_table_id)
        
        cards = base_cards[:GLOBAL_SEARCH_DB_LIMIT]  # Limit at database level for speed
        
        for card in cards:
            field_data = card.field_data or {}
            matched_field = ''
            matched_value = ''

            field_type_by_name = {}
            if card.table and card.table.fields:
                for field in card.table.fields:
                    fname = str(field.get('name', '')).strip().upper()
                    if not fname:
                        continue
                    field_type_by_name[fname] = str(field.get('type', 'text')).strip().lower()
            
            # Find which field matched
            for field_name, field_value in field_data.items():
                if not field_value:
                    continue
                    
                field_name_upper = str(field_name).upper()
                field_type = field_type_by_name.get(field_name_upper, '')

                is_image_field = (
                    field_type in image_field_types
                    or ((not field_type) and ('PHOTO' in field_name_upper or 'IMAGE' in field_name_upper or 'SIGN' in field_name_upper))
                )

                if is_image_field:
                    if filter_type != 'all':
                        continue
                    image_basename = IDCardService.image_path_basename(field_value)
                    if image_basename and query_upper in image_basename.upper():
                        matched_field = field_name
                        matched_value = image_basename
                        break
                    continue

                # Ignore image/file-like columns so storage paths do not pollute search.
                if field_type in non_searchable_field_types:
                    continue
                if (not field_type) and any(token in field_name_upper for token in non_searchable_name_tokens):
                    continue

                field_value_str = str(field_value).upper()
                
                # Apply filter
                if filter_type != 'all':
                    if filter_type == 'name' and 'NAME' not in field_name_upper:
                        continue
                    elif filter_type == 'address' and 'ADDRESS' not in field_name_upper:
                        continue
                    elif filter_type == 'mobile' and 'MOBILE' not in field_name_upper and 'PHONE' not in field_name_upper and 'MOB' not in field_name_upper:
                        continue
                
                if query_upper in field_value_str:
                    matched_field = field_name
                    matched_value = str(field_value)
                    break
            
            # Skip cards where no searchable field value actually matched.
            if not matched_field:
                continue
                
            # Get display name from first text field
            display_name = ''
            if card.table and card.table.fields:
                for field in card.table.fields:
                    if field.get('type') in ['text', 'textarea'] and field.get('name') in field_data:
                        display_name = field_data.get(field.get('name'), '')
                        break
            
            client_name = card.table.group.client.name if card.table and card.table.group else 'Unknown'
            table_name = card.table.name if card.table else 'Unknown'
            
            # Find first valid photo from image fields
            photo_url = None
            if card.table and card.table.fields:
                for field in card.table.fields:
                    fname = field.get('name', '')
                    ftype = field.get('type', 'text')
                    if ftype in ('photo', 'mother_photo', 'father_photo', 'image'):
                        val = field_data.get(fname, '')
                        if val and not str(val).startswith('PENDING:') and val != 'NOT_FOUND':
                            photo_url = f'/media/{val}' if not str(val).startswith('/') else val
                            break
            # Fallback to legacy photo field
            if not photo_url and card.photo:
                try:
                    photo_url = card.photo.url
                except Exception:
                    pass
            
            results.append({
                'type': 'idcard',
                'id': card.id,
                'title': display_name or f'Card #{card.id}',
                'subtitle': f'{client_name} • {table_name} • {card.get_status_display()}',
                'table_id': card.table.id if card.table else None,
                'table_name': table_name,
                'matched_field': matched_field or 'Field',
                'matched_value': matched_value or query,
                'url': (f'{reverse("client:idcard_actions", args=[card.table.id])}?status={card.status}&highlight={card.id}'
                        if is_client_role else
                        f'{reverse("idcard_actions", args=[card.table.id])}?status={card.status}&highlight={card.id}') if card.table else '#',
                'icon': 'fa-id-card',
                'status': card.status,
                'status_display': card.get_status_display(),
                'photo': photo_url,
            })
            
            # Stop after limit for speed
            if len(results) >= GLOBAL_SEARCH_RESULT_LIMIT:
                break
        
        # Sort by title
        results.sort(key=lambda x: x['title'])
        
        payload = {
            'success': True,
            'results': results,
            'count': len(results),
            'query': query
        }
        cache.set(cache_key, payload, 30)
        return JsonResponse(payload)
    except Exception as e:
        logger.exception('api_global_search error: %s', e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)
