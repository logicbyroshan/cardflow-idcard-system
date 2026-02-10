"""
Staff app URL configuration

Routes for Admin Staff management by Super Admin.
"""
from django.urls import path

from .views import (
    # Page views
    staff_management_page,
    staff_dashboard,
    
    # Admin Staff CRUD API
    api_admin_staff_list_create,
    api_admin_staff_detail,
    api_admin_staff_toggle_status,
    api_admin_staff_reset_password,
    
    # Permission & Client listing API
    api_available_permissions,
    api_available_clients,
    
    # Self-service API (for admin staff)
    api_my_permissions,
    api_my_clients,
    
    # Client-scoped data examples
    api_scoped_clients,
    api_client_idcard_groups,
)

app_name = 'staff'

urlpatterns = [
    # ==========================================================================
    # PAGE VIEWS
    # ==========================================================================
    path('manage/', staff_management_page, name='manage'),
    path('dashboard/', staff_dashboard, name='dashboard'),
    
    # ==========================================================================
    # ADMIN STAFF CRUD API (Super Admin only)
    # ==========================================================================
    path('api/admin-staff/', api_admin_staff_list_create, name='api_admin_staff_list_create'),
    path('api/admin-staff/<int:staff_id>/', api_admin_staff_detail, name='api_admin_staff_detail'),
    path('api/admin-staff/<int:staff_id>/toggle-status/', api_admin_staff_toggle_status, name='api_admin_staff_toggle_status'),
    path('api/admin-staff/<int:staff_id>/reset-password/', api_admin_staff_reset_password, name='api_admin_staff_reset_password'),
    
    # ==========================================================================
    # PERMISSION & CLIENT LISTING API (Super Admin only)
    # ==========================================================================
    path('api/permissions/available/', api_available_permissions, name='api_available_permissions'),
    path('api/clients/available/', api_available_clients, name='api_available_clients'),
    
    # ==========================================================================
    # SELF-SERVICE API (Admin Staff)
    # ==========================================================================
    path('api/my/permissions/', api_my_permissions, name='api_my_permissions'),
    path('api/my/clients/', api_my_clients, name='api_my_clients'),
    
    # ==========================================================================
    # CLIENT-SCOPED DATA EXAMPLES
    # ==========================================================================
    path('api/clients/', api_scoped_clients, name='api_scoped_clients'),
    path('api/clients/<int:client_id>/idcard-groups/', api_client_idcard_groups, name='api_client_idcard_groups'),
]
