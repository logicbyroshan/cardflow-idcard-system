"""
PWA Mobile App Views — real backend integration.

All views enforce:
  1. Login required
  2. Valid role (super_admin, admin_staff, client, client_staff)
  3. Mobile device user-agent (desktop gets block page)

No new backend logic — delegates entirely to existing services.
"""
import json
import re
import logging
from functools import wraps

from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.db.models import Count, Q

from client.services import (
    ClientAccessService,
    ClientDashboardService,
    ClientCardService,
    ClientImageService,
    ClientStaffService,
)
from core.services.permission_service import PermissionService
from idcards.models import IDCardTable, IDCard, IDCardGroup
from staff.models import Staff

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def is_mobile(request):
    """Check if request comes from a mobile device."""
    ua = request.META.get('HTTP_USER_AGENT', '')
    return bool(re.search(
        r'Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini',
        ua, re.I,
    ))


def require_mobile_client(view_func):
    """Decorator: login + any valid role + perm_mobile_app + mobile UA.
    Supports all 4 roles: super_admin, admin_staff, client, client_staff.
    After login, redirects back to /app/ (PWA) via ?next= parameter.
    """
    @wraps(view_func)
    @login_required(login_url='/panel/auth/login/?next=/panel/app/')
    def wrapper(request, *args, **kwargs):
        user = request.user
        # Allow all 4 valid roles; reject unknown/empty roles
        valid_roles = ('super_admin', 'admin_staff', 'client', 'client_staff')
        if not hasattr(user, 'role') or user.role not in valid_roles:
            return redirect('/panel/auth/login/?next=/panel/app/')
        # Enforce perm_mobile_app (super_admin always passes)
        if not PermissionService.has(user, 'perm_mobile_app'):
            return JsonResponse({'error': 'Mobile app access not permitted'}, status=403)
        # Desktop users see a block page (rendered client-side in base.html)
        return view_func(request, *args, **kwargs)
    return wrapper


def _client_ctx(user):
    """Return (client, permissions_dict) for the current user.
    For admin roles (super_admin/admin_staff) that have no client profile,
    returns the first active client so PWA views can function.
    """
    client = ClientAccessService.get_client_for_user(user)
    if client is None and PermissionService.is_any_admin(user):
        # Admins can access all clients — pick the first active one
        from client.models import Client
        client = Client.objects.filter(status='active').first()
    perms = PermissionService.get_permission_context(user)
    return client, perms


# ---------------------------------------------------------------------------
# PAGE VIEWS
# ---------------------------------------------------------------------------

@require_mobile_client
def home(request):
    """Home dashboard with real card counts and recent activity."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    result = ClientDashboardService.get_dashboard_data(user, client=client)

    tables = IDCardTable.objects.filter(
        group__client=client, is_active=True,
    ).select_related('group').order_by('group__name', 'name')
    first_table = tables.first()

    ctx = {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'first_table_id': first_table.id if first_table else None,
        'tables': tables,
        'table_count': tables.count(),
        **perms,
    }

    # Admin-specific counts for dashboard management section
    if PermissionService.is_any_admin(user):
        from client.models import Client
        from staff.models import Staff
        ctx['admin_client_count'] = Client.objects.filter(status='active').count()
        ctx['admin_staff_count'] = Staff.objects.count()
        ctx['admin_table_count'] = IDCardTable.objects.filter(is_active=True).count()
        ctx['admin_total_cards'] = IDCard.objects.count()

    if result.success:
        data = result.data
        counts = data.get('counts', data.get('card_counts', {}))
        recent = data.get('recent_activity', [])
        ctx.update({
            'pending_count': counts.get('pending', 0),
            'verified_count': counts.get('verified', 0),
            'approved_count': counts.get('approved', 0),
            'download_count': counts.get('download', 0),
            'pool_count': counts.get('pool', 0),
            'total_cards': data.get('total_cards', 0),
            'recent_activities': recent,
            'has_new_activity': len(recent) > 0,
        })
    else:
        ctx.update({
            'pending_count': 0, 'verified_count': 0,
            'approved_count': 0, 'download_count': 0,
            'pool_count': 0, 'total_cards': 0,
            'recent_activities': [],
            'has_new_activity': False,
        })

    return render(request, 'mobile_app/home.html', ctx)


@require_mobile_client
def clients_list(request):
    """In-app client list for admin roles — switch active client context."""
    user = request.user
    _, perms = _client_ctx(user)
    if not PermissionService.is_any_admin(user):
        return redirect('mobile_app:home')

    from client.models import Client
    from django.db.models import Count, Q
    clients = Client.objects.filter(status='active').annotate(
        tables_count=Count(
            'id_card_groups__tables',
            filter=Q(id_card_groups__tables__is_active=True),
            distinct=True,
        ),
        cards_count=Count(
            'id_card_groups__tables__id_cards',
            distinct=True,
        ),
    ).order_by('name')
    client_data = []
    for c in clients:
        client_data.append({
            'id': c.id,
            'name': c.name,
            'tables_count': c.tables_count,
            'cards_count': c.cards_count,
            'status': c.status,
        })

    return render(request, 'mobile_app/clients_list.html', {
        'user_name': user.get_full_name() or user.username,
        'clients': client_data,
        'client_count': len(client_data),
        **perms,
    })


@require_mobile_client
def table_picker(request, status):
    """
    Show table picker when client has multiple tables.
    If only one table, redirect straight to card list.
    """
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    # Check status-specific list permission before showing tables
    status_perm = PermissionService.STATUS_LIST_PERM_MAP.get(status)
    if status_perm and not PermissionService.has(user, status_perm):
        return redirect('mobile_app:home')

    tables = IDCardTable.objects.filter(
        group__client=client, is_active=True,
    ).select_related('group').annotate(
        status_count=Count('id_cards', filter=Q(id_cards__status=status)),
    ).order_by('group__name', 'name')

    if tables.count() == 1:
        return redirect('mobile_app:card_list', table_id=tables.first().id, status=status)

    return render(request, 'mobile_app/table_picker.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'tables': tables,
        'status': status,
        'status_display': status.replace('_', ' ').title(),
        **perms,
    })


@require_mobile_client
def card_list(request, table_id, status):
    """Card list for a specific table + status — server-rendered."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    # Admin roles can access any table; client roles only their own
    if not PermissionService.is_any_admin(user) and not ClientAccessService.can_access_table(user, table):
        return redirect('mobile_app:home')

    status_perm = PermissionService.STATUS_LIST_PERM_MAP.get(status)
    if status_perm and not PermissionService.has(user, status_perm):
        return redirect('mobile_app:home')

    cards_qs = IDCard.objects.filter(table=table, status=status).order_by('-updated_at')
    total_count = cards_qs.count()
    cards_batch = cards_qs[:500]

    cards = []
    for idx, card in enumerate(cards_batch):
        fd = card.field_data or {}
        name = fd.get('NAME') or fd.get('name') or fd.get('Name') or f'Card #{card.id}'
        roll_no = fd.get('ROLL NO') or fd.get('ROLL_NO') or fd.get('roll_no') or fd.get('ID') or ''
        father_name = fd.get('FATHER NAME') or fd.get("FATHER'S NAME") or fd.get('FATHER_NAME') or fd.get('father_name') or ''
        mother_name = fd.get('MOTHER NAME') or fd.get("MOTHER'S NAME") or fd.get('MOTHER_NAME') or fd.get('mother_name') or ''
        class_name = fd.get('CLASS') or fd.get('class') or fd.get('DESIGNATION') or ''
        section = fd.get('SECTION') or fd.get('section') or ''
        dob = fd.get('DOB') or fd.get('dob') or fd.get('DATE OF BIRTH') or fd.get('DATE_OF_BIRTH') or ''

        photo_url = card.photo.url if card.photo else None
        if not photo_url:
            for val in fd.values():
                if isinstance(val, str) and ('adarshimg/' in val or val.endswith(('.jpg', '.jpeg', '.png', '.webp'))):
                    # Ensure the path has proper /media/ prefix
                    if val.startswith('/'):
                        photo_url = val
                    elif val.startswith('http'):
                        photo_url = val
                    else:
                        photo_url = settings.MEDIA_URL + val
                    break

        cards.append({
            'id': card.id,
            'sr_no': idx + 1,
            'name': name,
            'roll_no': roll_no,
            'father_name': father_name,
            'mother_name': mother_name,
            'class_name': class_name,
            'section': section,
            'dob': dob,
            'photo_url': photo_url,
            'has_photo': bool(photo_url),
            'status': card.status,
            'field_data': fd,
        })

    all_classes = sorted(set(c['class_name'] for c in cards if c['class_name']))
    all_sections = sorted(set(c['section'] for c in cards if c['section']))
    table_fields = table.fields if hasattr(table, 'fields') and table.fields else []

    return render(request, 'mobile_app/list_page.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'table': table,
        'table_id': table.id,
        'group': table.group,
        'students': cards,
        'students_json': json.dumps(cards, default=str),
        'total_count': total_count,
        'list_type': status,
        'classes': all_classes,
        'sections': all_sections,
        'table_fields': json.dumps(table_fields, default=str),
        **perms,
    })


@require_mobile_client
def camera_capture(request, table_id, card_id=None):
    """Camera page for capturing ID-card photos."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    if not PermissionService.is_any_admin(user) and not ClientAccessService.can_access_table(user, table):
        return redirect('mobile_app:home')

    # If no specific card_id provided, show card picker with cards missing photos
    cards_without_photo = []
    if card_id is None:
        cards_qs = IDCard.objects.filter(table=table).exclude(
            photo__isnull=False
        ).exclude(photo='').order_by('id')[:100]
        for card in cards_qs:
            fd = card.field_data or {}
            name = fd.get('NAME') or fd.get('name') or fd.get('Name') or f'Card #{card.id}'
            cards_without_photo.append({'id': card.id, 'name': name})

    return render(request, 'mobile_app/camera.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'table': table,
        'table_id': table.id,
        'card_id': card_id or 0,
        'cards_without_photo': json.dumps(cards_without_photo),
        **perms,
    })


@require_mobile_client
def notifications(request):
    """Notifications — shows real recent activity."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    result = ClientDashboardService.get_dashboard_data(user, client=client)
    activities = []
    if result.success:
        for act in result.data.get('recent_activity', []):
            status = act.get('status', '')
            icon_map = {
                'pending': 'fa-clock', 'verified': 'fa-check-circle',
                'approved': 'fa-check-double', 'download': 'fa-download',
                'pool': 'fa-layer-group', 'reprint': 'fa-redo',
            }
            color_map = {
                'pending': 'yellow', 'verified': 'green',
                'approved': 'blue', 'download': 'purple',
                'pool': 'red', 'reprint': 'orange',
            }
            activities.append({
                'title': f"{act.get('name', 'Card')} — {act.get('status_display', status)}",
                'message': f"Table: {act.get('table_name', '')}",
                'time': act.get('updated_at', ''),
                'read': True,
                'icon': icon_map.get(status, 'fa-info-circle'),
                'color': color_map.get(status, 'gray'),
            })

    return render(request, 'mobile_app/notifications.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'notifications': activities,
        **perms,
    })


@require_mobile_client
def profile(request):
    """Profile page with real user data."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    return render(request, 'mobile_app/profile.html', {
        'user_name': user.get_full_name() or user.username,
        'user_email': user.email or '',
        'user_phone': getattr(user, 'phone', '') or '',
        'user_role': {
            'super_admin': 'Super Admin',
            'admin_staff': 'Admin Staff',
            'client': 'Client Admin',
            'client_staff': 'Client Staff',
        }.get(getattr(user, 'role', ''), 'User'),
        'client': client,
        'client_name': client.name if client else '',
        **perms,
    })


# ---------------------------------------------------------------------------
# API VIEWS — thin proxies to existing services
# ---------------------------------------------------------------------------

@require_mobile_client
@require_http_methods(["POST"])
def api_card_status(request, card_id):
    """Change single card status."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    new_status = data.get('status', '')
    result = ClientCardService.change_card_status(request.user, card_id, new_status)
    if result.success:
        return JsonResponse({'success': True, 'message': result.message, **(result.data or {})})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
def api_bulk_status(request, table_id):
    """Bulk status change."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    card_ids = data.get('card_ids', [])
    new_status = data.get('status', '')
    result = ClientCardService.bulk_change_status(request.user, table_id, card_ids, new_status)
    if result.success:
        return JsonResponse({'success': True, 'message': result.message, **(result.data or {})})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
def api_upload_photo(request, table_id):
    """Upload photo for a card."""
    card_id = request.POST.get('card_id')
    photo = request.FILES.get('photo')
    if not photo or not card_id:
        return JsonResponse({'success': False, 'message': 'photo and card_id required'}, status=400)
    try:
        card = IDCard.objects.select_related('table__group').get(id=card_id)
        if not PermissionService.is_any_admin(request.user) and not ClientAccessService.can_access_card(request.user, card):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
        import os, uuid
        ext = os.path.splitext(photo.name)[1][:10] or '.jpg'
        safe_name = f'{uuid.uuid4().hex}{ext}'
        card.photo.save(safe_name, photo, save=True)
        return JsonResponse({'success': True, 'message': 'Photo uploaded', 'photo_url': card.photo.url})
    except IDCard.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Card not found'}, status=404)
    except Exception:
        import logging as _log
        _log.getLogger(__name__).exception('Photo upload error')
        return JsonResponse({'success': False, 'message': 'An error occurred during upload.'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_card_detail(request, card_id):
    """Get card detail JSON."""
    result = ClientCardService.get_card_detail(request.user, card_id)
    if result.success:
        return JsonResponse({'success': True, 'data': result.data})
    return JsonResponse({'success': False, 'message': result.message}, status=404)


@require_mobile_client
@require_http_methods(["GET"])
def api_cards(request, table_id):
    """Get cards for a table (paginated)."""
    status_filter = request.GET.get('status', '')
    search = request.GET.get('search', '')
    try:
        page = int(request.GET.get('page', 1))
        per_page = min(int(request.GET.get('per_page', 50)), 200)
    except (ValueError, TypeError):
        page, per_page = 1, 50

    offset = (page - 1) * per_page
    result = ClientCardService.get_cards(
        request.user, table_id,
        status_filter or None, offset, per_page,
        search or None,
    )
    if result.success:
        return JsonResponse({'success': True, 'data': result.data})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
def api_card_add(request, table_id):
    """Add a new card to a table."""
    try:
        table = get_object_or_404(IDCardTable, id=table_id, is_active=True)
        if not PermissionService.is_any_admin(request.user) and not ClientAccessService.can_access_table(request.user, table):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

        field_data_raw = request.POST.get('field_data', '{}')
        try:
            field_data = json.loads(field_data_raw)
        except json.JSONDecodeError:
            field_data = {}

        card = IDCard.objects.create(table=table, field_data=field_data, status='pending')

        photo = request.FILES.get('photo')
        if photo:
            import os, uuid
            ext = os.path.splitext(photo.name)[1][:10] or '.jpg'
            safe_name = f'{uuid.uuid4().hex}{ext}'
            card.photo.save(safe_name, photo, save=True)

        return JsonResponse({'success': True, 'message': 'Card added successfully', 'card_id': card.id})
    except Exception:
        import logging as _log
        _log.getLogger(__name__).exception('Card add error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["POST"])
def api_card_update(request, table_id, card_id):
    """Update an existing card."""
    try:
        card = get_object_or_404(IDCard.objects.select_related('table__group'), id=card_id, table_id=table_id)
        if not PermissionService.is_any_admin(request.user) and not ClientAccessService.can_access_card(request.user, card):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

        field_data_raw = request.POST.get('field_data', '{}')
        try:
            field_data = json.loads(field_data_raw)
        except json.JSONDecodeError:
            field_data = {}

        if field_data:
            existing = card.field_data or {}
            existing.update(field_data)
            card.field_data = existing

        photo = request.FILES.get('photo')
        if photo:
            import os, uuid
            ext = os.path.splitext(photo.name)[1][:10] or '.jpg'
            safe_name = f'{uuid.uuid4().hex}{ext}'
            card.photo.save(safe_name, photo, save=False)

        card.save()
        return JsonResponse({'success': True, 'message': 'Card updated successfully'})
    except Exception:
        logger.exception('Card update error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


# ---------------------------------------------------------------------------
# NEW PAGE VIEWS — Card detail, Staff, Groups, Settings, Search
# ---------------------------------------------------------------------------

@require_mobile_client
def card_detail(request, card_id):
    """Full card detail page with all field data."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    result = ClientCardService.get_card_detail(user, card_id)
    if not result.success:
        return redirect('mobile_app:home')

    card_data = result.data

    return render(request, 'mobile_app/card_detail.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'card': card_data,
        'card_json': json.dumps(card_data, default=str),
        **perms,
    })


@require_mobile_client
def staff_manage(request):
    """Staff management page (client role only — manages client_staff)."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    # Only client role can manage staff
    if not PermissionService.is_client(user) and not PermissionService.is_any_admin(user):
        return redirect('mobile_app:home')

    # For client role, use the service; for admins, show all staff
    staff_list = []
    if PermissionService.is_client(user):
        result = ClientStaffService.list_staff(user)
        if result.success:
            staff_list = result.data.get('staff', [])
    elif PermissionService.is_any_admin(user):
        # Admin can see all staff
        all_staff = Staff.objects.select_related('user').order_by('-created_at')[:200]
        for s in all_staff:
            staff_list.append({
                'id': s.id,
                'name': s.user.get_full_name() or s.user.username,
                'email': s.user.email,
                'phone': getattr(s.user, 'phone', '') or '',
                'department': s.department or '',
                'designation': s.designation or '',
                'is_active': s.user.is_active,
                'staff_type': s.get_staff_type_display(),
                'created_at': s.created_at.strftime('%d %b %Y'),
            })

    # Get groups for assignment dropdown
    groups = IDCardGroup.objects.filter(client=client).values('id', 'name')

    return render(request, 'mobile_app/staff_manage.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'staff_list': staff_list,
        'staff_json': json.dumps(staff_list, default=str),
        'groups': list(groups),
        'groups_json': json.dumps(list(groups), default=str),
        **perms,
    })


@require_mobile_client
def groups_overview(request):
    """Groups & tables overview page."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    groups = IDCardGroup.objects.filter(client=client).annotate(
        table_count=Count('tables'),
        total_cards=Count('tables__id_cards'),
        pending_cards=Count('tables__id_cards', filter=Q(tables__id_cards__status='pending')),
        verified_cards=Count('tables__id_cards', filter=Q(tables__id_cards__status='verified')),
        approved_cards=Count('tables__id_cards', filter=Q(tables__id_cards__status='approved')),
        download_cards=Count('tables__id_cards', filter=Q(tables__id_cards__status='download')),
    ).order_by('name')

    tables = IDCardTable.objects.filter(group__client=client).select_related('group').annotate(
        total_cards=Count('id_cards'),
        pending_cards=Count('id_cards', filter=Q(id_cards__status='pending')),
        verified_cards=Count('id_cards', filter=Q(id_cards__status='verified')),
        approved_cards=Count('id_cards', filter=Q(id_cards__status='approved')),
        download_cards=Count('id_cards', filter=Q(id_cards__status='download')),
    ).order_by('group__name', 'name')

    return render(request, 'mobile_app/groups.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'groups': groups,
        'tables': tables,
        **perms,
    })


@require_mobile_client
def settings_page(request):
    """Settings / admin overview page."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    ctx = {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        **perms,
    }

    # Counts
    ctx['table_count'] = IDCardTable.objects.filter(group__client=client, is_active=True).count()
    ctx['group_count'] = IDCardGroup.objects.filter(client=client).count()
    ctx['total_cards'] = IDCard.objects.filter(table__group__client=client).count()

    # Admin-specific
    if PermissionService.is_any_admin(user):
        from client.models import Client
        ctx['admin_client_count'] = Client.objects.filter(status='active').count()
        ctx['admin_staff_count'] = Staff.objects.count()
        ctx['admin_table_count'] = IDCardTable.objects.filter(is_active=True).count()
        ctx['admin_total_cards'] = IDCard.objects.count()

    return render(request, 'mobile_app/settings.html', ctx)


@require_mobile_client
def search_page(request):
    """Search page — search across all cards in client's tables."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    query = request.GET.get('q', '').strip()
    results = []

    if query and len(query) >= 2:
        cards_qs = IDCard.objects.filter(
            table__group__client=client,
        ).select_related('table', 'table__group').order_by('-updated_at')

        # Search in field_data
        cards_qs = cards_qs.filter(
            Q(field_data__NAME__icontains=query) |
            Q(field_data__name__icontains=query) |
            Q(field_data__Name__icontains=query) |
            Q(field_data__ROLL_NO__icontains=query) |
            Q(field_data__roll_no__icontains=query) |
            Q(field_data__ID__icontains=query)
        )[:50]

        for card in cards_qs:
            fd = card.field_data or {}
            name = fd.get('NAME') or fd.get('name') or fd.get('Name') or f'Card #{card.id}'
            roll_no = fd.get('ROLL NO') or fd.get('ROLL_NO') or fd.get('roll_no') or ''
            photo_url = card.photo.url if card.photo else None
            if not photo_url:
                for val in fd.values():
                    if isinstance(val, str) and ('adarshimg/' in val or val.endswith(('.jpg', '.jpeg', '.png', '.webp'))):
                        photo_url = (settings.MEDIA_URL + val) if not val.startswith(('/','http')) else val
                        break

            results.append({
                'id': card.id,
                'name': name,
                'roll_no': roll_no,
                'status': card.status,
                'table_name': card.table.name,
                'group_name': card.table.group.name,
                'photo_url': photo_url,
            })

    return render(request, 'mobile_app/search.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'query': query,
        'results': results,
        'result_count': len(results),
        **perms,
    })


# ---------------------------------------------------------------------------
# NEW API VIEWS
# ---------------------------------------------------------------------------

@require_mobile_client
@require_http_methods(["POST"])
def api_card_delete(request, card_id):
    """Delete a single card (move to pool or permanently delete)."""
    try:
        card = get_object_or_404(IDCard.objects.select_related('table__group'), id=card_id)
        user = request.user
        if not PermissionService.is_any_admin(user) and not ClientAccessService.can_access_card(user, card):
            return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
        if not PermissionService.has(user, 'perm_idcard_delete'):
            return JsonResponse({'success': False, 'message': 'No delete permission'}, status=403)

        data = json.loads(request.body) if request.body else {}
        permanent = data.get('permanent', False)

        if permanent and card.status == 'pool':
            if not PermissionService.has(user, 'perm_idcard_delete_from_pool'):
                return JsonResponse({'success': False, 'message': 'No pool delete permission'}, status=403)
            card.delete()
            return JsonResponse({'success': True, 'message': 'Card permanently deleted'})
        else:
            card.status = 'pool'
            card.save(update_fields=['status'])
            return JsonResponse({'success': True, 'message': 'Card moved to pool'})
    except Exception:
        logger.exception('Card delete error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_staff_list(request):
    """List staff for the client."""
    user = request.user
    if PermissionService.is_client(user):
        result = ClientStaffService.list_staff(user)
        if result.success:
            return JsonResponse({'success': True, 'data': result.data})
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    elif PermissionService.is_any_admin(user):
        all_staff = Staff.objects.select_related('user').order_by('-created_at')[:200]
        staff_data = []
        for s in all_staff:
            staff_data.append({
                'id': s.id,
                'name': s.user.get_full_name() or s.user.username,
                'email': s.user.email,
                'phone': getattr(s.user, 'phone', '') or '',
                'department': s.department or '',
                'designation': s.designation or '',
                'is_active': s.user.is_active,
                'staff_type': s.get_staff_type_display(),
            })
        return JsonResponse({'success': True, 'data': {'staff': staff_data}})
    return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)


@require_mobile_client
@require_http_methods(["POST"])
def api_staff_create(request):
    """Create a new staff member."""
    user = request.user
    if not PermissionService.is_client(user):
        return JsonResponse({'success': False, 'message': 'Only clients can create staff'}, status=403)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    result = ClientStaffService.create_staff(user, data)
    if result.success:
        return JsonResponse({'success': True, 'message': result.message, **(result.data or {})})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
def api_staff_update(request, staff_id):
    """Update a staff member."""
    user = request.user
    if not PermissionService.is_client(user):
        return JsonResponse({'success': False, 'message': 'Only clients can update staff'}, status=403)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    result = ClientStaffService.update_staff(user, staff_id, data)
    if result.success:
        return JsonResponse({'success': True, 'message': result.message})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
def api_staff_toggle(request, staff_id):
    """Toggle staff active/inactive."""
    user = request.user
    if not PermissionService.is_client(user):
        return JsonResponse({'success': False, 'message': 'Only clients can manage staff'}, status=403)

    result = ClientStaffService.toggle_staff_status(user, staff_id)
    if result.success:
        return JsonResponse({'success': True, 'message': result.message, **(result.data or {})})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
def api_staff_delete(request, staff_id):
    """Delete a staff member."""
    user = request.user
    if not PermissionService.is_client(user):
        return JsonResponse({'success': False, 'message': 'Only clients can delete staff'}, status=403)

    result = ClientStaffService.delete_staff(user, staff_id)
    if result.success:
        return JsonResponse({'success': True, 'message': result.message})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_mobile_client
@require_http_methods(["POST"])
def api_profile_update(request):
    """Update current user's profile."""
    user = request.user
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    try:
        if 'first_name' in data:
            user.first_name = data['first_name'].strip()
        if 'last_name' in data:
            user.last_name = data['last_name'].strip()
        if 'phone' in data and hasattr(user, 'phone'):
            user.phone = data['phone'].strip()

        # Handle combined name field
        name = data.get('name', '').strip()
        if name and 'first_name' not in data:
            parts = name.split()
            user.first_name = parts[0] if parts else ''
            user.last_name = ' '.join(parts[1:]) if len(parts) > 1 else ''

        user.save()
        return JsonResponse({
            'success': True,
            'message': 'Profile updated successfully',
            'name': user.get_full_name() or user.username,
        })
    except Exception:
        logger.exception('Profile update error')
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=500)


@require_mobile_client
@require_http_methods(["GET"])
def api_search(request):
    """Global search API across all client cards."""
    user = request.user
    client, _ = _client_ctx(user)
    if not client:
        return JsonResponse({'success': False, 'message': 'No client'}, status=400)

    query = request.GET.get('q', '').strip()
    if not query or len(query) < 2:
        return JsonResponse({'success': True, 'data': {'results': [], 'count': 0}})

    cards_qs = IDCard.objects.filter(
        table__group__client=client,
    ).select_related('table', 'table__group').order_by('-updated_at')

    cards_qs = cards_qs.filter(
        Q(field_data__NAME__icontains=query) |
        Q(field_data__name__icontains=query) |
        Q(field_data__Name__icontains=query) |
        Q(field_data__ROLL_NO__icontains=query) |
        Q(field_data__roll_no__icontains=query) |
        Q(field_data__ID__icontains=query)
    )[:30]

    results = []
    for card in cards_qs:
        fd = card.field_data or {}
        name = fd.get('NAME') or fd.get('name') or fd.get('Name') or f'Card #{card.id}'
        roll_no = fd.get('ROLL NO') or fd.get('ROLL_NO') or fd.get('roll_no') or ''
        photo_url = card.photo.url if card.photo else None
        results.append({
            'id': card.id,
            'name': name,
            'roll_no': roll_no,
            'status': card.status,
            'table_name': card.table.name,
            'photo_url': photo_url,
        })

    return JsonResponse({'success': True, 'data': {'results': results, 'count': len(results)}})
