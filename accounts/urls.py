"""
Accounts URL Configuration

URL patterns for authentication, password reset, and dashboards.
"""
from django.urls import path
from . import views

app_name = 'accounts'

urlpatterns = [
    # ==========================================================================
    # PAGE VIEWS (Template-based)
    # ==========================================================================
    
    # Login page (multi-step: role selection → email → password)
    path('login/', views.LoginPageView.as_view(), name='login'),
    
    # Logout
    path('logout/', views.LogoutView.as_view(), name='logout'),
    
    # Redirect to appropriate dashboard
    path('dashboard/', views.redirect_to_dashboard, name='dashboard_redirect'),
    
    # ==========================================================================
    # DASHBOARD VIEWS
    # ==========================================================================
    
    # Super Admin Dashboard
    path('dashboard/owner/', views.OwnerDashboardView.as_view(), name='dashboard_owner'),
    
    # Admin Staff Dashboard
    path('dashboard/staff/', views.StaffDashboardView.as_view(), name='dashboard_staff'),
    
    # Client Dashboard
    path('dashboard/client-admin/', views.ClientAdminDashboardView.as_view(), name='dashboard_client_admin'),
    
    # Client Staff Dashboard
    path('dashboard/client-staff/', views.ClientStaffDashboardView.as_view(), name='dashboard_client_staff'),
    
    # ==========================================================================
    # API ENDPOINTS (JSON responses for AJAX)
    # ==========================================================================
    
    # Check if email exists
    path('api/auth/check-email/', views.CheckEmailAPIView.as_view(), name='api_check_email'),
    
    # Login
    path('api/auth/login/', views.LoginAPIView.as_view(), name='api_login'),
    
    # Forgot password (send OTP)
    path('api/auth/forgot-password/', views.ForgotPasswordAPIView.as_view(), name='api_forgot_password'),
    
    # Verify OTP
    path('api/auth/verify-otp/', views.VerifyOTPAPIView.as_view(), name='api_verify_otp'),
    
    # Reset password
    path('api/auth/reset-password/', views.ResetPasswordAPIView.as_view(), name='api_reset_password'),
    
    # ==========================================================================
    # UTILITY ENDPOINTS
    # ==========================================================================
    
    # Setup groups (one-time setup, superuser only)
    path('setup-groups/', views.setup_groups_view, name='setup_groups'),
]
