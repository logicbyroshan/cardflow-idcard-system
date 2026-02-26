"""
PWA Mobile App Views — real backend integration.

All views enforce:
  1. Login required
  2. Client role (client or client_staff)
  3. perm_mobile_app permission enabled
  4. Mobile device user-agent (desktop gets block page)

No new backend logic — delegates entirely to existing services.
"""
import json
import re
from functools import wraps

from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.db.models import Count, Q

from client.services import (
    ClientAccessService,
    ClientDashboardService,
    ClientCardService,
    ClientImageService,
)
from core.services.permission_service import PermissionService
from core.models import IDCardTable, IDCard, IDCardGroup


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
        # super_admin always has access; others need perm_mobile_app
        if not PermissionService.is_super_admin(user):
            if not PermissionService.has(user, 'perm_mobile_app'):
                return render(request, 'mobile_app/no_access.html', status=403)
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

    if result.success:
        data = result.data
        counts = data.get('counts', data.get('card_counts', {}))
        ctx.update({
            'pending_count': counts.get('pending', 0),
            'verified_count': counts.get('verified', 0),
            'approved_count': counts.get('approved', 0),
            'download_count': counts.get('download', 0),
            'pool_count': counts.get('pool', 0),
            'total_cards': data.get('total_cards', 0),
            'recent_activities': data.get('recent_activity', []),
        })
    else:
        ctx.update({
            'pending_count': 0, 'verified_count': 0,
            'approved_count': 0, 'download_count': 0,
            'pool_count': 0, 'total_cards': 0,
            'recent_activities': [],
        })

    return render(request, 'mobile_app/home.html', ctx)


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
        class_name = fd.get('CLASS') or fd.get('class') or fd.get('DESIGNATION') or ''
        section = fd.get('SECTION') or fd.get('section') or ''
        dob = fd.get('DOB') or fd.get('dob') or fd.get('DATE OF BIRTH') or fd.get('DATE_OF_BIRTH') or ''

        photo_url = card.photo.url if card.photo else None
        if not photo_url:
            for val in fd.values():
                if isinstance(val, str) and ('adarshimg/' in val or val.endswith(('.jpg', '.jpeg', '.png', '.webp'))):
                    photo_url = val
                    break

        cards.append({
            'id': card.id,
            'sr_no': idx + 1,
            'name': name,
            'roll_no': roll_no,
            'father_name': father_name,
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
def camera_capture(request, table_id):
    """Camera page for capturing ID-card photos."""
    user = request.user
    client, perms = _client_ctx(user)
    if not client:
        return redirect('/panel/auth/login/')

    # Camera requires image upload permission
    if not PermissionService.has(user, 'perm_reupload_idcard_image'):
        return redirect('mobile_app:home')

    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    if not PermissionService.is_any_admin(user) and not ClientAccessService.can_access_table(user, table):
        return redirect('mobile_app:home')

    return render(request, 'mobile_app/camera.html', {
        'user_name': user.get_full_name() or user.username,
        'client': client,
        'table': table,
        'table_id': table.id,
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
    # Check upload permission
    if not PermissionService.has(request.user, 'perm_reupload_idcard_image'):
        return JsonResponse({'success': False, 'message': 'No permission to upload images'}, status=403)
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
