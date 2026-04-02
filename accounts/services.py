"""
Accounts Services Module

Handles authentication, OTP management, and role-based logic.
No models - uses Django's built-in auth and cache for OTP storage.
"""
import hmac
import logging
import secrets
import string
import hashlib
import os
from django.core.cache import cache
from django.contrib.auth import get_user_model, authenticate
from django.contrib.auth.models import Group
from django.conf import settings
from core.utils.threaded_email import send_html_email_async
from core.utils.email_utils import (
    get_password_reset_otp_email_template,
    get_security_alert_email_template,
)
from django.utils import timezone

logger = logging.getLogger(__name__)

User = get_user_model()

# Role mapping - Maps frontend role names to User model role values
ROLE_MAPPING = {
    'pro_user': 'pro_user',
    'super_admin': 'super_admin',
    'admin_staff': 'admin_staff',
    'client': 'client',
    'client_staff': 'client_staff',
}

# Group names for Django Groups
GROUP_NAMES = {
    'pro_user': 'PRO_USER',
    'super_admin': 'SUPER_ADMIN',
    'admin_staff': 'ADMIN_STAFF',
    'client': 'CLIENT',
    'client_staff': 'CLIENT_STAFF',
}

# Dashboard redirect URLs based on role
# pro_user, super_admin & admin_staff → main dashboard at /panel/
# client & client_staff → client dashboard at /panel/client/dashboard/
DASHBOARD_URLS = {
    'pro_user': '/panel/',
    'super_admin': '/panel/',
    'admin_staff': '/panel/',
    'client': '/panel/client/dashboard/',
    'client_staff': '/panel/client/dashboard/',
}

# OTP settings
OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 10
OTP_MAX_ATTEMPTS = 3

# Login hardening settings (cache-based per-identifier throttle)
AUTH_FAIL_WINDOW_SECONDS = int(os.getenv('AUTH_FAIL_WINDOW_SECONDS', '900'))
AUTH_FAIL_MAX_ATTEMPTS = int(os.getenv('AUTH_FAIL_MAX_ATTEMPTS', '15'))
AUTH_FAIL_NOTIFY_THRESHOLD = int(os.getenv('AUTH_FAIL_NOTIFY_THRESHOLD', '5'))
AUTH_FAIL_NOTIFY_COOLDOWN_SECONDS = int(
    os.getenv('AUTH_FAIL_NOTIFY_COOLDOWN_SECONDS', str(AUTH_FAIL_WINDOW_SECONDS))
)
MAX_CONCURRENT_SESSIONS = int(os.getenv('MAX_CONCURRENT_SESSIONS', '5'))
DEV_LOG_OTP = os.getenv('DEV_LOG_OTP', 'false').strip().lower() in ('1', 'true', 'yes', 'on')


def _normalize_identifier(value: str) -> str:
    """Normalize user-provided identifiers used for lookups/cache keys."""
    return str(value or '').strip().lower()


def _auth_fail_cache_key(identifier: str) -> str:
    digest = hashlib.sha256(identifier.encode('utf-8')).hexdigest()
    return f'auth_fail:{digest}'


def _auth_fail_notify_cache_key(identifier: str) -> str:
    digest = hashlib.sha256(identifier.encode('utf-8')).hexdigest()
    return f'auth_fail_notify:{digest}'


def _revoke_user_sessions(user_id: int, *, exclude_session_key: str = '') -> None:
    """Best-effort revocation of active DB sessions for a user."""
    from django.contrib.sessions.models import Session

    try:
        qs = Session.objects.filter(expire_date__gt=timezone.now())
        for session in qs.iterator(chunk_size=200):
            if exclude_session_key and session.session_key == exclude_session_key:
                continue
            try:
                data = session.get_decoded()
            except Exception:
                continue
            if str(data.get('_auth_user_id')) == str(user_id):
                session.delete()
    except Exception as exc:
        logger.warning('Session revocation failed for user_id=%s: %s', user_id, exc)


class AuthService:
    """
    Authentication service handling login, user verification,
    and session management.
    """
    
    @staticmethod
    def max_concurrent_sessions() -> int:
        return max(1, MAX_CONCURRENT_SESSIONS)

    @staticmethod
    def count_active_sessions_for_user(user_id, *, exclude_session_key: str = '', stop_after=None) -> int:
        """Count active DB-backed sessions currently authenticated as this user."""
        if not user_id:
            return 0

        from django.contrib.sessions.models import Session

        active = 0
        for session in Session.objects.filter(expire_date__gt=timezone.now()).iterator(chunk_size=200):
            if exclude_session_key and session.session_key == exclude_session_key:
                continue
            try:
                data = session.get_decoded()
            except Exception:
                continue
            if str(data.get('_auth_user_id')) == str(user_id):
                active += 1
                if stop_after is not None and active >= stop_after:
                    break
        return active

    @staticmethod
    def build_browser_fingerprint(user_agent: str, accept_language: str = '') -> str:
        """Build a stable, non-reversible browser fingerprint for session comparison."""
        ua = str(user_agent or '').strip().lower()
        al = str(accept_language or '').strip().lower()
        raw = f'{ua}|{al}'
        return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:20]

    @staticmethod
    def browser_fingerprint_from_request(request) -> str:
        if request is None:
            return ''
        return AuthService.build_browser_fingerprint(
            request.META.get('HTTP_USER_AGENT', ''),
            request.META.get('HTTP_ACCEPT_LANGUAGE', ''),
        )

    @staticmethod
    def inspect_active_sessions_for_user(
        user_id,
        *,
        browser_fingerprint: str = '',
        exclude_session_key: str = '',
        stop_after=None,
    ) -> dict:
        """
        Inspect active sessions for a user and detect concurrent logins from other browsers.
        """
        if not user_id:
            return {
                'count': 0,
                'has_different_browser': False,
                'known_browser_fingerprints': [],
            }

        from django.contrib.sessions.models import Session

        active = 0
        has_different_browser = False
        known_browser_fingerprints = set()
        current_fp = str(browser_fingerprint or '').strip()

        for session in Session.objects.filter(expire_date__gt=timezone.now()).iterator(chunk_size=200):
            if exclude_session_key and session.session_key == exclude_session_key:
                continue

            try:
                data = session.get_decoded()
            except Exception:
                continue

            if str(data.get('_auth_user_id')) != str(user_id):
                continue

            active += 1
            fp = str(data.get('_auth_browser_fp') or '').strip()
            if fp:
                known_browser_fingerprints.add(fp)
                if current_fp and fp != current_fp:
                    has_different_browser = True

            if stop_after is not None and active >= stop_after:
                break

        return {
            'count': active,
            'has_different_browser': has_different_browser,
            'known_browser_fingerprints': sorted(known_browser_fingerprints),
        }

    @staticmethod
    def _find_user(identifier, role=None):
        """
        Find a user by email or username, with optional role filter.

        Args:
            identifier: Email address or username
            role: Optional role to filter by

        Returns:
            User instance or None
        """
        from django.db.models import Q
        if not identifier:
            return None

        role_filter = Q()
        if role and role in ROLE_MAPPING:
            if role == 'super_admin':
                role_filter = Q(role__in=['super_admin', 'pro_user'])
            else:
                role_filter = Q(role=role)

        # Try email first, then username
        user = User.objects.filter(Q(email__iexact=identifier) & role_filter).first()
        if not user:
            user = User.objects.filter(Q(username__iexact=identifier) & role_filter).first()
        return user

    @staticmethod
    def check_user_exists(identifier, role=None):
        """
        Check login preflight without disclosing whether an account exists.

        Args:
            identifier: User's email address or username
            role: Optional role to filter by

        Returns:
            dict: response safe for unauthenticated clients
        """
        try:
            identifier = _normalize_identifier(identifier)
            # Perform a lookup so timing stays consistent, but never reveal result.
            AuthService._find_user(identifier, role)
            return {
                'exists': True,
                'user_name': 'User',
                'user_email': identifier,
                'message': 'If an account exists, continue with password.'
            }
        except Exception:
            return {
                'exists': True,
                'user_name': 'User',
                'user_email': identifier,
                'message': 'If an account exists, continue with password.'
            }
    
    @staticmethod
    def _is_login_blocked(identifier: str) -> bool:
        if not identifier:
            return False
        try:
            attempts = int(cache.get(_auth_fail_cache_key(identifier), 0) or 0)
            return attempts >= max(1, AUTH_FAIL_MAX_ATTEMPTS)
        except Exception:
            return False

    @staticmethod
    def _record_login_failure(identifier: str) -> None:
        if not identifier:
            return 0
        key = _auth_fail_cache_key(identifier)
        try:
            cache.add(key, 0, AUTH_FAIL_WINDOW_SECONDS)
            return int(cache.incr(key) or 0)
        except ValueError:
            cache.set(key, 1, AUTH_FAIL_WINDOW_SECONDS)
            return 1
        except Exception:
            return 0

    @staticmethod
    def _maybe_notify_failed_login(user, identifier: str, attempts: int) -> None:
        """Send best-effort suspicious login notification without changing API responses."""
        if not user or not getattr(user, 'email', ''):
            return
        if attempts < max(1, AUTH_FAIL_NOTIFY_THRESHOLD):
            return

        notify_key = _auth_fail_notify_cache_key(identifier)
        # cache.add => notify only once per cooldown window.
        try:
            should_notify = cache.add(notify_key, 1, AUTH_FAIL_NOTIFY_COOLDOWN_SECONDS)
        except Exception:
            return
        if not should_notify:
            return

        try:
            subject = '🚨 Security Alert: Multiple failed login attempts'
            html_content, plain_content = get_security_alert_email_template(
                name=user.get_full_name() or user.username,
                attempts=attempts,
            )
            send_html_email_async(
                subject=subject,
                plain_content=plain_content,
                html_content=html_content,
                from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
                recipient_list=[user.email],
                email_type='security_alert',
                skip_logging=False,
            )
        except Exception as exc:
            logger.warning('Failed to send login-failure alert for user=%s: %s', user.pk, exc)

    @staticmethod
    def _clear_login_failures(identifier: str) -> None:
        if not identifier:
            return
        try:
            cache.delete(_auth_fail_cache_key(identifier))
        except Exception:
            pass

    @staticmethod
    def authenticate_user(identifier, password, role=None):
        """
        Authenticate user with email/username and password.

        Args:
            identifier: User's email or username
            password: User's password
            role: Expected role (optional)

        Returns:
            dict: {success: bool, user: User, redirect_url: str, message: str}
        """
        try:
            identifier = _normalize_identifier(identifier)

            _AUTH_FAIL_MSG = 'Invalid credentials. Please try again.'

            if not identifier or len(identifier) > 254:
                return {'success': False, 'message': _AUTH_FAIL_MSG}

            if AuthService._is_login_blocked(identifier):
                return {'success': False, 'message': _AUTH_FAIL_MSG}

            user = AuthService._find_user(identifier, role=None)

            if not user:
                AuthService._record_login_failure(identifier)
                return {'success': False, 'message': _AUTH_FAIL_MSG}

            # Check role if specified
            if role and user.role != role:
                if not (role == 'super_admin' and user.role == 'pro_user'):
                    attempts = AuthService._record_login_failure(identifier)
                    AuthService._maybe_notify_failed_login(user, identifier, attempts)
                    return {'success': False, 'message': _AUTH_FAIL_MSG}

            if not user.is_active:
                attempts = AuthService._record_login_failure(identifier)
                AuthService._maybe_notify_failed_login(user, identifier, attempts)
                return {'success': False, 'message': _AUTH_FAIL_MSG}

            authenticated_user = authenticate(username=user.username, password=password)

            if authenticated_user is None:
                attempts = AuthService._record_login_failure(identifier)
                AuthService._maybe_notify_failed_login(user, identifier, attempts)
                return {'success': False, 'message': _AUTH_FAIL_MSG}

            AuthService._clear_login_failures(identifier)

            redirect_url = DASHBOARD_URLS.get(user.role, '/panel/')

            return {
                'success': True,
                'user': authenticated_user,
                'redirect_url': redirect_url,
                'message': 'Login successful'
            }

        except Exception as e:
            return {
                'success': False,
                'message': 'An authentication error occurred. Please try again.'
            }
    
    @staticmethod
    def get_dashboard_url(user):
        """Get the appropriate dashboard URL for a user based on their role."""
        from core.services.permission_service import PermissionService
        if PermissionService.is_super_admin(user):
            return DASHBOARD_URLS['super_admin']
        return DASHBOARD_URLS.get(user.role, '/panel/')


class OTPService:
    """
    OTP service for password reset functionality.
    Uses Django's cache backend for OTP storage (no database models needed).
    """
    
    @staticmethod
    def _get_otp_cache_key(email):
        """Generate a unique cache key for OTP storage."""
        email_hash = hashlib.sha256(email.lower().encode()).hexdigest()
        return f'otp_{email_hash}'
    
    @staticmethod
    def _get_otp_attempts_key(email):
        """Generate a cache key for tracking OTP attempts."""
        email_hash = hashlib.sha256(email.lower().encode()).hexdigest()
        return f'otp_attempts_{email_hash}'
    
    @staticmethod
    def _get_reset_token_key(email):
        """Generate a cache key for reset token storage."""
        email_hash = hashlib.sha256(email.lower().encode()).hexdigest()
        return f'reset_token_{email_hash}'

    @staticmethod
    def _otp_hash(email, otp):
        """Derive deterministic HMAC digest for OTP verification."""
        payload = f'{email.lower()}:{otp}'.encode('utf-8')
        return hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).hexdigest()
    
    @staticmethod
    def generate_otp():
        """Generate a cryptographically secure random 6-digit OTP."""
        return ''.join(secrets.choice(string.digits) for _ in range(OTP_LENGTH))
    
    @staticmethod
    def generate_reset_token():
        """Generate a cryptographically secure reset token with HMAC signature."""
        raw_token = secrets.token_urlsafe(32)
        # Sign the token with SECRET_KEY to prevent forgery
        signature = hmac.new(
            settings.SECRET_KEY.encode(),
            raw_token.encode(),
            hashlib.sha256
        ).hexdigest()[:16]
        return f"{raw_token}.{signature}"
    
    @classmethod
    def send_otp(cls, email):
        """
        Generate and send OTP to user's email.
        
        Args:
            email: User's email address
            
        Returns:
            dict: {success: bool, message: str, dev_otp: str (only in DEBUG)}
        """
        try:
            from core.models import EmailLog

            email = _normalize_identifier(email)

            # Check if user exists
            user = User.objects.filter(email__iexact=email).first()
            if not user:
                # Return same success message to prevent user enumeration
                return {
                    'success': True,
                    'message': f'If an account exists with this email, an OTP has been sent to {email}'
                }
            
            # Generate OTP
            otp = cls.generate_otp()
            cache_key = cls._get_otp_cache_key(email)
            
            # Store OTP in cache with expiry
            cache.set(cache_key, {
                'otp_hash': cls._otp_hash(email, otp),
                'email': email.lower(),
                'created_at': timezone.now().isoformat()
            }, timeout=OTP_EXPIRY_MINUTES * 60)
            
            # Reset attempts counter
            attempts_key = cls._get_otp_attempts_key(email)
            cache.set(attempts_key, 0, timeout=OTP_EXPIRY_MINUTES * 60)

            log = EmailLog.objects.create(
                recipient_name=user.get_full_name() or user.username or email,
                recipient_email=email,
                subject='Password Reset OTP',
                email_type=EmailLog.EMAIL_TYPE_OTP_RESET,
                status=EmailLog.STATUS_PENDING,
            )
            
            # Send email (or just log in development)
            if settings.DEBUG:
                if getattr(settings, 'DEV_LOG_OTP', DEV_LOG_OTP):
                    logger.info("[DEV] OTP for %s: %s", email, otp)
                else:
                    logger.debug("[DEV] OTP generated for %s (logging suppressed)", email)
                log.status = EmailLog.STATUS_SENT
                log.sent_at = timezone.now()
                log.error_message = ''
                log.save(update_fields=['status', 'sent_at', 'error_message'])
                return {
                    'success': True,
                    'message': f'If an account exists with this email, an OTP has been sent to {email}',
                    'dev_otp': otp  # Only in debug mode
                }
            else:
                # Production: Send branded HTML OTP email
                from core.utils.threaded_email import send_html_email_with_callback
                user_name = user.get_full_name() or user.username
                html_content, plain_content = get_password_reset_otp_email_template(
                    user_name=user_name,
                    otp=otp,
                    expiry_minutes=OTP_EXPIRY_MINUTES,
                )

                def _mark_sent():
                    EmailLog.objects.filter(pk=log.pk).update(
                        status=EmailLog.STATUS_SENT,
                        sent_at=timezone.now(),
                        error_message='',
                        subject='🔐 Password Reset OTP — Adarsh Admin',
                        body_text=plain_content,
                        body_html=html_content,
                    )

                def _mark_failed(error_msg):
                    EmailLog.objects.filter(pk=log.pk).update(
                        status=EmailLog.STATUS_FAILED,
                        error_message=error_msg or 'Failed to send OTP email.',
                        subject='🔐 Password Reset OTP — Adarsh Admin',
                        body_text=plain_content,
                        body_html=html_content,
                    )

                send_html_email_with_callback(
                    subject='🔐 Password Reset OTP — Adarsh Admin',
                    plain_content=plain_content,
                    html_content=html_content,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[email],
                    on_success=_mark_sent,
                    on_failure=_mark_failed,
                    skip_logging=True,
                )
                # Queued for send in thread — keep as pending for accurate state.
                return {
                    'success': True,
                    'message': f'If an account exists with this email, an OTP has been sent to {email}'
                }
                    
        except Exception as e:
            logger.error("Error generating OTP for %s: %s", email, e)
            try:
                from core.models import EmailLog
                EmailLog.objects.create(
                    recipient_name=email,
                    recipient_email=email,
                    subject='Password Reset OTP',
                    email_type=EmailLog.EMAIL_TYPE_OTP_RESET,
                    status=EmailLog.STATUS_FAILED,
                    error_message=str(e),
                )
            except Exception:
                pass
            return {
                'success': False,
                'message': 'An error occurred. Please try again.'
            }
    
    @classmethod
    def verify_otp(cls, email, otp):
        """
        Verify the OTP entered by user.
        
        Args:
            email: User's email
            otp: OTP entered by user
            
        Returns:
            dict: {success: bool, reset_token: str, message: str}
        """
        try:
            email = _normalize_identifier(email)
            cache_key = cls._get_otp_cache_key(email)
            attempts_key = cls._get_otp_attempts_key(email)
            
            # Get stored OTP data
            otp_data = cache.get(cache_key)
            
            if not otp_data:
                return {
                    'success': False,
                    'message': 'OTP has expired. Please request a new one.'
                }
            
            # Check attempts atomically using cache.incr to prevent TOCTOU race
            try:
                attempts = cache.incr(attempts_key)
            except ValueError:
                # Key expired or missing — first attempt in a fresh window
                cache.set(attempts_key, 1, timeout=OTP_EXPIRY_MINUTES * 60)
                attempts = 1
            
            if attempts > OTP_MAX_ATTEMPTS:
                # Clear OTP after max attempts
                cache.delete(cache_key)
                return {
                    'success': False,
                    'message': 'Too many failed attempts. Please request a new OTP.'
                }
            
            # Verify OTP (constant-time comparison to prevent timing attacks)
            # Backward-compatible fallback supports entries created before hashing.
            stored_hash = otp_data.get('otp_hash')
            if stored_hash:
                candidate_hash = cls._otp_hash(email, otp)
                is_valid = hmac.compare_digest(str(stored_hash), str(candidate_hash))
            else:
                is_valid = hmac.compare_digest(str(otp_data.get('otp', '')), str(otp))

            if not is_valid:
                return {
                    'success': False,
                    'message': 'Invalid OTP. Please try again.'
                }
            
            # OTP verified - generate reset token
            reset_token = cls.generate_reset_token()
            token_key = cls._get_reset_token_key(email)
            
            # Store reset token (valid for 15 minutes)
            cache.set(token_key, {
                'token': reset_token,
                'email': email.lower(),
                'verified_at': timezone.now().isoformat()
            }, timeout=15 * 60)
            
            # Clear OTP data
            cache.delete(cache_key)
            cache.delete(attempts_key)
            
            return {
                'success': True,
                'reset_token': reset_token,
                'message': 'OTP verified successfully'
            }
            
        except Exception as e:
            logger.error("Error verifying OTP for %s: %s", email, e)
            return {
                'success': False,
                'message': 'An error occurred. Please try again.'
            }
    
    @classmethod
    def reset_password(cls, email, reset_token, new_password):
        """
        Reset user's password after OTP verification.
        
        Args:
            email: User's email
            reset_token: Token from OTP verification
            new_password: New password to set
            
        Returns:
            dict: {success: bool, message: str}
        """
        try:
            email = _normalize_identifier(email)
            token_key = cls._get_reset_token_key(email)
            token_data = cache.get(token_key)
            
            if not token_data:
                return {
                    'success': False,
                    'message': 'Reset session expired. Please start again.'
                }
            
            if not hmac.compare_digest(str(token_data['token']), str(reset_token)):
                return {
                    'success': False,
                    'message': 'Invalid reset token. Please start again.'
                }

            if str(token_data.get('email', '')).lower() != email:
                return {
                    'success': False,
                    'message': 'Invalid reset session. Please start again.'
                }
            
            # Verify HMAC signature on the token to prevent forgery
            token_parts = reset_token.split('.')
            if len(token_parts) != 2:
                return {
                    'success': False,
                    'message': 'Invalid reset token format. Please start again.'
                }
            raw_token, provided_sig = token_parts
            expected_sig = hmac.new(
                settings.SECRET_KEY.encode(),
                raw_token.encode(),
                hashlib.sha256
            ).hexdigest()[:16]
            if not hmac.compare_digest(provided_sig, expected_sig):
                return {
                    'success': False,
                    'message': 'Tampered reset token. Please start again.'
                }
            
            # Get user and update password
            user = User.objects.filter(email__iexact=email).first()
            if not user:
                return {
                    'success': False,
                    'message': 'Invalid reset request. Please start again.'
                }
            
            # Validate password (using AUTH_PASSWORD_VALIDATORS from settings —
            # currently only MinimumLengthValidator, so mobile numbers etc. are allowed)
            from django.contrib.auth.password_validation import validate_password
            try:
                validate_password(new_password, user=user)
            except Exception as validation_error:
                # Collect all error messages from validators
                msgs = getattr(validation_error, 'messages', [str(validation_error)])
                return {
                    'success': False,
                    'message': '; '.join(msgs)
                }

            # Set new password
            user.set_password(new_password)
            user.save()

            # Security: invalidate all active sessions for this user.
            _revoke_user_sessions(user.pk)
            AuthService._clear_login_failures(email)
            
            # Clear reset token
            cache.delete(token_key)
            
            return {
                'success': True,
                'message': 'Password reset successfully. You can now login with your new password.'
            }
            
        except Exception as e:
            return {
                'success': False,
                'message': f'Error resetting password. Please try again.'
            }


class RoleService:
    """
    Service for managing user roles and groups.
    Uses Django's built-in Group model.
    """
    
    @staticmethod
    def setup_groups():
        """
        Create Django Groups for each role.
        Call this from a management command or migration.
        
        Returns:
            dict: {success: bool, groups: list, message: str}
        """
        created_groups = []
        
        try:
            for role_key, group_name in GROUP_NAMES.items():
                group, created = Group.objects.get_or_create(name=group_name)
                if created:
                    created_groups.append(group_name)
            
            return {
                'success': True,
                'groups': list(GROUP_NAMES.values()),
                'created': created_groups,
                'message': f'Groups setup complete. Created: {created_groups}'
            }
        except Exception as e:
            return {
                'success': False,
                'message': f'Error setting up groups. Please try again.'
            }
    
    @staticmethod
    def get_role_display_name(role):
        """Get human-readable role name."""
        role_display = {
            'pro_user': 'Pro User',
            'super_admin': 'Super Admin',
            'admin_staff': 'Admin Staff',
            'client': 'Client',
            'client_staff': 'Client Staff',
        }
        return role_display.get(role, role)
