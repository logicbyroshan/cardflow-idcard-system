"""
Admin page views — staff, client, ID card management pages.
Split from base.py for maintainability.
"""
import logging
from django.conf import settings as django_settings
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.urls import reverse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import Count, Q
from django.utils import timezone

from client.models import Client
from staff.models import Staff
from idcards.models import IDCardGroup, IDCard, IDCardTable
from reprintcard.models import ReprintRequest
from cardprint.models import PrintRequest
from ..models import User, SystemSettings, Notification, EmailLog
from ..services import IDCardService
from ..utils.htmx import is_htmx
from ..services.permission_service import (
    PermissionService,
    require_any_admin,
    require_permission,
)
from .base_helpers import (
    get_user_role,
    get_page_range,
    super_admin_required,
    _STATUS_LIST_PERM,
    _VALID_STATUSES,
)
from .idcard_helpers import _apply_client_staff_row_scope

logger = logging.getLogger(__name__)


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

    Defaults to showing only ACTIVE clients so inactive clients do not appear
    in the print/reprint navigation.  Admins can pass ?status=inactive (or any
    other status value) to access and work with clients of that status.
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

    # Default to active clients so inactive ones don't appear in print/reprint
    # navigation by default.  Admins can filter by any status:
    #   ?status=inactive  → inactive clients
    #   ?status=all       → all clients regardless of status
    #   ?status=active or no param → active clients only
    # Admin staff default to 'all' since they see only assigned clients and
    # need visibility into inactive assigned clients as well.
    if not status_filter and PermissionService.is_admin_staff(user):
        status_filter = 'all'

    if status_filter == 'all':
        base_qs = Client.objects.all().select_related('user')
    elif status_filter in ('inactive', 'suspended'):
        base_qs = Client.objects.filter(status=status_filter).select_related('user')
    else:
        status_filter = 'active'  # normalise for template awareness
        base_qs = Client.objects.filter(status='active').select_related('user')

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

    # ── Base queryset — newest action first in each status list ──
    # Pending/Verified/Approved/Reprint are sorted by last status movement,
    # with created_at fallback for legacy rows where status_changed_at is null.
    from django.db.models.functions import Coalesce
    if status_filter == 'download':
        id_cards_query = IDCard.objects.filter(table=table).order_by('-downloaded_at', '-id')
    elif status_filter == 'pool':
        id_cards_query = IDCard.objects.filter(table=table).order_by('-deleted_at', '-id')
    else:
        id_cards_query = (
            IDCard.objects
            .filter(table=table)
            .annotate(_status_sort_at=Coalesce('status_changed_at', 'created_at'))
            .order_by('-_status_sort_at', '-id')
        )
    if status_filter and status_filter in _VALID_STATUSES:
        id_cards_query = id_cards_query.filter(status=status_filter)

    # Enforce client_staff data partitioning by group/class/section/branch.
    id_cards_query = _apply_client_staff_row_scope(id_cards_query, request.user, table)

    # ── Search ──
    if search_query:
        id_cards_query = IDCardService._apply_search_filter(id_cards_query, search_query, table=table)

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

    if PermissionService.is_client_staff(request.user):
        scoped_cards_qs = _apply_client_staff_row_scope(
            IDCard.objects.filter(table=table),
            request.user,
            table,
        )
        status_counts = {
            'pending': 0,
            'verified': 0,
            'pool': 0,
            'approved': 0,
            'download': 0,
            'reprint': 0,
            'total': 0,
        }
        for row in scoped_cards_qs.values('status').annotate(count=Count('id')):
            st = row.get('status')
            ct = row.get('count', 0)
            if st in status_counts:
                status_counts[st] = ct
                status_counts['total'] += ct

        reprint_counts = {
            'request_list': ReprintRequest.objects.filter(
                table=table,
                status='requested',
                card__status='download',
                card_id__in=scoped_cards_qs.values('id'),
            ).count(),
            'confirmed': ReprintRequest.objects.filter(
                table=table,
                status='confirmed',
                card__status='download',
                card_id__in=scoped_cards_qs.values('id'),
            ).count(),
        }
        print_counts = {
            'generate_list': PrintRequest.objects.filter(
                table=table,
                status='generate_list',
                card_id__in=scoped_cards_qs.values('id'),
            ).count(),
            'finalized': PrintRequest.objects.filter(
                table=table,
                status='finalized',
                card_id__in=scoped_cards_qs.values('id'),
            ).count(),
        }
    else:
        status_counts = IDCardService.get_status_counts(table)
        reprint_counts = {
            'request_list': ReprintRequest.objects.filter(
                table=table,
                status='requested',
                card__status='download',
            ).count(),
            'confirmed': ReprintRequest.objects.filter(
                table=table,
                status='confirmed',
                card__status='download',
            ).count(),
        }
        print_counts = {
            'generate_list': PrintRequest.objects.filter(
                table=table,
                status='generate_list',
            ).count(),
            'finalized': PrintRequest.objects.filter(
                table=table,
                status='finalized',
            ).count(),
        }

    return {
        'active_page': active_page,
        'user_role': user_role or get_user_role(request.user),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'id_cards': [],
        'current_status': status_filter,
        'status_counts': status_counts,
        'reprint_counts': reprint_counts,
        'print_counts': print_counts,
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
    
    # HTMX partial response:
    # - default HTMX requests (pagination/filter) return only table container.
    # - explicit shell request is used by no-reload status-tab navigation.
    force_full_shell = (
        request.GET.get('_shell') == '1'
        or request.headers.get('HX-Boosted', '').lower() == 'true'
    )
    if is_htmx(request) and not force_full_shell:
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
@login_required
@require_permission('perm_website_view')
def manage_website(request):
    """Redirect legacy manage-website URL to new website admin dashboard."""
    from django.shortcuts import redirect
    return redirect('/panel/website/')


# Notifications page, manage_panel, and api_email_logs have moved to the
# panel app.  Import them here so existing URL patterns continue to resolve.
from panel.views.manage_panel_views import (  # noqa: F401
    notifications_page,
    manage_panel,
    api_email_logs,
    api_email_resend,
    api_email_send_new,
    api_email_compose_defaults,
)


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


@login_required
def tutorial(request):
    """Client-facing tutorial and usage guide page."""
    tutorial_lang = str(request.GET.get('lang', 'en')).strip().lower()
    if tutorial_lang not in ('en', 'hi'):
        tutorial_lang = 'en'

    context = {
        'active_page': 'tutorial',
        'user_role': get_user_role(request.user),
        'tutorial_video_url': getattr(django_settings, 'CLIENT_TUTORIAL_VIDEO_URL', 'https://www.youtube.com/'),
        'tutorial_lang': tutorial_lang,
    }
    return render(request, 'tutorial.html', context)
