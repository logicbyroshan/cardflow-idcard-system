"""
Authentication Views - BACKWARD COMPATIBILITY
This module re-exports from accounts.views for backward compatibility.
All new code should import directly from accounts.views.
"""
# BACKWARD COMPATIBILITY: Re-export auth views from accounts app
from accounts.views import (
    LoginPageView,
    LogoutView,
    CheckEmailAPIView,
    LoginAPIView,
    ForgotPasswordAPIView,
    VerifyOTPAPIView,
    ResetPasswordAPIView,
    StaffDashboardView,
    ClientAdminDashboardView,
    ClientStaffDashboardView,
)

# Backward compatible function names (map old names to new implementations)
login_view = LoginPageView.as_view()
logout_view = LogoutView.as_view()
api_check_email = CheckEmailAPIView.as_view()
api_login = LoginAPIView.as_view()
api_forgot_password = ForgotPasswordAPIView.as_view()
api_verify_otp = VerifyOTPAPIView.as_view()
api_reset_password = ResetPasswordAPIView.as_view()
admin_staff_dashboard = StaffDashboardView.as_view()
client_dashboard = ClientAdminDashboardView.as_view()
client_staff_dashboard = ClientStaffDashboardView.as_view()


def inactive_view(request):
    """Display inactive account page — shown after forced logout."""
    from django.shortcuts import render
    reason = request.GET.get('reason', '')
    return render(request, 'auth/inactive.html', {'reason': reason})


__all__ = [
    'login_view',
    'logout_view',
    'api_check_email',
    'api_login',
    'api_forgot_password',
    'api_verify_otp',
    'api_reset_password',
    'admin_staff_dashboard',
    'client_dashboard',
    'client_staff_dashboard',
    'inactive_view',
]

