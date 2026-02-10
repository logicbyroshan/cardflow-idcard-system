"""
Base views - Helper functions and Page views
Contains: Dashboard, Staff Management, Client Management pages, etc.
"""
from functools import wraps
import json
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q
from ..models import Client, Staff, IDCardGroup, IDCard, IDCardTable, ReprintRequest, User, SystemSettings
from ..services import IDCardService
from ..services.activity_service import ActivityService
from ..services.permission_service import (
    PermissionService,
    require_any_admin,
    api_require_any_admin,
    api_require_any_authenticated,
)

def get_user_role(user):
    """Helper function to get user role display name"""
    return user.get_role_display()


def is_super_admin_user(user):
    """
    Check if user has super admin privileges.
    Accepts EITHER:
    - Django's is_superuser=True (admin panel access)
    - Business role='super_admin' (custom role field)
    This ensures backward compatibility and prevents lockouts.
    """
    return user.is_superuser or user.role == 'super_admin'


def super_admin_required(view_func):
    """Decorator to ensure only super_admin can access the view"""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect('login')
        if not is_super_admin_user(request.user):
            # Redirect to appropriate dashboard
            if request.user.role == 'admin_staff':
                return redirect('admin_staff_dashboard')
            elif request.user.role == 'client':
                return redirect('client_dashboard')
            elif request.user.role == 'client_staff':
                return redirect('client_staff_dashboard')
            return redirect('login')
        return view_func(request, *args, **kwargs)
    return wrapper


def api_login_required(view_func):
    """Decorator to ensure API endpoints require authentication"""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({
                'success': False,
                'message': 'Authentication required',
                'redirect': '/panel/login/'
            }, status=401)
        return view_func(request, *args, **kwargs)
    return wrapper


def api_super_admin_required(view_func):
    """Decorator to ensure API endpoints require super_admin role"""
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({
                'success': False,
                'message': 'Authentication required',
                'redirect': '/panel/login/'
            }, status=401)
        if not is_super_admin_user(request.user):
            return JsonResponse({
                'success': False,
                'message': 'Access denied. Super Admin privileges required.'
            }, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper


# Dashboard
@login_required
@require_any_admin
def dashboard(request):
    """Main dashboard view - Super Admin & Admin Staff"""
    # Combine card status counts into a single aggregate query
    card_stats = IDCard.objects.aggregate(
        total=Count('id'),
        pending=Count('id', filter=Q(status='pending')),
        verified=Count('id', filter=Q(status='verified')),
        approved=Count('id', filter=Q(status='approved')),
        downloaded=Count('id', filter=Q(status='download')),
    )
    context = {
        'active_page': 'dashboard',
        'user_role': get_user_role(request.user),
        'total_id_cards': card_stats['total'],
        'pending_cards': card_stats['pending'],
        'verified_cards': card_stats['verified'],
        'approved_cards': card_stats['approved'],
        'downloaded_cards': card_stats['downloaded'],
    }
    # Consolidate count queries with aggregate (6→3 queries)
    client_stats = Client.objects.aggregate(
        total=Count('id'),
        active=Count('id', filter=Q(status='active')),
    )
    staff_stats = Staff.objects.aggregate(
        total=Count('id'),
        active=Count('id', filter=Q(user__is_active=True)),
    )
    cs_stats = User.objects.filter(role='client_staff').aggregate(
        total=Count('id'),
        active=Count('id', filter=Q(is_active=True)),
    )
    context.update({
        'total_clients': client_stats['total'],
        'active_clients': client_stats['active'],
        'total_staff': staff_stats['total'],
        'active_staff': staff_stats['active'],
        'client_staff_count': cs_stats['total'],
        'active_client_staff_count': cs_stats['active'],
        'recent_activities': ActivityService.get_recent(limit=10),
    })
    return render(request, 'index.html', context)


@csrf_exempt
@require_http_methods(["GET"])
@api_require_any_admin
def api_recent_client_updates(request):
    """API endpoint to get recent clients with their ID card status counts"""
    try:
        limit = int(request.GET.get('limit', 5))
        user = request.user
        
        # Get recent active clients - scoped by user role
        if PermissionService.is_super_admin(user):
            clients = Client.objects.filter(status='active').order_by('-updated_at')[:limit]
        else:
            # Admin staff sees only their assigned clients
            staff_profile = getattr(user, 'staff_profile', None)
            if staff_profile and staff_profile.staff_type == 'admin_staff':
                clients = staff_profile.assigned_clients.filter(status='active').order_by('-updated_at')[:limit]
            else:
                clients = Client.objects.none()
        
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
        
        for client in clients:
            cc = counts_map.get(client.id, {})
            results.append({
                'id': client.id,
                'name': client.name,
                'initial': client.name[0].upper() if client.name else 'C',
                'first_table_id': first_table_map.get(client.id),
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
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)


@csrf_exempt
@require_http_methods(["GET"])
@api_require_any_admin
def api_recent_activity(request):
    """API endpoint for the Recent Activity feed on the dashboard."""
    try:
        limit = int(request.GET.get('limit', 10))
        limit = min(limit, 50)  # Cap at 50
        activities = ActivityService.get_recent(limit=limit)
        return JsonResponse({'success': True, 'activities': activities})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
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
        ).filter(
            field_data__icontains=query
        )
        
        # Scope by role
        is_client_role = user.role in ('client', 'client_staff')
        if PermissionService.is_super_admin(user):
            pass  # super_admin sees all
        elif user.role in ('client', 'client_staff'):
            # Client users only see their own client's cards
            from client.services import ClientAccessService
            client = ClientAccessService.get_client_for_user(user)
            if client:
                base_cards = base_cards.filter(table__group__client=client)
            else:
                base_cards = base_cards.none()
        else:
            # Admin staff sees only assigned clients
            staff_profile = getattr(user, 'staff_profile', None)
            if staff_profile and staff_profile.staff_type == 'admin_staff':
                assigned_client_ids = staff_profile.assigned_clients.values_list('id', flat=True)
                base_cards = base_cards.filter(table__group__client_id__in=assigned_client_ids)
            else:
                base_cards = base_cards.none()
        
        cards = base_cards[:100]  # Limit at database level for speed
        
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
            
            results.append({
                'type': 'idcard',
                'id': card.id,
                'title': display_name or f'Card #{card.id}',
                'subtitle': f'{client_name} • {table_name} • {card.get_status_display()}',
                'matched_field': matched_field or 'Field',
                'matched_value': matched_value or query,
                'url': (f'/panel/client/table/{card.table.id}/actions/?status={card.status}&highlight={card.id}'
                        if is_client_role else
                        f'/panel/table/{card.table.id}/cards/?status={card.status}&highlight={card.id}') if card.table else '#',
                'icon': 'fa-id-card',
                'status': card.status,
                'photo': (card.field_data or {}).get('PHOTO') or (card.photo.url if card.photo else None)
            })
            
            # Stop after 50 results for speed
            if len(results) >= 50:
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
        return JsonResponse({'success': False, 'message': str(e)}, status=400)


# Staff Management
@super_admin_required
def manage_staff(request):
    """View to manage admin staff"""
    staff_list = Staff.objects.filter(staff_type='admin_staff').select_related('user')
    context = {
        'active_page': 'manage_staff',
        'user_role': get_user_role(request.user),
        'staff_list': staff_list,
    }
    return render(request, 'manage-staff.html', context)


# Client Management
@login_required
@require_any_admin
def manage_clients(request):
    """View to manage all clients - Super Admin sees all, Admin Staff sees assigned only"""
    user = request.user
    if PermissionService.is_super_admin(user):
        clients = Client.objects.all().select_related('user')
    else:
        # Admin staff sees only their assigned clients
        staff_profile = getattr(user, 'staff_profile', None)
        if staff_profile and staff_profile.staff_type == 'admin_staff':
            clients = staff_profile.assigned_clients.all().select_related('user')
        else:
            clients = Client.objects.none()
    context = {
        'active_page': 'manage_clients',
        'user_role': get_user_role(request.user),
        'clients': clients,
    }
    return render(request, 'manage-client.html', context)


# Active Clients (ID Card Management)
@login_required
@require_any_admin
def active_clients(request):
    """View active clients for ID card management - Super Admin and Admin Staff"""
    user = request.user
    
    # Super admin sees all active clients
    if PermissionService.is_super_admin(user):
        clients = Client.objects.filter(status='active').select_related('user')
    else:
        # Admin staff sees only their assigned clients
        staff_profile = getattr(user, 'staff_profile', None)
        if staff_profile and staff_profile.staff_type == 'admin_staff':
            clients = staff_profile.assigned_clients.filter(status='active').select_related('user')
        else:
            clients = Client.objects.none()
    
    context = {
        'active_page': 'active_clients',
        'user_role': get_user_role(request.user),
        'clients': clients,
    }
    return render(request, 'active-client.html', context)


# ID Card Group
@login_required
@require_any_admin
def idcard_group(request, client_id):
    """View ID card groups/tables for a specific client with status counts"""
    client = get_object_or_404(Client, id=client_id)
    
    # Check if admin staff has access to this client
    user = request.user
    if not PermissionService.is_super_admin(user):
        staff_profile = getattr(user, 'staff_profile', None)
        if staff_profile and staff_profile.staff_type == 'admin_staff':
            if not staff_profile.assigned_clients.filter(id=client_id).exists():
                return redirect('active_clients')  # No access to this client
        else:
            return redirect('login')
    
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
        'active_page': 'active_clients',
        'user_role': get_user_role(request.user),
        'client': client,
        'tables': tables,
    }
    return render(request, 'idcard-group.html', context)


# ID Card Actions
@login_required
@require_any_admin
def idcard_actions(request, table_id):
    """View and manage ID cards in a table, optionally filtered by status"""
    table = get_object_or_404(IDCardTable, id=table_id)
    
    # Check if admin staff has access to this table's client
    user = request.user
    if not PermissionService.is_super_admin(user):
        staff_profile = getattr(user, 'staff_profile', None)
        if staff_profile and staff_profile.staff_type == 'admin_staff':
            client_id = table.group.client_id
            if not staff_profile.assigned_clients.filter(id=client_id).exists():
                return redirect('active_clients')  # No access to this client's table
        else:
            return redirect('login')
    
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
            return redirect('active_clients')  # No permission for this status list
    
    # Initial load limit for lazy loading (first 100 records)
    INITIAL_LOAD_LIMIT = 100
    
    # Order by id descending so newest records appear first
    id_cards_query = IDCard.objects.filter(table=table).order_by('-id')
    if status_filter and status_filter in ['pending', 'verified', 'pool', 'approved', 'download', 'reprint']:
        id_cards_query = id_cards_query.filter(status=status_filter)
    
    # Get total count for this status
    total_count = id_cards_query.count()
    
    # Only load first batch for initial page render
    id_cards = id_cards_query[:INITIAL_LOAD_LIMIT]
    
    # Get counts for all statuses (single aggregate query)
    status_counts = IDCardService.get_status_counts(table)
    
    # Create a field type lookup from table.fields
    field_types = {field['name']: field['type'] for field in table.fields}
    
    # Enrich each card with ordered field values matching table.fields
    enriched_cards = []
    for idx, card in enumerate(id_cards):
        ordered_fields = []
        field_data = card.field_data or {}
        
        # Create case-insensitive lookup for field_data
        # This handles cases where table fields might have different case than stored data
        field_data_normalized = {}
        for key, value in field_data.items():
            # Store with uppercase key for case-insensitive lookup
            field_data_normalized[key.upper()] = value
        
        for field in table.fields:
            field_name = field['name']
            field_type = field['type']
            # Try exact match first, then case-insensitive match
            field_value = field_data.get(field_name, '')
            if not field_value:
                # Try case-insensitive lookup
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
        'active_page': 'active_clients',
        'user_role': get_user_role(request.user),
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


# Group Settings
@login_required
@require_any_admin
def group_settings(request, client_id):
    """Settings for a specific client - manage their groups and tables"""
    client = get_object_or_404(Client, id=client_id)
    # Check if admin staff has access to this client
    user = request.user
    if not PermissionService.is_super_admin(user):
        staff_profile = getattr(user, 'staff_profile', None)
        if staff_profile and staff_profile.staff_type == 'admin_staff':
            if not staff_profile.assigned_clients.filter(id=client_id).exists():
                return redirect('active_clients')
        else:
            return redirect('login')
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
        'active_page': 'active_clients',
        'user_role': get_user_role(request.user),
        'client': client,
        'group': group,
        'tables': tables,
    }
    return render(request, 'group-setting.html', context)


# Website Management → redirect to new website admin dashboard
@super_admin_required
def manage_website(request):
    """Redirect legacy manage-website URL to new website admin dashboard."""
    from django.shortcuts import redirect
    return redirect('/panel/website/')


# Reprint Cards
@login_required
@require_any_admin
def reprint_cards(request, table_id):
    """Reprint ID Cards page — 3-step workflow: Requests → Confirm → Download"""
    table = get_object_or_404(IDCardTable, id=table_id)

    # Check access for admin staff
    user = request.user
    if not PermissionService.is_super_admin(user):
        staff_profile = getattr(user, 'staff_profile', None)
        if staff_profile and staff_profile.staff_type == 'admin_staff':
            client_id = table.group.client_id
            if not staff_profile.assigned_clients.filter(id=client_id).exists():
                return redirect('active_clients')
        else:
            return redirect('login')

    # Check perm_idcard_reprint_list permission
    if not PermissionService.has_permission(user, 'perm_idcard_reprint_list'):
        return redirect('active_clients')  # No permission for reprint list

    current_step = request.GET.get('step', 'requests')
    if current_step not in ('requests', 'confirm', 'download'):
        current_step = 'requests'

    # Real step counts from ReprintRequest table
    step_counts = {
        'requests': ReprintRequest.objects.filter(table=table, status='requested').count(),
        'confirm': ReprintRequest.objects.filter(table=table, status='confirmed').count(),
        'download': ReprintRequest.objects.filter(table=table, status='downloaded').count(),
    }

    # For step 1 (Requests): load initial cards from the table for browsing
    INITIAL_LOAD_LIMIT = 100
    id_cards = []
    total_count = 0
    existing_reprint_ids = set()

    if current_step == 'requests':
        cards_qs = IDCard.objects.filter(table=table).order_by('-id')
        total_count = cards_qs.count()
        cards_batch = cards_qs[:INITIAL_LOAD_LIMIT]

        # Track which cards already have a pending reprint
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

    # For step 2 (Confirm): load reprint requests with status='requested'
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

    # For step 3 (Download): load confirmed reprint requests
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
        'active_page': 'active_clients',
        'user_role': get_user_role(request.user),
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
@require_http_methods(['GET'])
def api_export_settings_get(request):
    """GET /api/export-settings/ — fetch export footer messages."""
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
    for key in SystemSettings.EXPORT_DEFAULTS:
        if key in body:
            SystemSettings.set_value(key, body[key].strip())
            updated.append(key)

    if not updated:
        return JsonResponse({'success': False, 'message': 'No valid fields provided'}, status=400)

    return JsonResponse({'success': True, 'message': 'Export settings updated successfully', 'updated': updated})
