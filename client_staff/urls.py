"""
Client Staff URL Configuration

URLs for client staff management:
- Staff CRUD operations (Client Admin only)
- Permission management
- Permission-protected action endpoints
"""
from django.urls import path
from . import views

app_name = 'client_staff'

urlpatterns = [
    # ==========================================================================
    # PAGE VIEWS
    # ==========================================================================
    
    # Staff management page (Client Admin only)
    path('manage/', views.staff_management_page, name='manage'),
    
    # ==========================================================================
    # API - Staff CRUD (Client Admin only)
    # ==========================================================================
    
    # List staff (GET) / Create staff (POST)
    path('api/staff/', views.api_staff_list_create, name='api_staff_list'),
    
    # Get/Update/Delete specific staff
    path('api/staff/<int:staff_id>/', views.api_staff_detail, name='api_staff_detail'),
    
    # Toggle staff status
    path('api/staff/<int:staff_id>/toggle-status/', views.api_staff_toggle_status, name='api_staff_toggle'),
    
    # Reset staff password
    path('api/staff/<int:staff_id>/reset-password/', views.api_staff_reset_password, name='api_staff_reset_password'),
    
    # ==========================================================================
    # API - Permission Management (Client Admin only)
    # ==========================================================================
    
    # Get available permissions
    path('api/permissions/', views.api_available_permissions, name='api_permissions'),
    
    # Update staff permissions
    path('api/staff/<int:staff_id>/permissions/', views.api_staff_permissions, name='api_staff_permissions'),
    
    # ==========================================================================
    # API - Current User
    # ==========================================================================
    
    # Get current user's permissions (for any logged-in user)
    path('api/my-permissions/', views.api_my_permissions, name='api_my_permissions'),
    
    # ==========================================================================
    # API - Permission-Protected Action Endpoints
    # ==========================================================================
    
    # These endpoints demonstrate permission enforcement
    # In practice, these would be in the appropriate app (client, core, etc.)
    
    path('api/actions/upload-data/', views.api_upload_data, name='api_upload_data'),
    path('api/actions/verify-data/', views.api_verify_data, name='api_verify_data'),
    path('api/actions/upload-images/', views.api_upload_images, name='api_upload_images'),
    path('api/actions/workflow/', views.api_view_workflow, name='api_view_workflow'),
]
