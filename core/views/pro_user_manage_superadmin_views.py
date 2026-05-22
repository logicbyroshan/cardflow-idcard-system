"""Manage Superadmin Pro Features - Pro users can grant pro features to admins/superadmins"""

from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.core.paginator import Paginator

from staff.models import Staff
from core.services.permission_service import PermissionService
from core.views.base import get_user_role, get_page_range
from core.utils.htmx import is_htmx
from core.views.admin_page_views import _apply_drawer_embed_frame_headers


@login_required
def manage_superadmin_pro_features(request):
    """View to manage pro features for admin/superadmin users - Pro User only"""
    
    # Only Pro User can access this pro-feature hub.
    if not PermissionService.is_pro_user(request.user):
        return redirect('dashboard')
    
    DEFAULT_PER_PAGE = 25
    PER_PAGE_OPTIONS = [5, 10, 25, 50, 100]
    
    try:
        per_page = int(request.GET.get('per_page', DEFAULT_PER_PAGE))
        if per_page not in PER_PAGE_OPTIONS:
            per_page = DEFAULT_PER_PAGE
    except (ValueError, TypeError):
        per_page = DEFAULT_PER_PAGE
    
    search_query = request.GET.get('search', '').strip()
    status_filter = request.GET.get('status', '').strip()
    
    # Get all admin_staff and superadmin users (not client_staff)
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
    elif status_filter == 'has_pro_features':
        staff_qs = staff_qs.filter(
            Q(perm_pro_user_options=True) |
            Q(perm_pro_log_deletion_guard=True) |
            Q(perm_pro_data_deletion_guard=True)
        )
    
    paginator = Paginator(staff_qs, per_page)
    page_obj = paginator.get_page(request.GET.get('page', 1))
    
    context = {
        'active_page': 'manage_superadmin_pro_features',
        'pro_tab': 'manage_superadmin',
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
        response = render(request, 'partials/pro_user/manage-superadmin-table.html', context)
        return _apply_drawer_embed_frame_headers(request, response)
    
    response = render(request, 'pro_user/manage-superadmin-pro-features.html', context)
    return _apply_drawer_embed_frame_headers(request, response)


@login_required
@require_http_methods(["POST"])
def api_toggle_admin_pro_feature(request, staff_id, feature_name):
    """API to toggle pro features for an admin/superadmin - Pro User only"""
    
    if not PermissionService.is_pro_user(request.user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    
    try:
        staff = get_object_or_404(Staff, id=staff_id, staff_type='admin_staff')
        user = staff.user
        
        # Validate feature name
        VALID_FEATURES = ['user_options', 'log_deletion_guard', 'data_deletion_guard']
        if feature_name not in VALID_FEATURES:
            return JsonResponse({'success': False, 'message': 'Invalid feature'}, status=400)
        
        # Map feature names to Staff model fields
        feature_field_map = {
            'user_options': 'perm_pro_user_options',
            'log_deletion_guard': 'perm_pro_log_deletion_guard',
            'data_deletion_guard': 'perm_pro_data_deletion_guard',
        }
        
        field_name = feature_field_map[feature_name]
        current_value = getattr(staff, field_name)
        new_value = not current_value
        
        setattr(staff, field_name, new_value)
        staff.save(update_fields=[field_name])
        
        return JsonResponse({
            'success': True,
            'message': f'Pro feature {"enabled" if new_value else "disabled"}',
            'feature': feature_name,
            'enabled': new_value,
            'staff_id': staff_id,
            'staff_name': user.get_full_name() or user.username or user.email,
        })
    
    except Staff.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Admin not found'}, status=404)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def api_grant_all_admin_pro_features(request, staff_id):
    """API to grant all pro features to an admin - Pro User only"""
    
    if not PermissionService.is_pro_user(request.user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    
    try:
        staff = get_object_or_404(Staff, id=staff_id, staff_type='admin_staff')
        
        staff.perm_pro_user_options = True
        staff.perm_pro_log_deletion_guard = True
        staff.perm_pro_data_deletion_guard = True
        staff.save(update_fields=[
            'perm_pro_user_options',
            'perm_pro_log_deletion_guard',
            'perm_pro_data_deletion_guard'
        ])
        
        return JsonResponse({
            'success': True,
            'message': 'All pro features granted',
            'staff_id': staff_id,
            'staff_name': staff.user.get_full_name() or staff.user.username or staff.user.email,
        })
    
    except Staff.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Admin not found'}, status=404)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def api_revoke_all_admin_pro_features(request, staff_id):
    """API to revoke all pro features from an admin - Pro User only"""
    
    if not PermissionService.is_pro_user(request.user):
        return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    
    try:
        staff = get_object_or_404(Staff, id=staff_id, staff_type='admin_staff')
        
        staff.perm_pro_user_options = False
        staff.perm_pro_log_deletion_guard = False
        staff.perm_pro_data_deletion_guard = False
        staff.save(update_fields=[
            'perm_pro_user_options',
            'perm_pro_log_deletion_guard',
            'perm_pro_data_deletion_guard'
        ])
        
        return JsonResponse({
            'success': True,
            'message': 'All pro features revoked',
            'staff_id': staff_id,
            'staff_name': staff.user.get_full_name() or staff.user.username or staff.user.email,
        })
    
    except Staff.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Admin not found'}, status=404)
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=500)
