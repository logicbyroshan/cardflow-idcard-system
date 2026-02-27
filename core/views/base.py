"""
Base views — Helper functions and Page views.
Contains: Dashboard, Staff Management, Client Management pages, etc.

ARCHITECTURE RULES (enforced):
- Views are ULTRA-THIN: parse request → call service → return response.
- NO .save(), .create(), .delete(), .update() on any model in this file.
- All mutations MUST go through the service layer (IDCardService,
  PermissionService, ClientService, etc.).
- Scoping uses PermissionService.get_accessible_clients() / can_access_client().
"""
from functools import wraps
import json
import logging
from django.conf import settings as django_settings
from django.core.cache import cache
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.urls import reverse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import Count, F, Max, Q
from django.utils import timezone
from ..models import Client, Staff, IDCardGroup, IDCard, IDCardTable, User, SystemSettings, Notification
from ..services import IDCardService
from ..services.activity_service import ActivityService
from ..utils.htmx import is_htmx, render_partial
from ..services.permission_service import (
    PermissionService,
    require_any_admin,
    require_super_admin as _require_super_admin,
    api_require_any_admin,
    api_require_any_authenticated,
    api_require_super_admin as _api_require_super_admin,
)

logger = logging.getLogger(__name__)

# ============================================================================
# DISPLAY LIMITS
# ============================================================================
ACTIVITY_FEED_MAX = 8
GLOBAL_SEARCH_DB_LIMIT = 100
GLOBAL_SEARCH_RESULT_LIMIT = 50

def get_user_role(user):
    """Helper function to get user role display name"""
    return user.get_role_display()


def get_page_range(page_obj, window=2):
    """
    Return a list of page numbers (and '...' for gaps) for the paginator.
    e.g. [1, '...', 4, 5, 6, '...', 10] for page 5 of 10 with window=2.
    """
    num_pages = page_obj.paginator.num_pages
    current = page_obj.number
    pages = []
    if num_pages <= (2 * window + 5):
        return list(range(1, num_pages + 1))
    # Always show first page
    pages.append(1)
    if current - window > 2:
        pages.append('...')
    for p in range(max(2, current - window), min(num_pages, current + window + 1)):
        pages.append(p)
    if current + window < num_pages - 1:
        pages.append('...')
    if num_pages not in pages:
        pages.append(num_pages)
    return pages


def enrich_cards(cards, table_fields, start_index=0):
    """
    Enrich a list/queryset of IDCard objects with ordered field values.
    Returns a list of dicts ready for template rendering.
    """
    enriched = []
    for idx, card in enumerate(cards):
        ordered_fields = []
        field_data = card.field_data or {}
        field_data_normalized = {k.upper(): v for k, v in field_data.items()}
        for field in table_fields:
            field_name = field['name']
            field_type = field['type']
            field_value = field_data.get(field_name, '') or field_data_normalized.get(field_name.upper(), '')
            ordered_fields.append({
                'name': field_name,
                'type': field_type,
                'value': field_value,
            })
        enriched.append({
            'id': card.id,
            'sr_no': start_index + idx + 1,
            'photo': card.photo,
            'status': card.status,
            'get_status_display': card.get_status_display(),
            'updated_at': card.updated_at,
            'downloaded_at': card.downloaded_at,
            'deleted_at': card.deleted_at,
            'ordered_fields': ordered_fields,
        })
    return enriched


def super_admin_required(view_func):
    """
    Deprecated — delegates to require_super_admin from permission_service.
    Kept for backward-compatible imports; will be removed in a future version.
    """
    import warnings
    warnings.warn(
        "super_admin_required is deprecated. "
        "Use 'from core.services.permission_service import require_super_admin' instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return _require_super_admin(view_func)


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

    # Combine card status counts into a single aggregate query (cached 30s)
    # Exclude 'pool' status from total count
    card_cache_key = f'dashboard_card_stats{cache_suffix}'
    card_stats = cache.get(card_cache_key)
    if card_stats is None:
        card_qs = IDCard.objects.all()
        if is_scoped:
            accessible_ids = PermissionService.get_accessible_client_ids(user)
            card_qs = card_qs.filter(table__group__client_id__in=accessible_ids)
        card_stats = card_qs.aggregate(
            total=Count('id', filter=Q(status__in=['pending', 'verified', 'approved', 'download'])),
            pending=Count('id', filter=Q(status='pending')),
            verified=Count('id', filter=Q(status='verified')),
            approved=Count('id', filter=Q(status='approved')),
            downloaded=Count('id', filter=Q(status='download')),
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
        staff_stats = Staff.objects.aggregate(
            total=Count('id'),
            active=Count('id', filter=Q(user__is_active=True)),
        )
        cache.set(staff_cache_key, staff_stats, 60)

    cs_cache_key = f'dashboard_cs_stats{cache_suffix}'
    cs_stats = cache.get(cs_cache_key)
    if cs_stats is None:
        cs_qs = User.objects.filter(role='client_staff')
        if is_scoped:
            from staff.models import Staff as StaffModel
            cs_qs = cs_qs.filter(
                staff_profile__client_id__in=accessible_ids
            )
        cs_stats = cs_qs.aggregate(
            total=Count('id'),
            active=Count('id', filter=Q(is_active=True)),
        )
        cache.set(cs_cache_key, cs_stats, 60)
    context.update({
        'total_clients': client_stats['total'],
        'active_clients': client_stats['active'],
        'total_staff': staff_stats['total'],
        'active_staff': staff_stats['active'],
        'client_staff_count': cs_stats['total'],
        'active_client_staff_count': cs_stats['active'],
        # Role-based activity filtering - admin_staff gets filtered by assigned clients
        'recent_activities': ActivityService.get_recent(limit=ACTIVITY_FEED_MAX, user=request.user),
    })
    return render(request, 'index.html', context)


@require_http_methods(["GET"])
@api_require_any_admin
def api_recent_client_updates(request):
    """API endpoint to get recent clients with their ID card status counts"""
    try:
        limit = int(request.GET.get('limit', 5))
        user = request.user
        
        # Get recent active clients - scoped by PermissionService
        # Order by most-recently-approved card data (latest approved card update first)
        clients = PermissionService.get_accessible_clients(
            user, Client.objects.filter(status='active')
        ).annotate(
            latest_approved=Max(
                'id_card_groups__tables__id_cards__updated_at',
                filter=Q(id_card_groups__tables__id_cards__status='approved')
            )
        ).order_by(F('latest_approved').desc(nulls_last=True))[:limit]
        
        results = []
        
        # Batch-fetch card counts for all clients in 1 query (instead of N)
        card_counts_qs = IDCard.objects.filter(
            table__group__client__in=clients
        ).values('table__group__client_id').annotate(
            pending=Count('id', filter=Q(status='pending')),
            verified=Count('id', filter=Q(status='verified')),
            approved=Count('id', filter=Q(status='approved')),
            downloaded=Count('id', filter=Q(status='download')),
        )
        counts_map = {item['table__group__client_id']: item for item in card_counts_qs}
        
        # Batch-fetch first table IDs in 1 query (instead of N)
        from django.db.models import Min
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
            })
        
        for client in clients:
            cc = counts_map.get(client.id, {})
            results.append({
                'id': client.id,
                'client_id': client.id,
                'name': client.name,
                'initial': client.name[0].upper() if client.name else 'C',
                'first_table_id': first_table_map.get(client.id),
                'tables': tables_map.get(client.id, []),
                'pending': cc.get('pending', 0),
                'verified': cc.get('verified', 0),
                'approved': cc.get('approved', 0),
                'downloaded': cc.get('downloaded', 0),
            })
        
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
def api_recent_activity(request):
    """API endpoint for the Recent Activity feed on the dashboard."""
    try:
        limit = int(request.GET.get('limit', ACTIVITY_FEED_MAX))
        limit = min(limit, ACTIVITY_FEED_MAX)  # Cap at max for 24hr feed
        # Role-based activity filtering
        activities = ActivityService.get_recent(limit=limit, user=request.user)
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
        
        if not query or len(query) < 2:
            return JsonResponse({
                'success': True,
                'results': [],
                'message': 'Please enter at least 2 characters to search'
            })
        
        results = []
        query_upper = query.upper()
        
        # Build base queryset - scope by user role
        user = request.user
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
        
        cards = base_cards[:GLOBAL_SEARCH_DB_LIMIT]  # Limit at database level for speed
        
        for card in cards:
            field_data = card.field_data or {}
            matched_field = ''
            matched_value = ''
            
            # Find which field matched
            for field_name, field_value in field_data.items():
                if not field_value:
                    continue
                    
                field_name_upper = field_name.upper()
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
            
            # Skip if filter was applied but no matching field found
            if filter_type != 'all' and not matched_field:
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
                'matched_field': matched_field or 'Field',
                'matched_value': matched_value or query,
                'url': (f'{reverse("client:idcard_actions", args=[card.table.id])}?status={card.status}&highlight={card.id}'
                        if is_client_role else
                        f'{reverse("idcard_actions", args=[card.table.id])}?status={card.status}&highlight={card.id}') if card.table else '#',
                'icon': 'fa-id-card',
                'status': card.status,
                'photo': photo_url,
            })
            
            # Stop after limit for speed
            if len(results) >= GLOBAL_SEARCH_RESULT_LIMIT:
                break
        
        # Sort by title
        results.sort(key=lambda x: x['title'])
        
        return JsonResponse({
            'success': True,
            'results': results,
            'count': len(results),
            'query': query
        })
    except Exception as e:
        logger.exception('api_global_search error: %s', e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


# Staff Management
@super_admin_required
def manage_staff(request):
    """View to manage admin staff — supports HTMX partial responses."""
    DEFAULT_PER_PAGE = 10
    PER_PAGE_OPTIONS = [5, 10, 25, 50, 100]
    
    try:
        per_page = int(request.GET.get('per_page', DEFAULT_PER_PAGE))
        if per_page not in PER_PAGE_OPTIONS:
            per_page = DEFAULT_PER_PAGE
    except (ValueError, TypeError):
        per_page = DEFAULT_PER_PAGE
    
    page_number = request.GET.get('page', 1)
    search_query = request.GET.get('search', '').strip()
    status_filter = request.GET.get('status', '').strip()
    
    staff_qs = Staff.objects.filter(staff_type='admin_staff').select_related('user').order_by('-id')
    
    # Server-side search
    if search_query:
        staff_qs = staff_qs.filter(
            Q(user__first_name__icontains=search_query) |
            Q(user__last_name__icontains=search_query) |
            Q(user__email__icontains=search_query) |
            Q(user__phone__icontains=search_query) |
            Q(user__username__icontains=search_query)
        )
    
    # Server-side status filter
    if status_filter == 'active':
        staff_qs = staff_qs.filter(user__is_active=True)
    elif status_filter == 'inactive':
        staff_qs = staff_qs.filter(user__is_active=False)
    
    paginator = Paginator(staff_qs, per_page)
    page_obj = paginator.get_page(page_number)
    
    context = {
        'active_page': 'manage_staff',
        'user_role': get_user_role(request.user),
        'staff_list': page_obj.object_list,
        'page_obj': page_obj,
        'page_range': get_page_range(page_obj),
        'per_page': per_page,
        'per_page_options': PER_PAGE_OPTIONS,
        'search_query': search_query,
        'status_filter': status_filter,
    }
    
    if is_htmx(request):
        return render(request, 'partials/staff/table-container.html', context)
    
    return render(request, 'manage-staff.html', context)


# Client Management
@login_required
@require_any_admin
def manage_clients(request):
    """View to manage all clients — supports HTMX partial responses."""
    user = request.user
    DEFAULT_PER_PAGE = 10
    PER_PAGE_OPTIONS = [5, 10, 25, 50, 100]
    
    try:
        per_page = int(request.GET.get('per_page', DEFAULT_PER_PAGE))
        if per_page not in PER_PAGE_OPTIONS:
            per_page = DEFAULT_PER_PAGE
    except (ValueError, TypeError):
        per_page = DEFAULT_PER_PAGE
    
    page_number = request.GET.get('page', 1)
    search_query = request.GET.get('search', '').strip()
    status_filter = request.GET.get('status', '').strip()
    
    clients_qs = PermissionService.get_accessible_clients(
        user, Client.objects.all().select_related('user')
    ).order_by('-id')
    
    if search_query:
        clients_qs = clients_qs.filter(
            Q(name__icontains=search_query) |
            Q(user__email__icontains=search_query) |
            Q(user__phone__icontains=search_query)
        )
    if status_filter and status_filter in ('active', 'inactive', 'suspended'):
        clients_qs = clients_qs.filter(status=status_filter)
    
    paginator = Paginator(clients_qs, per_page)
    page_obj = paginator.get_page(page_number)
    
    context = {
        'active_page': 'manage_clients',
        'user_role': get_user_role(request.user),
        'clients': page_obj.object_list,
        'page_obj': page_obj,
        'page_range': get_page_range(page_obj),
        'per_page': per_page,
        'per_page_options': PER_PAGE_OPTIONS,
        'search_query': search_query,
        'status_filter': status_filter,
    }
    
    if is_htmx(request):
        return render(request, 'partials/client/table-container.html', context)
    
    return render(request, 'manage-client.html', context)


# Active Clients (ID Card Management)
@login_required
@require_any_admin
def active_clients(request):
    """View clients for ID card management — supports HTMX partial responses.
    
    Super-admins and admin-staff see ALL clients (active + inactive) so they
    can manage groups/tables/cards even for deactivated clients.  An optional
    ?status= query-param lets them filter by status.
    """
    user = request.user
    search_query = request.GET.get('search', '').strip()
    status_filter = request.GET.get('status', '').strip()

    DEFAULT_PER_PAGE = 25
    PER_PAGE_OPTIONS = [10, 25, 50, 100]
    try:
        per_page = int(request.GET.get('per_page', DEFAULT_PER_PAGE))
        if per_page not in PER_PAGE_OPTIONS:
            per_page = DEFAULT_PER_PAGE
    except (ValueError, TypeError):
        per_page = DEFAULT_PER_PAGE

    # Admins see all clients; apply optional status filter
    base_qs = Client.objects.all().select_related('user')
    if status_filter and status_filter in ('active', 'inactive', 'suspended'):
        base_qs = base_qs.filter(status=status_filter)

    clients_qs = PermissionService.get_accessible_clients(
        user, base_qs
    ).prefetch_related('id_card_groups').annotate(
        group_count=Count('id_card_groups'),
        table_count=Count('id_card_groups__tables', distinct=True)
    ).order_by('-id')
    
    if search_query:
        clients_qs = clients_qs.filter(
            Q(name__icontains=search_query) |
            Q(user__email__icontains=search_query) |
            Q(user__phone__icontains=search_query)
        )

    paginator = Paginator(clients_qs, per_page)
    page_obj = paginator.get_page(request.GET.get('page', 1))

    context = {
        'active_page': 'active_clients',
        'user_role': get_user_role(request.user),
        'clients': page_obj.object_list,
        'search_query': search_query,
        'status_filter': status_filter,
        'page_obj': page_obj,
        'page_range': get_page_range(page_obj),
        'per_page': per_page,
        'per_page_options': PER_PAGE_OPTIONS,
    }
    
    if is_htmx(request):
        return render(request, 'partials/active-client/table-container.html', context)
    
    return render(request, 'active-client.html', context)


# ID Card Group
@login_required
@require_any_admin
def idcard_group(request, client_id):
    """View ID card groups/tables for a specific client with status counts"""
    client = get_object_or_404(Client, id=client_id)
    
    # Check if user has access to this client
    user = request.user
    if not PermissionService.can_access_client(user, client_id):
        return redirect('active_clients')
    
    # Get all tables for this client's groups with status counts
    tables = IDCardTable.objects.filter(group__client=client).select_related('group', 'group__client').annotate(
        pending_count=Count('id_cards', filter=Q(id_cards__status='pending')),
        verified_count=Count('id_cards', filter=Q(id_cards__status='verified')),
        pool_count=Count('id_cards', filter=Q(id_cards__status='pool')),
        approved_count=Count('id_cards', filter=Q(id_cards__status='approved')),
        download_count=Count('id_cards', filter=Q(id_cards__status='download')),
        reprint_count=Count('id_cards', filter=Q(id_cards__status='reprint')),
        total_cards=Count('id_cards')
    ).order_by('-updated_at')

    # Get default group for Create with XLSX button
    group = IDCardService.ensure_default_group(client)
    
    context = {
        'active_page': 'active_clients',
        'user_role': get_user_role(request.user),
        'client': client,
        'group': group,
        'tables': tables,
    }
    return render(request, 'idcard-group.html', context)


# ────────────────────────────────────────────────────────────
# Shared helper: builds queryset + context for idcard-actions
# Used by admin idcard_actions() and client client_idcard_actions()
# ────────────────────────────────────────────────────────────
_STATUS_LIST_PERM = {
    'pending': 'perm_idcard_pending_list',
    'verified': 'perm_idcard_verified_list',
    'approved': 'perm_idcard_approved_list',
    'download': 'perm_idcard_download_list',
    'pool': 'perm_idcard_pool_list',
    'reprint': 'perm_idcard_reprint_list',
}
_VALID_STATUSES = list(_STATUS_LIST_PERM.keys())


def build_idcard_actions_context(request, table, *, default_per_page=100,
                                  per_page_options=None, active_page='active_clients',
                                  user_role=None):
    """Build the queryset, counts, and template context for idcard-actions.

    Returns a dict ready to be passed to ``render()``.  Caller is still
    responsible for access checks and redirect logic.
    """
    if per_page_options is None:
        per_page_options = [100, 200, 300, 400, 500]

    status_filter = request.GET.get('status', None)

    # ── Pagination params ──
    try:
        per_page = int(request.GET.get('per_page', default_per_page))
        if per_page not in per_page_options:
            per_page = default_per_page
    except (ValueError, TypeError):
        per_page = default_per_page

    search_query = request.GET.get('search', '').strip()
    class_filter = request.GET.get('class', '').strip()
    section_filter = request.GET.get('section', '').strip()

    # ── Base queryset — show recently moved cards first ──
    if status_filter == 'download':
        id_cards_query = IDCard.objects.filter(table=table).defer('photo').order_by('-downloaded_at', '-id')
    elif status_filter == 'pool':
        id_cards_query = IDCard.objects.filter(table=table).defer('photo').order_by('-deleted_at', '-id')
    else:
        id_cards_query = IDCard.objects.filter(table=table).defer('photo').order_by('-updated_at', '-id')
    if status_filter and status_filter in _VALID_STATUSES:
        id_cards_query = id_cards_query.filter(status=status_filter)

    # ── Search ──
    if search_query:
        id_cards_query = id_cards_query.filter(field_data__icontains=search_query)

    # ── Exact class/section filter ──
    if class_filter or section_filter:
        from django.db.models.fields.json import KeyTextTransform
        from core.views.idcard_api import _get_class_section_field_names
        class_field_name, section_field_name = _get_class_section_field_names(table)
        if class_filter and class_field_name:
            id_cards_query = id_cards_query.annotate(
                _cls=KeyTextTransform(class_field_name, 'field_data')
            ).filter(_cls__iexact=class_filter)
        if section_filter and section_field_name:
            id_cards_query = id_cards_query.annotate(
                _sec=KeyTextTransform(section_field_name, 'field_data')
            ).filter(_sec__iexact=section_filter)

    # ── Date range (download only) ──
    from_date = request.GET.get('from', '').strip()
    to_date = request.GET.get('to', '').strip()
    if status_filter == 'download':
        from datetime import datetime as dt
        if from_date:
            try:
                from_dt = dt.fromisoformat(from_date)
                from_dt = timezone.make_aware(from_dt) if timezone.is_naive(from_dt) else from_dt
                id_cards_query = id_cards_query.filter(downloaded_at__gte=from_dt)
            except (ValueError, TypeError):
                pass
        if to_date:
            try:
                to_dt = dt.fromisoformat(to_date)
                to_dt = timezone.make_aware(to_dt) if timezone.is_naive(to_dt) else to_dt
                id_cards_query = id_cards_query.filter(downloaded_at__lte=to_dt)
            except (ValueError, TypeError):
                pass

    total_count = id_cards_query.count()
    status_counts = IDCardService.get_status_counts(table)

    return {
        'active_page': active_page,
        'user_role': user_role or get_user_role(request.user),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'id_cards': [],
        'current_status': status_filter,
        'status_counts': status_counts,
        'total_count': total_count,
        'has_more': True,
        'initial_load_limit': per_page,
        'page_obj': None,
        'page_range': [],
        'per_page': per_page,
        'per_page_options': per_page_options,
        'search_query': search_query,
        'class_filter': class_filter,
        'section_filter': section_filter,
        'from_date': from_date,
        'to_date': to_date,
    }


# ID Card Actions
@login_required
@require_any_admin
def idcard_actions(request, table_id):
    """View and manage ID cards in a table, optionally filtered by status.
    
    Supports HTMX partial responses for pagination, filtering, and status tabs.
    Query params: status, page, per_page, search, class, section
    """
    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    
    # Check if user has access to this table's client
    user = request.user
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('active_clients')
    
    status_filter = request.GET.get('status', None)
    if status_filter:
        required_perm = _STATUS_LIST_PERM.get(status_filter)
        if required_perm and not PermissionService.has_permission(user, required_perm):
            return redirect('active_clients')
    
    context = build_idcard_actions_context(
        request, table,
        default_per_page=100,
        per_page_options=[100, 200, 300, 400, 500],
        active_page='active_clients',
        user_role=get_user_role(user),
    )
    
    # Provide the correct base URL for HTMX requests in the template
    from django.urls import reverse
    context['actions_base_url'] = reverse('idcard_actions', args=[table.id])
    
    # HTMX partial response — return only the table container
    if is_htmx(request):
        return render(request, 'partials/idcard/table-container.html', context)
    
    return render(request, 'idcard-actions.html', context)


# Group Settings
@login_required
@require_any_admin
def group_settings(request, client_id):
    """Settings for a specific client — manage their groups and tables.
    Supports HTMX partial responses for table refresh after CRUD."""
    client = get_object_or_404(Client, id=client_id)
    user = request.user
    if not PermissionService.can_access_client(user, client_id):
        return redirect('active_clients')
    
    search_query = request.GET.get('search', '').strip()
    
    group = IDCardService.ensure_default_group(client)
    tables_qs = IDCardTable.objects.filter(group=group).select_related('group').annotate(
        total_cards=Count('id_cards')
    ).order_by('-created_at')
    
    if search_query:
        tables_qs = tables_qs.filter(name__icontains=search_query)
    
    DEFAULT_PER_PAGE = 10
    PER_PAGE_OPTIONS = [5, 10, 25, 50]
    try:
        per_page = int(request.GET.get('per_page', DEFAULT_PER_PAGE))
        if per_page not in PER_PAGE_OPTIONS:
            per_page = DEFAULT_PER_PAGE
    except (ValueError, TypeError):
        per_page = DEFAULT_PER_PAGE
    
    paginator = Paginator(tables_qs, per_page)
    page_obj = paginator.get_page(request.GET.get('page', 1))
    
    context = {
        'active_page': 'active_clients',
        'user_role': get_user_role(request.user),
        'client': client,
        'group': group,
        'tables': page_obj.object_list,
        'page_obj': page_obj,
        'page_range': get_page_range(page_obj),
        'per_page': per_page,
        'per_page_options': PER_PAGE_OPTIONS,
        'search_query': search_query,
    }
    
    if is_htmx(request):
        return render(request, 'partials/group-setting/table-container.html', context)
    
    return render(request, 'group-setting.html', context)


# Website Management → redirect to new website admin dashboard
@super_admin_required
def manage_website(request):
    """Redirect legacy manage-website URL to new website admin dashboard."""
    from django.shortcuts import redirect
    return redirect('/panel/website/')


# Manage Panel
@super_admin_required
def manage_panel(request):
    """Manage Panel page with notifications, system info, and quick actions."""
    import sys
    import django
    
    context = {
        'is_super_admin': True,
        'active_page': 'manage_panel',
        # System info
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
    # Aggregate user counts in a single query instead of 3 separate .count() calls
    from django.db.models import Q, Sum, Case, When, IntegerField
    user_counts = User.objects.filter(is_active=True).aggregate(
        total=Count('id'),
        admin_staff=Count('id', filter=Q(role='admin_staff')),
        client_staff=Count('id', filter=Q(role='client_staff')),
    )
    context['total_users'] = user_counts['total']
    context['total_admin_staff'] = user_counts['admin_staff']
    context['total_client_staff'] = user_counts['client_staff']
    return render(request, 'manage-panel.html', context)


# NOTE: Reprint Cards page view moved to 'reprintcard' app
# See reprintcard/views.py → reprint_cards()


# System Settings - Available to all logged in users
@login_required
def settings(request):
    """User settings/profile view - accessible by all user types"""
    export_settings = SystemSettings.get_export_settings()
    context = {
        'active_page': 'settings',
        'user_role': get_user_role(request.user),
        'export_settings': export_settings,
    }
    return render(request, 'settings.html', context)


# =========================================================================
# EXPORT SETTINGS API
# =========================================================================

@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_export_settings_get(request):
    """GET /api/export-settings/ — fetch export footer messages (admin only)."""
    data = SystemSettings.get_export_settings()
    return JsonResponse({'success': True, 'data': data})


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_export_settings_update(request):
    """POST /api/export-settings/update/ — update export footer messages (super admin / admin staff only)."""
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    updated = []
    MAX_SETTING_VALUE_LEN = 1000
    for key in SystemSettings.EXPORT_DEFAULTS:
        if key in body:
            val = body[key].strip() if isinstance(body[key], str) else str(body[key]).strip()
            if len(val) > MAX_SETTING_VALUE_LEN:
                return JsonResponse({'success': False, 'message': f'{key} exceeds maximum length of {MAX_SETTING_VALUE_LEN} characters'}, status=400)
            SystemSettings.set_value(key, val)
            updated.append(key)

    if not updated:
        return JsonResponse({'success': False, 'message': 'No valid fields provided'}, status=400)

    return JsonResponse({'success': True, 'message': 'Export settings updated successfully', 'updated': updated})


# =========================================================================
# EXPORT TEMPLATES API
# =========================================================================

@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_export_templates_list(request):
    """GET /api/export-templates/ — list all export templates for download modals."""
    from core.models import ExportTemplate
    templates = ExportTemplate.get_all_as_choices()
    return JsonResponse({'success': True, 'templates': templates})


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_export_template_create(request):
    """POST /api/export-templates/create/ — create a new export template."""
    from core.models import ExportTemplate
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    name = (body.get('name') or '').strip()
    instructions = (body.get('instructions') or '').strip()
    is_default = bool(body.get('is_default', False))

    if not name:
        return JsonResponse({'success': False, 'message': 'Template name is required'}, status=400)
    if not instructions:
        return JsonResponse({'success': False, 'message': 'Instructions text is required'}, status=400)
    if len(instructions) > 5000:
        return JsonResponse({'success': False, 'message': 'Instructions must be 5000 characters or less'}, status=400)
    if len(name) > 100:
        return JsonResponse({'success': False, 'message': 'Name must be 100 characters or less'}, status=400)

    if ExportTemplate.objects.filter(name__iexact=name).exists():
        return JsonResponse({'success': False, 'message': 'A template with this name already exists'}, status=400)

    tpl = ExportTemplate.objects.create(name=name, instructions=instructions, is_default=is_default)
    return JsonResponse({'success': True, 'message': 'Template created', 'template': {
        'id': tpl.id, 'name': tpl.name, 'instructions': tpl.instructions, 'is_default': tpl.is_default
    }})


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_export_template_update(request, template_id):
    """POST /api/export-templates/<id>/update/ — update an export template."""
    from core.models import ExportTemplate
    try:
        tpl = ExportTemplate.objects.get(id=template_id)
    except ExportTemplate.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Template not found'}, status=404)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    name = (body.get('name') or '').strip()
    instructions = (body.get('instructions') or '').strip()
    is_default = body.get('is_default')

    if name:
        if len(name) > 100:
            return JsonResponse({'success': False, 'message': 'Name must be 100 characters or less'}, status=400)
        if ExportTemplate.objects.filter(name__iexact=name).exclude(pk=tpl.pk).exists():
            return JsonResponse({'success': False, 'message': 'A template with this name already exists'}, status=400)
        tpl.name = name
    if instructions:
        if len(instructions) > 5000:
            return JsonResponse({'success': False, 'message': 'Instructions must be 5000 characters or less'}, status=400)
        tpl.instructions = instructions
    if is_default is not None:
        tpl.is_default = bool(is_default)
    tpl.save()

    return JsonResponse({'success': True, 'message': 'Template updated', 'template': {
        'id': tpl.id, 'name': tpl.name, 'instructions': tpl.instructions, 'is_default': tpl.is_default
    }})


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_export_template_delete(request, template_id):
    """POST /api/export-templates/<id>/delete/ — delete an export template."""
    from core.models import ExportTemplate
    try:
        tpl = ExportTemplate.objects.get(id=template_id)
    except ExportTemplate.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Template not found'}, status=404)
    tpl.delete()
    return JsonResponse({'success': True, 'message': 'Template deleted'})


# =============================================================================
# HEALTH / VERSION ENDPOINT (auth-protected)
# =============================================================================

@login_required
@require_any_admin
@require_http_methods(["GET"])
def api_health(request):
    """Auth-protected health & version endpoint."""
    return JsonResponse({
        'status': 'ok',
        'version': getattr(django_settings, 'APP_VERSION', 'unknown'),
    })


# =============================================================================
# PERMISSION DEBUG ENDPOINT (super_admin only)
# =============================================================================

@login_required
@require_http_methods(["GET"])
def api_debug_permissions(request):
    """
    Self-check endpoint: returns the effective permissions for the requesting
    user (or for a target_user_id if the requester is super_admin).

    GET /panel/api/debug/permissions/
    GET /panel/api/debug/permissions/?user_id=42
    """
    from ..services.permission_service import PermissionService, api_require_super_admin
    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Super admin access required'}, status=403)

    target_user = request.user
    user_id = request.GET.get('user_id')
    if user_id:
        try:
            target_user = User.objects.get(pk=int(user_id))
        except (User.DoesNotExist, ValueError):
            return JsonResponse({'success': False, 'message': 'User not found'}, status=404)

    info = PermissionService.debug_permissions(target_user)
    return JsonResponse({'success': True, 'data': info})


# =============================================================================
# WORKFLOW DEBUG ENDPOINT (super_admin only)
# =============================================================================

@login_required
@require_http_methods(["GET"])
def api_debug_workflow(request):
    """
    Workflow self-check endpoint.

    GET /panel/api/debug/workflow-check/?card_id=123
        Returns: current status, allowed transitions (all + user-filtered),
                 mandatory-field status, image-field status.

    GET /panel/api/debug/workflow-check/
        Returns: global transition matrix + reprint matrix.
    """
    from ..services.permission_service import PermissionService
    from ..services.workflow_service import WorkflowService, ReprintWorkflowService

    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Super admin access required'}, status=403)

    card_id = request.GET.get('card_id')
    if card_id:
        try:
            data = WorkflowService.debug_workflow(int(card_id), user=request.user)
        except (ValueError, TypeError):
            return JsonResponse({'success': False, 'message': 'Invalid card_id'}, status=400)
        return JsonResponse({'success': True, 'data': data})

    # Global matrix view
    return JsonResponse({
        'success': True,
        'data': {
            'idcard_transitions': WorkflowService.ALLOWED_TRANSITIONS,
            'idcard_initial_status': WorkflowService.INITIAL_STATUS,
            'idcard_perm_map': WorkflowService.TRANSITION_PERM_MAP,
            'reprint_transitions': ReprintWorkflowService.ALLOWED_TRANSITIONS,
            'reprint_initial_status': ReprintWorkflowService.INITIAL_STATUS,
        }
    })


# =============================================================================
# ALLOWED TRANSITIONS API (any authenticated user)
# =============================================================================

@require_http_methods(["GET"])
@login_required
def api_card_allowed_transitions(request, card_id):
    """
    Return the transitions allowed for a specific card for the requesting user.

    GET /panel/api/card/<card_id>/allowed-transitions/
    Response: { "success": true, "allowed_transitions": ["verified", "pool"] }
    """
    from ..services.workflow_service import WorkflowService

    try:
        card = get_object_or_404(IDCard.objects.select_related('table__group'), id=card_id)
    except Exception:
        return JsonResponse({'success': False, 'message': 'Card not found'}, status=404)

    # IDOR protection: scope card to requesting user's client
    client_id = card.table.group.client_id
    if not PermissionService.can_access_client(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Card not found'}, status=404)

    allowed = WorkflowService.get_allowed_transitions(card, user=request.user)
    return JsonResponse({
        'success': True,
        'current_status': card.status,
        'allowed_transitions': allowed,
    })


# =============================================================================
# IMAGE INTEGRITY DEBUG ENDPOINT (super_admin only)
# =============================================================================

@login_required
@require_http_methods(["GET"])
def api_debug_image_integrity(request):
    """
    Image integrity self-check endpoint.

    GET /panel/api/debug/image-integrity/?card_id=123
        Returns per-card: each image field's stored value, file-on-disk status,
        thumbnail status, CardMedia record status.

    GET /panel/api/debug/image-integrity/?table_id=45
        Returns aggregate: total cards, missing images count, missing thumbnails
        count, orphan CardMedia count.
    """
    from ..services.permission_service import PermissionService
    from ..services.image_service import ImageService
    from ..services.base import BaseService
    from mediafiles.models import CardMedia
    from mediafiles.services import ThumbnailService
    from django.core.files.storage import default_storage

    if not PermissionService.is_super_admin(request.user):
        return JsonResponse({'success': False, 'message': 'Super admin access required'}, status=403)

    card_id = request.GET.get('card_id')
    table_id = request.GET.get('table_id')

    if card_id:
        try:
            card = get_object_or_404(IDCard.objects.select_related('table'), id=int(card_id))
        except (ValueError, TypeError):
            return JsonResponse({'success': False, 'message': 'Invalid card_id'}, status=400)

        table = card.table
        image_field_names = BaseService.get_image_field_names(table.fields)
        field_data = card.field_data or {}
        fields_report = []

        for fname in image_field_names:
            value = field_data.get(fname, '')
            file_exists = False
            thumb_exists = False
            thumb_path = None
            cm_exists = False

            if value and value not in ('NOT_FOUND', '') and not value.startswith('PENDING:'):
                try:
                    file_exists = default_storage.exists(value)
                except Exception:
                    pass
                thumb_path = ThumbnailService.get_thumbnail_path(value)
                if thumb_path:
                    try:
                        thumb_exists = default_storage.exists(thumb_path)
                    except Exception:
                        pass

            cm_exists = CardMedia.objects.filter(card=card, field_name=fname).exists()

            fields_report.append({
                'field_name': fname,
                'stored_value': value,
                'is_pending': value.startswith('PENDING:') if value else False,
                'is_empty': not value or value in ('', 'NOT_FOUND'),
                'file_on_disk': file_exists,
                'thumbnail_path': thumb_path,
                'thumbnail_on_disk': thumb_exists,
                'card_media_exists': cm_exists,
            })

        return JsonResponse({
            'success': True,
            'data': {
                'card_id': card.pk,
                'status': card.status,
                'fields': fields_report,
            }
        })

    if table_id:
        try:
            table = get_object_or_404(IDCardTable, id=int(table_id))
        except (ValueError, TypeError):
            return JsonResponse({'success': False, 'message': 'Invalid table_id'}, status=400)

        image_field_names = BaseService.get_image_field_names(table.fields)
        cards = IDCard.objects.filter(table=table)
        total = cards.count()
        missing_files = 0
        missing_thumbs = 0
        pending_count = 0
        empty_count = 0

        # Sample up to 500 cards for performance
        sample = cards.order_by('id')[:500]

        for card in sample:
            fd = card.field_data or {}
            for fname in image_field_names:
                val = fd.get(fname, '')
                if not val or val in ('', 'NOT_FOUND'):
                    empty_count += 1
                elif val.startswith('PENDING:'):
                    pending_count += 1
                else:
                    try:
                        if not default_storage.exists(val):
                            missing_files += 1
                    except Exception:
                        missing_files += 1
                    tp = ThumbnailService.get_thumbnail_path(val)
                    if tp:
                        try:
                            if not default_storage.exists(tp):
                                missing_thumbs += 1
                        except Exception:
                            missing_thumbs += 1

        # Orphan CardMedia count (records pointing to non-existent cards)
        orphan_cm = CardMedia.objects.filter(
            card__table=table,
        ).exclude(
            card__in=cards,
        ).count()

        return JsonResponse({
            'success': True,
            'data': {
                'table_id': table.pk,
                'table_name': table.name,
                'total_cards': total,
                'sampled_cards': sample.count(),
                'image_fields': image_field_names,
                'missing_files': missing_files,
                'missing_thumbnails': missing_thumbs,
                'pending_images': pending_count,
                'empty_images': empty_count,
                'orphan_card_media': orphan_cm,
            }
        })

    return JsonResponse({
        'success': True,
        'data': {
            'usage': 'Pass ?card_id=N for per-card check, or ?table_id=N for aggregate.',
            'entry_points': [
                'ImageService.save_new_image()',
                'ImageService.replace_image()',
                'ImageService.mark_pending()',
                'ImageService.remove_image()',
                'ImageService.process_image_field()',
            ],
        }
    })
