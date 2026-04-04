"""
Accounts Views Module

API views and page views for authentication flow.
"""
import json
import logging
import os
import re
from django.shortcuts import render, redirect
from django.http import JsonResponse
from django.views import View
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.decorators import method_decorator
from django.contrib.auth import login, logout
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from core.services.activity_service import ActivityService
from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin

from .services import AuthService, OTPService, RoleService, DASHBOARD_URLS
from .rate_limit import rate_limit, _get_client_ip

logger = logging.getLogger(__name__)
User = get_user_model()


def _mask_login_identifier(identifier):
    """Mask login identifier before writing to logs."""
    value = str(identifier or '').strip()
    if not value:
        return 'unknown'
    if '@' in value:
        local, domain = value.split('@', 1)
        local_mask = (local[:1] + '***') if local else '***'
        return f'{local_mask}@{domain}'
    return value[:1] + '***'


# =============================================================================
# PAGE VIEWS (Template-based)
# =============================================================================

@method_decorator(ensure_csrf_cookie, name='dispatch')
class LoginPageView(View):
    """
    Render the login page with multi-step auth flow.
    Handles role selection, email/password, and password reset.
    @ensure_csrf_cookie ensures the csrftoken cookie is set on GET,
    so subsequent AJAX POSTs can read it for the X-CSRFToken header.
    """
    template_name = 'auth/login.html'
    
    def get(self, request):
        # If user is already authenticated, redirect to dashboard
        if request.user.is_authenticated:
            # Respect ?next= param (e.g. from PWA → login redirect)
            next_url = request.GET.get('next', '')
            # S7: use Django's safe-redirect helper — blocks //evil.com, /\evil.com, etc.
            if next_url and url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}):
                return redirect(next_url)
            redirect_url = AuthService.get_dashboard_url(request.user)
            return redirect(redirect_url)

        ua = request.META.get('HTTP_USER_AGENT', '')
        is_mobile_ua = bool(re.search(r'Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini', ua, re.I))
        if is_mobile_ua:
            return redirect('/app/login/?install=1')
        
        return render(request, self.template_name)


class LogoutView(View):
    """Handle user logout. Only POST allowed to prevent CSRF logout attacks."""
    
    def get(self, request):
        # GET requests redirect to login — do NOT perform logout on GET
        # (prevents CSRF logout via <img src="/logout/"> attacks)
        return redirect('accounts:login')
    
    def post(self, request):
        from .services_impersonate import ImpersonateService

        # If this session is impersonating, stopping logout returns control to Pro User.
        if request.user.is_authenticated and ImpersonateService.is_impersonating(request):
            result = ImpersonateService.stop(request)
            if result.get('success'):
                return redirect(result.get('redirect_url') or '/panel/')

        if request.user.is_authenticated:
            # Pro User cannot logout the final active session.
            if getattr(request.user, 'role', '') == 'pro_user':
                active_sessions = AuthService.count_active_sessions_for_user(request.user.id, stop_after=2)
                if active_sessions <= 1:
                    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                        return JsonResponse({
                            'success': False,
                            'message': 'Pro User must remain logged in on at least one active session.'
                        }, status=400)
                    return redirect('/panel/?pro_logout_blocked=1')

            ActivityService.log_logout(request, request.user)
        logout(request)
        # Respect ?next= or POST body next (e.g. from PWA logout)
        next_url = request.POST.get('next', '') or request.GET.get('next', '')
        # S7: use Django's safe-redirect helper — blocks //evil.com, /\evil.com, etc.
        if next_url and url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}):
            login_url = reverse('accounts:login') + '?next=' + next_url
            return redirect(login_url)
        # Redirect to the main website landing page if configured,
        # otherwise fall back to the login page
        from django.conf import settings
        website_url = getattr(settings, 'WEBSITE_URL', '')
        if website_url:
            return redirect(website_url)
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
    """DEPRECATED — redirects to /panel/."""
    allowed_roles = ['super_admin', 'pro_user']
    def get(self, request):
        return redirect('/panel/')


class StaffDashboardView(BaseDashboardView):
    """DEPRECATED — redirects to /panel/."""
    allowed_roles = ['admin_staff']
    def get(self, request):
        return redirect('/panel/')


class ClientAdminDashboardView(BaseDashboardView):
    """DEPRECATED — redirects to /panel/client/dashboard/."""
    allowed_roles = ['client']
    def get(self, request):
        return redirect('/panel/client/dashboard/')


class ClientStaffDashboardView(BaseDashboardView):
    """DEPRECATED — redirects to /panel/client/dashboard/."""
    allowed_roles = ['client_staff']
    def get(self, request):
        return redirect('/panel/client/dashboard/')


# =============================================================================
# API VIEWS (JSON responses for AJAX calls)
# =============================================================================

@method_decorator(rate_limit(max_requests=10, window_seconds=60), name='dispatch')
class CheckEmailAPIView(View):
    """
    API endpoint to check if user email exists.
    POST /api/auth/check-email/
    """
    
    def post(self, request):
        try:
            data = json.loads(request.body)
            identifier = data.get('email', '').strip()
            
            if not identifier:
                return JsonResponse({
                    'success': False,
                    'message': 'Email or username is required'
                }, status=400)
            
            result = AuthService.check_user_exists(identifier)
            
            return JsonResponse({
                'success': result.get('exists', True),
                'exists': result.get('exists', True),
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
            logger.exception("Auth API error: %s", e)
            return JsonResponse({
                'success': False,
                'message': 'An error occurred. Please try again.'
            }, status=500)


@method_decorator(rate_limit(max_requests=5, window_seconds=60), name='dispatch')
class LoginAPIView(View):
    """
    API endpoint for user login.
    POST /api/auth/login/
    Requires CSRF token for session-based auth security.
    """
    
    def post(self, request):
        identifier = None
        client_ip = _get_client_ip(request)
        try:
            data = json.loads(request.body)
            identifier = data.get('email', '').strip()
            password = data.get('password', '')
            
            if not identifier or not password:
                return JsonResponse({
                    'success': False,
                    'message': 'Email/username and password are required'
                }, status=400)
            
            result = AuthService.authenticate_user(identifier, password)
            
            if result['success']:
                user = result['user']
                resolved_role = getattr(user, 'role', '')
                browser_fingerprint = AuthService.browser_fingerprint_from_request(request)
                current_session_key = ''
                if request.user.is_authenticated and getattr(request.user, 'pk', None) == user.pk:
                    current_session_key = request.session.session_key or ''

                max_sessions = AuthService.max_concurrent_sessions()
                session_inspection = AuthService.inspect_active_sessions_for_user(
                    user.id,
                    browser_fingerprint=browser_fingerprint,
                    exclude_session_key=current_session_key,
                    stop_after=max_sessions + 1,
                )
                active_sessions = int(session_inspection.get('count', 0) or 0)
                has_different_browser_session = bool(session_inspection.get('has_different_browser'))
                if active_sessions >= max_sessions:
                    logger.warning(
                        "Login blocked by session limit: user=%s role=%s ip=%s active_sessions=%s limit=%s",
                        _mask_login_identifier(identifier),
                        resolved_role,
                        client_ip,
                        active_sessions,
                        max_sessions,
                    )
                    return JsonResponse({
                        'success': False,
                        'message': f'Maximum {max_sessions} active logins are allowed for this account. Please logout from another browser and try again.'
                    })

                # Log the user in
                login(request, user)
                
                # Store actual role resolved from user identity (email/username)
                request.session['selected_role'] = resolved_role
                request.session['_auth_browser_fp'] = browser_fingerprint
                
                # Log activity
                if user.role in ('client', 'client_staff') and has_different_browser_session:
                    display_name = user.get_full_name() or user.username
                    ActivityService.log(
                        'login',
                        f'{display_name} logged in from a different browser while another session is active',
                        user=user,
                        request=request,
                    )
                    logger.warning(
                        "Concurrent cross-browser login detected: user=%s role=%s ip=%s active_sessions=%s",
                        _mask_login_identifier(identifier),
                        resolved_role,
                        client_ip,
                        active_sessions,
                    )
                else:
                    ActivityService.log_login(request, user)
                logger.info("Login success: user=%s role=%s ip=%s", _mask_login_identifier(identifier), resolved_role, client_ip)
                
                return JsonResponse({
                    'success': True,
                    'redirect_url': result['redirect_url'],
                    'message': result['message']
                })
            else:
                logger.warning(
                    "Login failed: identifier=%s role=%s ip=%s reason=%s",
                    _mask_login_identifier(identifier),
                    'inferred',
                    client_ip,
                    result['message'],
                )
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
            logger.exception("Login error for user=%s ip=%s", _mask_login_identifier(identifier), client_ip)
            return JsonResponse({
                'success': False,
                'message': 'An unexpected error occurred. Please try again.'
            }, status=500)


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
            logger.info(
                "Password reset requested: email=%s success=%s",
                _mask_login_identifier(email),
                result['success'],
            )
            
            response_data = {
                'success': result['success'],
                'message': result['message']
            }

            return JsonResponse(response_data)
            
        except json.JSONDecodeError:
            return JsonResponse({
                'success': False,
                'message': 'Invalid JSON data'
            }, status=400)
        except Exception as e:
            logger.exception("Auth API error: %s", e)
            return JsonResponse({
                'success': False,
                'message': 'An error occurred. Please try again.'
            }, status=500)


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
            logger.exception("Auth API error: %s", e)
            return JsonResponse({
                'success': False,
                'message': 'An error occurred. Please try again.'
            }, status=500)


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
            
            if len(new_password) < 8:
                return JsonResponse({
                    'success': False,
                    'message': 'Password must be at least 8 characters'
                }, status=400)
            
            result = OTPService.reset_password(email, reset_token, new_password)

            if result.get('success'):
                user = User.objects.filter(email__iexact=email).first()
                masked_email = _mask_login_identifier(email)
                target_name = ''
                target_id = None
                if user:
                    target_name = user.get_full_name() or user.username
                    target_id = user.pk
                ActivityService.log(
                    'password_reset',
                    f'Password reset completed for {masked_email}',
                    user=user,
                    request=request,
                    target_model='User',
                    target_id=target_id,
                    target_name=target_name,
                )
            
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
            logger.exception("Auth API error: %s", e)
            return JsonResponse({
                'success': False,
                'message': 'An error occurred. Please try again.'
            }, status=500)


# =============================================================================
# UTILITY VIEWS
# =============================================================================

@login_required(login_url='/panel/auth/login/')
def redirect_to_dashboard(request):
    """Redirect authenticated user to their appropriate dashboard."""
    redirect_url = AuthService.get_dashboard_url(request.user)
    return redirect(redirect_url)


# =============================================================================
# IMPERSONATION VIEWS (Pro User only)
# =============================================================================

class ImpersonateStartAPIView(LoginRequiredMixin, View):
    """
    POST /api/auth/impersonate/start/
    Body: { "user_id": <int> }
    Pro User only — starts impersonating the target user.
    """
    login_url = '/panel/auth/login/'

    def post(self, request):
        from .services_impersonate import ImpersonateService

        if getattr(request.user, 'role', None) != 'pro_user':
            return JsonResponse({'success': False, 'message': 'Permission denied.'}, status=403)

        actor_user = request.user
        try:
            data = json.loads(request.body)
            target_user_id = data.get('user_id')
            if not target_user_id:
                return JsonResponse({'success': False, 'message': 'user_id is required'}, status=400)

            target_user = None
            try:
                target_user = User.objects.filter(pk=int(target_user_id)).first()
            except (TypeError, ValueError):
                target_user = None

            result = ImpersonateService.start(request, int(target_user_id))
            if result.get('success'):
                target_name = ''
                target_id = None
                if target_user:
                    target_name = target_user.get_full_name() or target_user.username
                    target_id = target_user.pk
                ActivityService.log(
                    'impersonate_start',
                    f'Impersonation started for {target_name or "selected user"}',
                    user=actor_user,
                    request=request,
                    target_model='User',
                    target_id=target_id,
                    target_name=target_name,
                )
            status = 200 if result['success'] else 403
            return JsonResponse(result, status=status)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JsonResponse({'success': False, 'message': 'Invalid request data'}, status=400)
        except Exception as e:
            logger.exception("Impersonate start error: %s", e)
            return JsonResponse({'success': False, 'message': 'An error occurred.'}, status=500)


class ImpersonateStopAPIView(LoginRequiredMixin, View):
    """
    POST /api/auth/impersonate/stop/
    Stops impersonation and returns to the Pro User session.
    """
    login_url = '/panel/auth/login/'

    def post(self, request):
        from .services_impersonate import ImpersonateService
        try:
            impersonated_user = request.user if getattr(request.user, 'is_authenticated', False) else None
            result = ImpersonateService.stop(request)
            if result.get('success'):
                target_name = ''
                target_id = None
                if impersonated_user:
                    target_name = impersonated_user.get_full_name() or impersonated_user.username
                    target_id = impersonated_user.pk
                ActivityService.log(
                    'impersonate_stop',
                    f'Impersonation stopped (was acting as {target_name or "user"})',
                    user=request.user if getattr(request.user, 'is_authenticated', False) else None,
                    request=request,
                    target_model='User',
                    target_id=target_id,
                    target_name=target_name,
                )
            status = 200 if result['success'] else 400
            return JsonResponse(result, status=status)
        except Exception as e:
            logger.exception("Impersonate stop error: %s", e)
            return JsonResponse({'success': False, 'message': 'An error occurred.'}, status=500)


class ImpersonateListAPIView(LoginRequiredMixin, View):
    """
    GET /api/auth/impersonate/users/
    Returns list of users the Pro User can impersonate.
    """
    login_url = '/panel/auth/login/'

    def get(self, request):
        from .services_impersonate import ImpersonateService
        if not ImpersonateService.can_impersonate(request.user):
            return JsonResponse({'success': False, 'message': 'Permission denied.'}, status=403)

        users = ImpersonateService.get_impersonation_targets(request)
        return JsonResponse({'success': True, 'users': users})
