"""
Client Views Module

Views for client-facing features:
- Dashboard
- Staff Management (for Client Admin)
- Card Data Views
- Image Uploads
- ID Card Group (shared admin template)
- ID Card Actions (shared admin template)
- Group Settings (shared admin template)
- Reprint Cards (shared admin template)
"""
import json
from functools import wraps

from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q

from core.models import Client, Staff, IDCardGroup, IDCardTable, IDCard
from core.services import IDCardService
from core.services.permission_service import PermissionService

from .services import (
    ClientAccessService,
    ClientDashboardService,
    ClientStaffService,
    ClientCardService,
    ClientImageService,
)


# =============================================================================
# DECORATORS
# =============================================================================

def require_client_user(view_func):
    """
    Decorator to require client or client_staff role.
    """
    @wraps(view_func)
    @login_required(login_url='/panel/auth/login/')
    def wrapper(request, *args, **kwargs):
        user = request.user
        if user.role not in ('client', 'client_staff'):
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({
                    'success': False,
                    'message': 'Client access required'
                }, status=403)
            return redirect('/panel/auth/login/')
        return view_func(request, *args, **kwargs)
    return wrapper


def require_client_admin(view_func):
    """
    Decorator to require client role (not client_staff).
    Used for staff management and other admin-only features.
    """
    @wraps(view_func)
    @login_required(login_url='/panel/auth/login/')
    def wrapper(request, *args, **kwargs):
        user = request.user
        if user.role != 'client':
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({
                    'success': False,
                    'message': 'Client Admin access required'
                }, status=403)
            return redirect('/panel/client/dashboard/')
        return view_func(request, *args, **kwargs)
    return wrapper


# =============================================================================
# PAGE VIEWS
# =============================================================================

@require_client_user
def dashboard(request):
    """
    Client Dashboard - shows summary of card data and quick actions.
    """
    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    
    if not client:
        return redirect('/panel/auth/login/')
    
    # Get dashboard data
    result = ClientDashboardService.get_dashboard_data(user)
    
    # Get permission context
    permissions = PermissionService.get_permission_context(user)
    
    context = {
        'user': user,
        'user_name': user.get_full_name() or user.username,
        'user_role': 'Client Admin' if user.role == 'client' else 'Client Staff',
        'client': client,
        'is_client_admin': user.role == 'client',
        'active_page': 'dashboard',
        **permissions,
    }
    
    if result.success:
        context.update(result.data)
    
    return render(request, 'client/dashboard.html', context)


@require_client_user
def card_groups(request):
    """
    View all card groups (ID Card Settings) for the client.
    """
    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    
    if not client:
        return redirect('/panel/auth/login/')
    
    # Check permission
    if not PermissionService.has_permission(user, 'perm_idcard_setting_list'):
        return redirect('/panel/client/dashboard/')
    
    result = ClientDashboardService.get_groups_with_counts(user)
    permissions = PermissionService.get_permission_context(user)
    
    context = {
        'user': user,
        'user_name': user.get_full_name() or user.username,
        'user_role': 'Client Admin' if user.role == 'client' else 'Client Staff',
        'client': client,
        'is_client_admin': user.role == 'client',
        'active_page': 'groups',
        'groups': result.data.get('groups', []) if result.success else [],
        **permissions,
    }
    
    return render(request, 'client/groups.html', context)


@require_client_user
def card_table(request, table_id):
    """
    View cards in a specific table.
    """
    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    
    if not client:
        return redirect('/panel/auth/login/')
    
    # Require at least one list permission to view cards
    LIST_PERMISSIONS = [
        'perm_idcard_setting_list', 'perm_idcard_pending_list',
        'perm_idcard_verified_list', 'perm_idcard_approved_list',
        'perm_idcard_download_list', 'perm_idcard_pool_list',
        'perm_idcard_reprint_list',
    ]
    if not any(PermissionService.has_permission(user, p) for p in LIST_PERMISSIONS):
        return redirect('/panel/client/dashboard/')
    
    # Verify access
    try:
        table = IDCardTable.objects.get(id=table_id)
    except IDCardTable.DoesNotExist:
        return redirect('/panel/client/groups/')
    
    if not ClientAccessService.can_access_table(user, table):
        return redirect('/panel/client/groups/')
    
    # Get status filter from query params
    status_filter = request.GET.get('status', '')
    
    permissions = PermissionService.get_permission_context(user)
    
    context = {
        'user': user,
        'user_name': user.get_full_name() or user.username,
        'user_role': 'Client Admin' if user.role == 'client' else 'Client Staff',
        'client': client,
        'is_client_admin': user.role == 'client',
        'active_page': 'groups',
        'table': table,
        'group': table.group,
        'status_filter': status_filter,
        **permissions,
    }
    
    return render(request, 'client/cards.html', context)


@require_client_admin
def manage_staff(request):
    """
    Manage client staff members.
    Only accessible by Client Admin.
    Uses same layout as admin manage-staff page.
    """
    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    
    if not client:
        return redirect('/panel/auth/login/')
    
    # Check permission
    if not PermissionService.has_permission(user, 'perm_idcard_client_list'):
        return redirect('/panel/client/dashboard/')
    
    # Get Staff QuerySet directly for server-side table rendering
    from staff.models import Staff
    staff_list = Staff.objects.filter(
        client=client,
        staff_type='client_staff'
    ).select_related('user').order_by('-created_at')
    
    permissions = PermissionService.get_permission_context(user)
    
    context = {
        'user': user,
        'user_name': user.get_full_name() or user.username,
        'user_role': 'Client Admin',
        'client': client,
        'is_client_admin': True,
        'active_page': 'staff',
        'staff_list': staff_list,
        **permissions,
    }
    
    return render(request, 'client/staff.html', context)


# =============================================================================
# API VIEWS - Dashboard
# =============================================================================

@require_client_user
@require_http_methods(["GET"])
def api_dashboard_data(request):
    """
    API: Get dashboard summary data.
    """
    result = ClientDashboardService.get_dashboard_data(request.user)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'data': result.data
        })
    
    return JsonResponse({
        'success': False,
        'message': result.message
    }, status=400)


@require_client_user
@require_http_methods(["GET"])
def api_groups_list(request):
    """
    API: Get list of groups with card counts.
    """
    # Check permission (matches the page view gate)
    if not PermissionService.has_permission(request.user, 'perm_idcard_setting_list'):
        return JsonResponse({
            'success': False,
            'message': 'Permission denied'
        }, status=403)

    result = ClientDashboardService.get_groups_with_counts(request.user)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'data': {'groups': result.data.get('groups', [])}
        })
    
    return JsonResponse({
        'success': False,
        'error': result.message
    }, status=400)


# =============================================================================
# API VIEWS - Staff Management
# =============================================================================

@require_client_admin
@require_http_methods(["GET", "POST"])
def api_staff_list_create(request):
    """
    API: List client staff (GET) or Create new staff (POST).
    """
    if request.method == 'GET':
        result = ClientStaffService.list_staff(request.user)
        
        if result.success:
            return JsonResponse({
                'success': True,
                'data': {'staff': result.data.get('staff', [])}
            })
        
        return JsonResponse({
            'success': False,
            'error': result.message
        }, status=400 if 'Permission' not in result.message else 403)
    
    # POST - Create new staff
    content_type = request.content_type or ''
    if 'multipart/form-data' in content_type:
        data = request.POST.dict()
        # Parse JSON fields sent as strings
        if 'assigned_groups' in data:
            try:
                data['assigned_groups'] = json.loads(data['assigned_groups'])
            except (json.JSONDecodeError, TypeError):
                data['assigned_groups'] = []
        # Parse boolean strings
        for key in list(data.keys()):
            if data[key] in ('true', 'True'):
                data[key] = True
            elif data[key] in ('false', 'False'):
                data[key] = False
    else:
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({
                'success': False,
                'error': 'Invalid JSON data'
            }, status=400)
    
    result = ClientStaffService.create_staff(request.user, data)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'message': result.message,
            'data': {'staff_id': result.data.get('staff_id')}
        })
    
    status_code = 403 if 'Permission' in result.message else 400
    return JsonResponse({
        'success': False,
        'error': result.message
    }, status=status_code)


@require_client_admin
@require_http_methods(["GET", "PUT", "DELETE"])
def api_staff_detail(request, staff_id):
    """
    API: Get, Update, or Delete a specific staff member.
    """
    if request.method == 'GET':
        result = ClientStaffService.get_staff_detail(request.user, staff_id)
        
        if result.success:
            return JsonResponse({
                'success': True,
                'data': result.data
            })
        
        return JsonResponse({
            'success': False,
            'error': result.message
        }, status=404 if 'found' in result.message.lower() else 403)
    
    if request.method == 'PUT':
        content_type = request.content_type or ''
        if 'multipart/form-data' in content_type:
            # Django doesn't parse PUT multipart by default
            from django.http.multipartparser import MultiPartParser
            parser = MultiPartParser(request.META, request, request.upload_handlers)
            post_data, files = parser.parse()
            data = post_data.dict()
            # Parse JSON fields sent as strings
            if 'assigned_groups' in data:
                try:
                    data['assigned_groups'] = json.loads(data['assigned_groups'])
                except (json.JSONDecodeError, TypeError):
                    data['assigned_groups'] = []
            # Parse boolean strings
            for key in list(data.keys()):
                if data[key] in ('true', 'True'):
                    data[key] = True
                elif data[key] in ('false', 'False'):
                    data[key] = False
        else:
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                return JsonResponse({
                    'success': False,
                    'error': 'Invalid JSON data'
                }, status=400)
        
        result = ClientStaffService.update_staff(request.user, staff_id, data)
        
        if result.success:
            return JsonResponse({
                'success': True,
                'message': result.message
            })
        
        status_code = 403 if 'Permission' in result.message else 400
        return JsonResponse({
            'success': False,
            'error': result.message
        }, status=status_code)
    
    # DELETE
    result = ClientStaffService.delete_staff(request.user, staff_id)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'message': result.message
        })
    
    status_code = 403 if 'Permission' in result.message else 400
    return JsonResponse({
        'success': False,
        'error': result.message
    }, status=status_code)


@require_client_admin
@require_http_methods(["POST"])
def api_staff_toggle_status(request, staff_id):
    """
    API: Toggle staff member active/inactive status.
    """
    result = ClientStaffService.toggle_staff_status(request.user, staff_id)
    
    if result.success:
        is_active = result.data.get('is_active', False)
        return JsonResponse({
            'success': True,
            'message': result.message,
            'status': 'active' if is_active else 'inactive',
            'status_display': 'Active' if is_active else 'Inactive',
        })
    
    status_code = 403 if 'Permission' in result.message else 400
    return JsonResponse({
        'success': False,
        'message': result.message
    }, status=status_code)


@require_client_admin
@require_http_methods(["GET"])
def api_client_groups_list(request):
    """
    API: Get list of ID card groups for the current client.
    Used in staff drawer for group assignment.
    """
    from workflows.models import IDCardGroup
    
    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=400)
    
    groups = IDCardGroup.objects.filter(client=client, is_active=True).order_by('name')
    groups_data = [{'id': g.id, 'name': g.name} for g in groups]
    
    return JsonResponse({
        'success': True,
        'groups': groups_data
    })


# =============================================================================
# API VIEWS - Card Data
# =============================================================================

@require_client_user
@require_http_methods(["GET"])
def api_tables_list(request):
    """
    API: Get list of tables with card counts.
    """
    # Check permission (matches the groups page gate)
    if not PermissionService.has_permission(request.user, 'perm_idcard_setting_list'):
        return JsonResponse({
            'success': False,
            'message': 'Permission denied'
        }, status=403)

    result = ClientCardService.get_tables_for_client(request.user)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'tables': result.data.get('tables', [])
        })
    
    return JsonResponse({
        'success': False,
        'message': result.message
    }, status=400)


@require_client_user
@require_http_methods(["GET"])
def api_cards_list(request, table_id):
    """
    API: Get cards for a specific table.
    """
    status_filter = request.GET.get('status', '')
    search = request.GET.get('search', '')
    page = int(request.GET.get('page', 1))
    per_page = int(request.GET.get('per_page', 20))
    offset = (page - 1) * per_page
    
    result = ClientCardService.get_cards(
        request.user,
        table_id,
        status_filter if status_filter else None,
        offset,
        per_page,
        search if search else None
    )
    
    if result.success:
        # Calculate pagination info
        total = result.data.get('total', 0)
        total_pages = (total + per_page - 1) // per_page if total else 1
        
        return JsonResponse({
            'success': True,
            'data': {
                'cards': result.data.get('cards', []),
                'pagination': {
                    'page': page,
                    'per_page': per_page,
                    'total': total,
                    'total_pages': total_pages
                }
            }
        })
    
    status_code = 403 if 'Access' in result.message or 'permission' in result.message.lower() else 400
    return JsonResponse({
        'success': False,
        'error': result.message
    }, status=status_code)


@require_client_user
@require_http_methods(["GET"])
def api_card_detail(request, card_id):
    """
    API: Get details of a specific card.
    """
    result = ClientCardService.get_card_detail(request.user, card_id)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'data': result.data
        })
    
    status_code = 403 if 'Access' in result.message or 'permission' in result.message.lower() else 404
    return JsonResponse({
        'success': False,
        'error': result.message
    }, status=status_code)


@require_client_user
@require_http_methods(["POST"])
def api_card_change_status(request, card_id):
    """
    API: Change a card's status.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'message': 'Invalid JSON data'
        }, status=400)
    
    new_status = data.get('status', '')
    
    result = ClientCardService.change_card_status(request.user, card_id, new_status)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'message': result.message,
            **result.data
        })
    
    status_code = 403 if 'permission' in result.message.lower() or 'Access' in result.message else 400
    return JsonResponse({
        'success': False,
        'message': result.message
    }, status=status_code)


@require_client_user
@require_http_methods(["POST"])
def api_cards_bulk_status(request, table_id):
    """
    API: Change status for multiple cards.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'message': 'Invalid JSON data'
        }, status=400)
    
    card_ids = data.get('card_ids', [])
    new_status = data.get('status', '')
    
    result = ClientCardService.bulk_change_status(
        request.user,
        table_id,
        card_ids,
        new_status
    )
    
    if result.success:
        return JsonResponse({
            'success': True,
            'message': result.message,
            **result.data
        })
    
    status_code = 403 if 'permission' in result.message.lower() or 'Access' in result.message else 400
    return JsonResponse({
        'success': False,
        'message': result.message
    }, status=status_code)


# =============================================================================
# API VIEWS - Image Upload
# =============================================================================

@require_client_user
@require_http_methods(["POST"])
def api_upload_images(request, table_id):
    """
    API: Upload images and link to cards.
    """
    images = request.FILES.getlist('images')
    
    if not images:
        return JsonResponse({
            'success': False,
            'message': 'No images provided'
        }, status=400)
    
    result = ClientImageService.upload_images(request.user, table_id, images)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'message': result.message,
            **result.data
        })
    
    status_code = 403 if 'permission' in result.message.lower() or 'Access' in result.message else 400
    return JsonResponse({
        'success': False,
        'message': result.message
    }, status=status_code)


# =============================================================================
# SHARED PAGES — Render admin templates with client context
# =============================================================================

def _get_client_for_request(user):
    """Helper to get client profile for the logged-in client/client_staff user."""
    return ClientAccessService.get_client_for_user(user)


@require_client_user
def client_idcard_group(request):
    """
    ID Card Group page for clients — same template as admin idcard-group.html.
    Auto-detects client from user profile.
    """
    user = request.user
    client = _get_client_for_request(user)
    if not client:
        return redirect('/panel/client/dashboard/')
    
    # Require at least one list permission (matches sidebar visibility logic)
    LIST_PERMISSIONS = [
        'perm_idcard_setting_list', 'perm_idcard_pending_list',
        'perm_idcard_verified_list', 'perm_idcard_approved_list',
        'perm_idcard_download_list', 'perm_idcard_pool_list',
        'perm_idcard_reprint_list',
    ]
    if not any(PermissionService.has_permission(user, p) for p in LIST_PERMISSIONS):
        return redirect('/panel/client/dashboard/')
    
    # Get all tables for this client's groups with status counts
    tables = IDCardTable.objects.filter(group__client=client).select_related('group').annotate(
        pending_count=Count('id_cards', filter=Q(id_cards__status='pending')),
        verified_count=Count('id_cards', filter=Q(id_cards__status='verified')),
        pool_count=Count('id_cards', filter=Q(id_cards__status='pool')),
        approved_count=Count('id_cards', filter=Q(id_cards__status='approved')),
        download_count=Count('id_cards', filter=Q(id_cards__status='download')),
        reprint_count=Count('id_cards', filter=Q(id_cards__status='reprint')),
        total_cards=Count('id_cards')
    )
    
    context = {
        'active_page': 'idcard_group',
        'user_role': user.get_role_display(),
        'client': client,
        'tables': tables,
    }
    return render(request, 'idcard-group.html', context)


@require_client_user
def client_idcard_actions(request, table_id):
    """
    ID Card Actions page for clients — same template as admin idcard-actions.html.
    """
    user = request.user
    client = _get_client_for_request(user)
    if not client:
        return redirect('/panel/client/dashboard/')
    
    # Require at least one list permission to access this page
    LIST_PERMISSIONS = [
        'perm_idcard_pending_list', 'perm_idcard_verified_list',
        'perm_idcard_approved_list', 'perm_idcard_download_list',
        'perm_idcard_pool_list', 'perm_idcard_reprint_list',
    ]
    if not any(PermissionService.has_permission(user, p) for p in LIST_PERMISSIONS):
        return redirect('/panel/client/dashboard/')
    
    table = get_object_or_404(IDCardTable, id=table_id)
    
    # Verify ownership
    if not ClientAccessService.can_access_table(user, table):
        return redirect('/panel/client/idcard-group/')
    
    status_filter = request.GET.get('status', None)
    
    # Check status-specific list permission
    STATUS_LIST_PERM = {
        'pending': 'perm_idcard_pending_list',
        'verified': 'perm_idcard_verified_list',
        'approved': 'perm_idcard_approved_list',
        'download': 'perm_idcard_download_list',
        'pool': 'perm_idcard_pool_list',
        'reprint': 'perm_idcard_reprint_list',
    }
    if status_filter:
        required_perm = STATUS_LIST_PERM.get(status_filter)
        if required_perm and not PermissionService.has_permission(user, required_perm):
            return redirect('/panel/client/idcard-group/')
    
    INITIAL_LOAD_LIMIT = 100
    
    id_cards_query = IDCard.objects.filter(table=table).order_by('-id')
    if status_filter and status_filter in ['pending', 'verified', 'pool', 'approved', 'download', 'reprint']:
        id_cards_query = id_cards_query.filter(status=status_filter)
    
    total_count = id_cards_query.count()
    id_cards = id_cards_query[:INITIAL_LOAD_LIMIT]
    
    status_counts = IDCardService.get_status_counts(table)
    
    field_types = {field['name']: field['type'] for field in table.fields}
    
    enriched_cards = []
    for idx, card in enumerate(id_cards):
        ordered_fields = []
        field_data = card.field_data or {}
        field_data_normalized = {k.upper(): v for k, v in field_data.items()}
        
        for field in table.fields:
            field_name = field['name']
            field_type = field['type']
            field_value = field_data.get(field_name, '')
            if not field_value:
                field_value = field_data_normalized.get(field_name.upper(), '')
            ordered_fields.append({
                'name': field_name,
                'type': field_type,
                'value': field_value,
            })
        enriched_cards.append({
            'id': card.id,
            'sr_no': idx + 1,
            'photo': card.photo,
            'status': card.status,
            'get_status_display': card.get_status_display(),
            'updated_at': card.updated_at,
            'ordered_fields': ordered_fields,
        })
    
    context = {
        'active_page': 'idcard_group',
        'user_role': user.get_role_display(),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'id_cards': enriched_cards,
        'current_status': status_filter,
        'status_counts': status_counts,
        'total_count': total_count,
        'initial_load_limit': INITIAL_LOAD_LIMIT,
        'has_more': total_count > INITIAL_LOAD_LIMIT,
    }
    return render(request, 'idcard-actions.html', context)


@require_client_user
def client_group_settings(request):
    """
    Group Settings page for clients — same template as admin group-setting.html.
    """
    user = request.user
    client = _get_client_for_request(user)
    if not client:
        return redirect('/panel/client/dashboard/')
    
    # Check permission
    if not PermissionService.has_permission(user, 'perm_idcard_setting_list'):
        return redirect('/panel/client/dashboard/')
    
    # Get the first group for client, or create one if none exists
    group = IDCardGroup.objects.filter(client=client).first()
    if not group:
        group = IDCardGroup.objects.create(
            client=client,
            name=f"{client.name} - Default Group",
            is_active=True
        )
    tables = IDCardTable.objects.filter(group=group).annotate(
        total_cards=Count('id_cards')
    )
    
    context = {
        'active_page': 'group_settings',
        'user_role': user.get_role_display(),
        'client': client,
        'group': group,
        'tables': tables,
    }
    return render(request, 'group-setting.html', context)


@require_client_user
def client_reprint_cards(request, table_id):
    """
    Reprint Cards page for clients — same template as admin reprint-cards.html.
    """
    from workflows.models import ReprintRequest
    
    user = request.user
    client = _get_client_for_request(user)
    if not client:
        return redirect('/panel/client/dashboard/')
    
    table = get_object_or_404(IDCardTable, id=table_id)
    
    # Verify ownership
    if not ClientAccessService.can_access_table(user, table):
        return redirect('/panel/client/idcard-group/')
    
    # Check perm_idcard_reprint_list permission
    if not PermissionService.has_permission(user, 'perm_idcard_reprint_list'):
        return redirect('/panel/client/idcard-group/')
    
    current_step = request.GET.get('step', 'requests')
    if current_step not in ('requests', 'confirm', 'download'):
        current_step = 'requests'
    
    step_counts = {
        'requests': ReprintRequest.objects.filter(table=table, status='requested').count(),
        'confirm': ReprintRequest.objects.filter(table=table, status='confirmed').count(),
        'download': ReprintRequest.objects.filter(table=table, status='downloaded').count(),
    }
    
    INITIAL_LOAD_LIMIT = 100
    id_cards = []
    total_count = 0
    existing_reprint_ids = set()
    
    if current_step == 'requests':
        cards_qs = IDCard.objects.filter(table=table).order_by('-id')
        total_count = cards_qs.count()
        cards_batch = cards_qs[:INITIAL_LOAD_LIMIT]
        
        existing_reprint_ids = set(
            ReprintRequest.objects.filter(
                table=table,
                status__in=['requested', 'confirmed'],
            ).values_list('card_id', flat=True)
        )
        
        for idx, card in enumerate(cards_batch):
            fd = card.field_data or {}
            fd_upper = {k.upper(): v for k, v in fd.items()}
            ordered_fields = []
            for field in table.fields:
                fname = field['name']
                ftype = field.get('type', 'text')
                fval = fd.get(fname, '') or fd_upper.get(fname.upper(), '')
                ordered_fields.append({'name': fname, 'type': ftype, 'value': fval})
            id_cards.append({
                'id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'get_status_display': card.get_status_display(),
                'has_reprint': card.id in existing_reprint_ids,
                'ordered_fields': ordered_fields,
                'updated_at': card.updated_at,
            })
    
    reprint_items = []
    reprint_total = 0
    
    if current_step == 'confirm':
        rr_qs = ReprintRequest.objects.filter(
            table=table, status='requested'
        ).select_related('card', 'requested_by').order_by('-created_at')
        reprint_total = rr_qs.count()
        rr_batch = rr_qs[:INITIAL_LOAD_LIMIT]
        
        for idx, rr in enumerate(rr_batch):
            card = rr.card
            fd = card.field_data or {}
            fd_upper = {k.upper(): v for k, v in fd.items()}
            ordered_fields = []
            for field in table.fields:
                fname = field['name']
                ftype = field.get('type', 'text')
                fval = fd.get(fname, '') or fd_upper.get(fname.upper(), '')
                ordered_fields.append({'name': fname, 'type': ftype, 'value': fval})
            req_by = rr.requested_by
            reprint_items.append({
                'rr_id': rr.id,
                'card_id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'get_status_display': card.get_status_display(),
                'reason': rr.reason,
                'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
                'requested_at': rr.created_at,
                'ordered_fields': ordered_fields,
                'updated_at': card.updated_at,
            })
    
    download_items = []
    download_total = 0
    
    if current_step == 'download':
        dl_qs = ReprintRequest.objects.filter(
            table=table, status='confirmed'
        ).select_related('card', 'requested_by').order_by('-updated_at')
        download_total = dl_qs.count()
        dl_batch = dl_qs[:INITIAL_LOAD_LIMIT]
        
        for idx, rr in enumerate(dl_batch):
            card = rr.card
            fd = card.field_data or {}
            fd_upper = {k.upper(): v for k, v in fd.items()}
            ordered_fields = []
            for field in table.fields:
                fname = field['name']
                ftype = field.get('type', 'text')
                fval = fd.get(fname, '') or fd_upper.get(fname.upper(), '')
                ordered_fields.append({'name': fname, 'type': ftype, 'value': fval})
            req_by = rr.requested_by
            download_items.append({
                'rr_id': rr.id,
                'card_id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'get_status_display': card.get_status_display(),
                'reason': rr.reason,
                'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
                'confirmed_at': rr.updated_at,
                'ordered_fields': ordered_fields,
                'updated_at': card.updated_at,
            })
    
    context = {
        'active_page': 'idcard_group',
        'user_role': user.get_role_display(),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'current_step': current_step,
        'step_counts': step_counts,
        'id_cards': id_cards,
        'total_count': total_count,
        'initial_load_limit': INITIAL_LOAD_LIMIT,
        'has_more': total_count > INITIAL_LOAD_LIMIT,
        'reprint_items': reprint_items,
        'reprint_total': reprint_total,
        'reprint_has_more': reprint_total > INITIAL_LOAD_LIMIT,
        'download_items': download_items,
        'download_total': download_total,
        'download_has_more': download_total > INITIAL_LOAD_LIMIT,
    }
    return render(request, 'reprint-cards.html', context)
