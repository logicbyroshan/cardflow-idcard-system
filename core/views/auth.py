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
    ImpersonateStartAPIView,
    ImpersonateStopAPIView,
    ImpersonateListAPIView,
    ProUserAuditUsersAPIView,
    ProUserAuditHistoryAPIView,
    ProUserAuditActionsAPIView,
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
api_impersonate_start = ImpersonateStartAPIView.as_view()
api_impersonate_stop = ImpersonateStopAPIView.as_view()
api_impersonate_users = ImpersonateListAPIView.as_view()
api_user_audit_users = ProUserAuditUsersAPIView.as_view()
api_user_audit_history = ProUserAuditHistoryAPIView.as_view()
api_user_audit_actions = ProUserAuditActionsAPIView.as_view()


def inactive_view(request):
    """Display inactive account page — shown after forced logout."""
    from django.shortcuts import render
    reason = request.GET.get('reason', '')
    return render(request, 'auth/inactive.html', {'reason': reason})


def maintenance_view(request):
    """Display maintenance page for suspended client/client_staff (user stays logged in)."""
    from django.shortcuts import render, redirect
    # If user is not logged in, send to inactive page
    if not request.user.is_authenticated:
        return redirect('inactive')
    reason = request.GET.get('reason', '')
    return render(request, 'auth/maintenance.html', {'reason': reason})


def api_check_maintenance(request):
    """
    Lightweight API for the maintenance page to poll whether the client
    account has been reactivated. Returns { active: true/false }.
    """
    from django.http import JsonResponse
    user = request.user
    if not user.is_authenticated:
        return JsonResponse({'active': False})
    
    if user.role == 'client':
        from client.models import Client
        try:
            client = Client.objects.get(user=user)
            return JsonResponse({'active': client.status == 'active'})
        except Client.DoesNotExist:
            return JsonResponse({'active': False})
    elif user.role == 'client_staff':
        from staff.models import Staff
        try:
            staff = Staff.objects.select_related('client').get(user=user)
            return JsonResponse({'active': staff.client and staff.client.status == 'active'})
        except Staff.DoesNotExist:
            return JsonResponse({'active': False})
    
    return JsonResponse({'active': True})


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
    'maintenance_view',
    'api_check_maintenance',
    'api_impersonate_start',
    'api_impersonate_stop',
    'api_impersonate_users',
    'api_user_audit_users',
    'api_user_audit_history',
    'api_user_audit_actions',
]

