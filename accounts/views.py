"""
Accounts Views Module

API views and page views for authentication flow.
"""
import json
import logging
from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.contrib.auth import login, logout
from core.services.activity_service import ActivityService
from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin

from .services import AuthService, OTPService, RoleService, DASHBOARD_URLS
from .rate_limit import rate_limit

logger = logging.getLogger(__name__)


# =============================================================================
# PAGE VIEWS (Template-based)
# =============================================================================

class LoginPageView(View):
    """
    Render the login page with multi-step auth flow.
    Handles role selection, email/password, and password reset.
    """
    template_name = 'auth/login.html'
    
    def get(self, request):
        # If user is already authenticated, redirect to dashboard
        if request.user.is_authenticated:
            redirect_url = AuthService.get_dashboard_url(request.user)
            return redirect(redirect_url)
        
        return render(request, self.template_name)


class LogoutView(View):
    """Handle user logout."""
    
    def get(self, request):
        if request.user.is_authenticated:
            ActivityService.log_logout(request, request.user)
        logout(request)
        return redirect('accounts:login')
    
    def post(self, request):
        if request.user.is_authenticated:
            ActivityService.log_logout(request, request.user)
        logout(request)
        return redirect('accounts:login')


# =============================================================================
# DASHBOARD VIEWS
# =============================================================================

class BaseDashboardView(LoginRequiredMixin, View):
    """Base dashboard view with login requirement."""
    login_url = '/panel/auth/login/'
    template_name = None
    allowed_roles = []
    
    def dispatch(self, request, *args, **kwargs):
        if not request.user.is_authenticated:
            return redirect(self.login_url)
        
        # Check role access if roles are specified
        if self.allowed_roles and request.user.role not in self.allowed_roles:
            # Redirect to appropriate dashboard
            correct_url = AuthService.get_dashboard_url(request.user)
            return redirect(correct_url)
        
        return super().dispatch(request, *args, **kwargs)
    
    def get_context_data(self):
        """Get common context data for dashboards."""
        return {
            'user': self.request.user,
            'user_role': RoleService.get_role_display_name(self.request.user.role),
            'dashboard_urls': DASHBOARD_URLS,
            'active_page': 'dashboard',
        }


class OwnerDashboardView(BaseDashboardView):
    """
    Super Admin Dashboard — DEPRECATED.
    Now redirects to the main dashboard at /panel/.
    Old template: dashboard/owner.html (kept as backup).
    """
    allowed_roles = ['super_admin']
    
    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            from core.services.permission_service import PermissionService
            if PermissionService.is_super_admin(request.user):
                return redirect('/panel/')
        return super().dispatch(request, *args, **kwargs)
    
    def get(self, request):
        return redirect('/panel/')


class StaffDashboardView(BaseDashboardView):
    """
    Admin Staff Dashboard — DEPRECATED.
    Now redirects to the main dashboard at /panel/.
    Old template: dashboard/staff.html (kept as backup).
    """
    allowed_roles = ['admin_staff']
    
    def get(self, request):
        return redirect('/panel/')


class ClientAdminDashboardView(BaseDashboardView):
    """
    Client Dashboard — DEPRECATED.
    Now redirects to /panel/client/dashboard/.
    Old template: dashboard/client_admin.html (kept as backup).
    """
    allowed_roles = ['client']
    
    def get(self, request):
        return redirect('/panel/client/dashboard/')


class ClientStaffDashboardView(BaseDashboardView):
    """
    Client Staff Dashboard — DEPRECATED.
    Now redirects to /panel/client/dashboard/.
    Old template: dashboard/client_staff.html (kept as backup).
    """
    allowed_roles = ['client_staff']
    
    def get(self, request):
        return redirect('/panel/client/dashboard/')


# =============================================================================
# API VIEWS (JSON responses for AJAX calls)
# =============================================================================

@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(rate_limit(max_requests=10, window_seconds=60), name='dispatch')
class CheckEmailAPIView(View):
    """
    API endpoint to check if user email exists.
    POST /api/auth/check-email/
    """
    
    def post(self, request):
        try:
            data = json.loads(request.body)
            email = data.get('email', '').strip()
            role = data.get('role')
            
            if not email:
                return JsonResponse({
                    'success': False,
                    'message': 'Email is required'
                }, status=400)
            
            result = AuthService.check_user_exists(email, role)
            
            return JsonResponse({
                'success': result['exists'],
                'user_name': result.get('user_name', ''),
                'user_email': result.get('user_email', ''),
                'message': result['message']
            })
            
        except json.JSONDecodeError:
            return JsonResponse({
                'success': False,
                'message': 'Invalid JSON data'
            }, status=400)
        except Exception as e:
            return JsonResponse({
                'success': False,
                'message': str(e)
            }, status=500)


@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(rate_limit(max_requests=5, window_seconds=60), name='dispatch')
class LoginAPIView(View):
    """
    API endpoint for user login.
    POST /api/auth/login/
    """
    
    def post(self, request):
        try:
            data = json.loads(request.body)
            email = data.get('email', '').strip()
            password = data.get('password', '')
            role = data.get('role')
            
            if not email or not password:
                return JsonResponse({
                    'success': False,
                    'message': 'Email and password are required'
                }, status=400)
            
            result = AuthService.authenticate_user(email, password, role)
            
            if result['success']:
                # Log the user in
                login(request, result['user'])
                
                # Store selected role in session for reference
                request.session['selected_role'] = role
                
                # Log activity
                ActivityService.log_login(request, result['user'])
                logger.info("Login success: user=%s role=%s", email, role)
                
                return JsonResponse({
                    'success': True,
                    'redirect_url': result['redirect_url'],
                    'message': result['message']
                })
            else:
                logger.warning("Login failed: email=%s role=%s reason=%s", email, role, result['message'])
                return JsonResponse({
                    'success': False,
                    'message': result['message']
                })
                
        except json.JSONDecodeError:
            return JsonResponse({
                'success': False,
                'message': 'Invalid JSON data'
            }, status=400)
        except Exception as e:
            logger.exception("Login error for email=%s", email if 'email' in dir() else 'unknown')
            return JsonResponse({
                'success': False,
                'message': 'An unexpected error occurred. Please try again.'
            }, status=500)


@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(rate_limit(max_requests=3, window_seconds=60), name='dispatch')
class ForgotPasswordAPIView(View):
    """
    API endpoint to request password reset OTP.
    POST /api/auth/forgot-password/
    """
    
    def post(self, request):
        try:
            data = json.loads(request.body)
            email = data.get('email', '').strip()
            
            if not email:
                return JsonResponse({
                    'success': False,
                    'message': 'Email is required'
                }, status=400)
            
            result = OTPService.send_otp(email)
            logger.info("Password reset requested: email=%s success=%s", email, result['success'])
            
            response_data = {
                'success': result['success'],
                'message': result['message']
            }
            
            # Include dev OTP in debug mode only
            from django.conf import settings as django_settings
            if django_settings.DEBUG and result.get('dev_otp'):
                response_data['dev_otp'] = result['dev_otp']
            
            return JsonResponse(response_data)
            
        except json.JSONDecodeError:
            return JsonResponse({
                'success': False,
                'message': 'Invalid JSON data'
            }, status=400)
        except Exception as e:
            return JsonResponse({
                'success': False,
                'message': str(e)
            }, status=500)


@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(rate_limit(max_requests=5, window_seconds=60), name='dispatch')
class VerifyOTPAPIView(View):
    """
    API endpoint to verify OTP.
    POST /api/auth/verify-otp/
    """
    
    def post(self, request):
        try:
            data = json.loads(request.body)
            email = data.get('email', '').strip()
            otp = data.get('otp', '').strip()
            
            if not email or not otp:
                return JsonResponse({
                    'success': False,
                    'message': 'Email and OTP are required'
                }, status=400)
            
            result = OTPService.verify_otp(email, otp)
            
            response_data = {
                'success': result['success'],
                'message': result['message']
            }
            
            if result.get('reset_token'):
                response_data['reset_token'] = result['reset_token']
            
            return JsonResponse(response_data)
            
        except json.JSONDecodeError:
            return JsonResponse({
                'success': False,
                'message': 'Invalid JSON data'
            }, status=400)
        except Exception as e:
            return JsonResponse({
                'success': False,
                'message': str(e)
            }, status=500)


@method_decorator(csrf_exempt, name='dispatch')
@method_decorator(rate_limit(max_requests=5, window_seconds=60), name='dispatch')
class ResetPasswordAPIView(View):
    """
    API endpoint to reset password.
    POST /api/auth/reset-password/
    """
    
    def post(self, request):
        try:
            data = json.loads(request.body)
            email = data.get('email', '').strip()
            reset_token = data.get('reset_token', '').strip()
            new_password = data.get('new_password', '')
            confirm_password = data.get('confirm_password', '')
            
            if not all([email, reset_token, new_password, confirm_password]):
                return JsonResponse({
                    'success': False,
                    'message': 'All fields are required'
                }, status=400)
            
            if new_password != confirm_password:
                return JsonResponse({
                    'success': False,
                    'message': 'Passwords do not match'
                }, status=400)
            
            if len(new_password) < 6:
                return JsonResponse({
                    'success': False,
                    'message': 'Password must be at least 6 characters'
                }, status=400)
            
            result = OTPService.reset_password(email, reset_token, new_password)
            
            return JsonResponse({
                'success': result['success'],
                'message': result['message']
            })
            
        except json.JSONDecodeError:
            return JsonResponse({
                'success': False,
                'message': 'Invalid JSON data'
            }, status=400)
        except Exception as e:
            return JsonResponse({
                'success': False,
                'message': str(e)
            }, status=500)


# =============================================================================
# UTILITY VIEWS
# =============================================================================

@login_required(login_url='/panel/auth/login/')
def redirect_to_dashboard(request):
    """Redirect authenticated user to their appropriate dashboard."""
    redirect_url = AuthService.get_dashboard_url(request.user)
    return redirect(redirect_url)


def setup_groups_view(request):
    """
    Utility view to setup Django Groups.
    Should be called once during initial setup.
    Only accessible by superusers.
    """
    if not request.user.is_authenticated or not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    result = RoleService.setup_groups()
    return JsonResponse(result)
