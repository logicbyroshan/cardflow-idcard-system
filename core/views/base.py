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
from django.conf import settings as django_settings
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q
from ..models import Client, Staff, IDCardGroup, IDCard, IDCardTable, ReprintRequest, User, SystemSettings
from ..services import IDCardService
from ..services.activity_service import ActivityService
from ..services.permission_service import (
    PermissionService,
    require_any_admin,
    require_super_admin as _require_super_admin,
    api_require_any_admin,
    api_require_any_authenticated,
    api_require_super_admin as _api_require_super_admin,
)

def get_user_role(user):
    """Helper function to get user role display name"""
    return user.get_role_display()


def super_admin_required(view_func):
    """
    Deprecated — delegates to require_super_admin from permission_service.
    Kept for backward-compatible imports.
    """
    return _require_super_admin(view_func)


# Dashboard
@login_required
@require_any_admin
def dashboard(request):
    """Main dashboard view - Super Admin & Admin Staff"""
    # Combine card status counts into a single aggregate query
    # Exclude 'pool' status from total count
    card_stats = IDCard.objects.aggregate(
        total=Count('id', filter=Q(status__in=['pending', 'verified', 'approved', 'download'])),
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
        # Role-based activity filtering - admin_staff gets filtered by assigned clients
        'recent_activities': ActivityService.get_recent(limit=8, user=request.user),
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
        clients = PermissionService.get_accessible_clients(
            user, Client.objects.filter(status='active')
        ).order_by('-updated_at')[:limit]
        
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


@require_http_methods(["GET"])
@api_require_any_admin
def api_recent_activity(request):
    """API endpoint for the Recent Activity feed on the dashboard."""
    try:
        limit = int(request.GET.get('limit', 8))
        limit = min(limit, 8)  # Cap at 8 for 24hr feed
        # Role-based activity filtering
        activities = ActivityService.get_recent(limit=limit, user=request.user)
        return JsonResponse({'success': True, 'activities': activities})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


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
    clients = PermissionService.get_accessible_clients(
        user, Client.objects.all().select_related('user')
    )
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
    
    # Scoped by PermissionService
    clients = PermissionService.get_accessible_clients(
        user, Client.objects.filter(status='active').select_related('user')
    )
    
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
    
    # Check if user has access to this client
    user = request.user
    if not PermissionService.can_access_client(user, client_id):
        return redirect('active_clients')
    
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
    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)
    
    # Check if user has access to this table's client
    user = request.user
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('active_clients')
    
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
    # Check if user has access to this client
    user = request.user
    if not PermissionService.can_access_client(user, client_id):
        return redirect('active_clients')
    # Get the first group for client, or create one if none exists
    group = IDCardService.ensure_default_group(client)
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


# Manage Panel (Coming Soon)
@super_admin_required
def manage_panel(request):
    """Manage Panel page - Coming Soon."""
    context = {
        'is_super_admin': True,
        'active_page': 'manage_panel',
    }
    return render(request, 'manage-panel.html', context)


# Reprint Cards
@login_required
@require_any_admin
def reprint_cards(request, table_id):
    """Reprint ID Cards page — 3-step workflow: Requests → Confirm → Download"""
    table = get_object_or_404(IDCardTable.objects.select_related('group__client'), id=table_id)

    # Check access for user
    user = request.user
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('active_clients')

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


# =============================================================================
# HEALTH / VERSION ENDPOINT (auth-protected)
# =============================================================================

@login_required
@require_any_admin
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
        card = get_object_or_404(IDCard, id=card_id)
    except Exception:
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
            card = get_object_or_404(IDCard, id=int(card_id))
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
