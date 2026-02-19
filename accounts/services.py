"""
Accounts Services Module

Handles authentication, OTP management, and role-based logic.
No models - uses Django's built-in auth and cache for OTP storage.
"""
import secrets
import string
import hashlib
from django.core.cache import cache
from django.contrib.auth import get_user_model, authenticate
from django.contrib.auth.models import Group
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

User = get_user_model()

# Role mapping - Maps frontend role names to User model role values
ROLE_MAPPING = {
    'super_admin': 'super_admin',
    'admin_staff': 'admin_staff',
    'client': 'client',
    'client_staff': 'client_staff',
}

# Group names for Django Groups
GROUP_NAMES = {
    'super_admin': 'SUPER_ADMIN',
    'admin_staff': 'ADMIN_STAFF',
    'client': 'CLIENT',
    'client_staff': 'CLIENT_STAFF',
}

# Dashboard redirect URLs based on role
# super_admin & admin_staff → main dashboard at /panel/
# client & client_staff → client dashboard at /panel/client/dashboard/
DASHBOARD_URLS = {
    'super_admin': '/panel/',
    'admin_staff': '/panel/',
    'client': '/panel/client/dashboard/',
    'client_staff': '/panel/client/dashboard/',
}

# OTP settings
OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 10
OTP_MAX_ATTEMPTS = 3


class AuthService:
    """
    Authentication service handling login, user verification,
    and session management.
    """
    
    @staticmethod
    def check_user_exists(email, role=None):
        """
        Check if a user exists with the given email and optionally role.
        
        Args:
            email: User's email address
            role: Optional role to filter by
            
        Returns:
            dict: {exists: bool, user_name: str, message: str}
        """
        try:
            user_filter = {'email__iexact': email}
            if role and role in ROLE_MAPPING:
                user_filter['role'] = role
            
            user = User.objects.filter(**user_filter).first()
            
            if user:
                return {
                    'exists': True,
                    'user_name': user.get_full_name() or user.username,
                    'user_email': user.email,
                    'is_active': user.is_active,
                    'message': 'User found'
                }
            
            # Check if user exists with different role
            user_any_role = User.objects.filter(email__iexact=email).first()
            if user_any_role and role:
                return {
                    'exists': False,
                    'message': f'No account found with this email for the selected role. '
                              f'You may have registered with a different role.'
                }
            
            return {
                'exists': False,
                'message': 'No account found with this email'
            }
        except Exception as e:
            return {
                'exists': False,
                'message': f'Error checking user: {str(e)}'
            }
    
    @staticmethod
    def authenticate_user(email, password, role=None):
        """
        Authenticate user with email and password.
        
        Args:
            email: User's email
            password: User's password
            role: Expected role (optional)
            
        Returns:
            dict: {success: bool, user: User, redirect_url: str, message: str}
        """
        try:
            # Find user by email
            user = User.objects.filter(email__iexact=email).first()
            
            if not user:
                return {
                    'success': False,
                    'message': 'No account found with this email'
                }
            
            # Check role if specified
            if role and user.role != role:
                return {
                    'success': False,
                    'message': 'This account is not registered with the selected role'
                }
            
            # Check if user is active
            if not user.is_active:
                return {
                    'success': False,
                    'message': 'Your account has been deactivated. Please contact support.'
                }
            
            # Authenticate with username (Django's default)
            authenticated_user = authenticate(username=user.username, password=password)
            
            if authenticated_user is None:
                return {
                    'success': False,
                    'message': 'Invalid password. Please try again.'
                }
            
            # Get redirect URL based on role
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
                'message': f'Authentication error: {str(e)}'
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
        email_hash = hashlib.md5(email.lower().encode()).hexdigest()
        return f'otp_{email_hash}'
    
    @staticmethod
    def _get_otp_attempts_key(email):
        """Generate a cache key for tracking OTP attempts."""
        email_hash = hashlib.md5(email.lower().encode()).hexdigest()
        return f'otp_attempts_{email_hash}'
    
    @staticmethod
    def _get_reset_token_key(email):
        """Generate a cache key for reset token storage."""
        email_hash = hashlib.md5(email.lower().encode()).hexdigest()
        return f'reset_token_{email_hash}'
    
    @staticmethod
    def generate_otp():
        """Generate a cryptographically secure random 6-digit OTP."""
        return ''.join(secrets.choice(string.digits) for _ in range(OTP_LENGTH))
    
    @staticmethod
    def generate_reset_token():
        """Generate a cryptographically secure reset token."""
        return secrets.token_urlsafe(32)
    
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
            # Check if user exists
            user = User.objects.filter(email__iexact=email).first()
            if not user:
                return {
                    'success': False,
                    'message': 'No account found with this email'
                }
            
            # Generate OTP
            otp = cls.generate_otp()
            cache_key = cls._get_otp_cache_key(email)
            
            # Store OTP in cache with expiry
            cache.set(cache_key, {
                'otp': otp,
                'email': email.lower(),
                'created_at': timezone.now().isoformat()
            }, timeout=OTP_EXPIRY_MINUTES * 60)
            
            # Reset attempts counter
            attempts_key = cls._get_otp_attempts_key(email)
            cache.set(attempts_key, 0, timeout=OTP_EXPIRY_MINUTES * 60)
            
            # Send email (or just log in development)
            if settings.DEBUG:
                logger.info("[DEV] OTP for %s: %s", email, otp)
                return {
                    'success': True,
                    'message': f'OTP sent to {email}',
                    'dev_otp': otp  # Only in debug mode
                }
            else:
                # Production: Send actual email
                try:
                    send_mail(
                        subject='Password Reset OTP - Adarsh Admin',
                        message=f'''Hello {user.get_full_name() or user.username},

Your OTP for password reset is: {otp}

This OTP is valid for {OTP_EXPIRY_MINUTES} minutes.

If you did not request this, please ignore this email.

Thanks,
Adarsh Admin Team''',
                        from_email=settings.DEFAULT_FROM_EMAIL,
                        recipient_list=[email],
                        fail_silently=False,
                    )
                    return {
                        'success': True,
                        'message': f'OTP sent to {email}'
                    }
                except Exception as e:
                    return {
                        'success': False,
                        'message': f'Failed to send email: {str(e)}'
                    }
                    
        except Exception as e:
            return {
                'success': False,
                'message': f'Error generating OTP: {str(e)}'
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
            cache_key = cls._get_otp_cache_key(email)
            attempts_key = cls._get_otp_attempts_key(email)
            
            # Get stored OTP data
            otp_data = cache.get(cache_key)
            
            if not otp_data:
                return {
                    'success': False,
                    'message': 'OTP has expired. Please request a new one.'
                }
            
            # Check attempts
            attempts = cache.get(attempts_key, 0)
            if attempts >= OTP_MAX_ATTEMPTS:
                # Clear OTP after max attempts
                cache.delete(cache_key)
                return {
                    'success': False,
                    'message': 'Too many failed attempts. Please request a new OTP.'
                }
            
            # Verify OTP
            if otp_data['otp'] != otp:
                # Increment attempts
                cache.set(attempts_key, attempts + 1, timeout=OTP_EXPIRY_MINUTES * 60)
                remaining = OTP_MAX_ATTEMPTS - attempts - 1
                return {
                    'success': False,
                    'message': f'Invalid OTP. {remaining} attempt(s) remaining.'
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
            return {
                'success': False,
                'message': f'Error verifying OTP: {str(e)}'
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
            token_key = cls._get_reset_token_key(email)
            token_data = cache.get(token_key)
            
            if not token_data:
                return {
                    'success': False,
                    'message': 'Reset session expired. Please start again.'
                }
            
            if token_data['token'] != reset_token:
                return {
                    'success': False,
                    'message': 'Invalid reset token. Please start again.'
                }
            
            # Get user and update password
            user = User.objects.filter(email__iexact=email).first()
            if not user:
                return {
                    'success': False,
                    'message': 'User not found'
                }
            
            # Validate password against Django AUTH_PASSWORD_VALIDATORS
            from django.contrib.auth.password_validation import validate_password
            try:
                validate_password(new_password, user=user)
            except Exception as validation_error:
                return {
                    'success': False,
                    'message': '; '.join(validation_error.messages)
                }

            # Set new password
            user.set_password(new_password)
            user.save()
            
            # Clear reset token
            cache.delete(token_key)
            
            return {
                'success': True,
                'message': 'Password reset successfully. You can now login with your new password.'
            }
            
        except Exception as e:
            return {
                'success': False,
                'message': f'Error resetting password: {str(e)}'
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
                'message': f'Error setting up groups: {str(e)}'
            }
    
    @staticmethod
    def get_role_display_name(role):
        """Get human-readable role name."""
        role_display = {
            'super_admin': 'Super Admin',
            'admin_staff': 'Admin Staff',
            'client': 'Client',
            'client_staff': 'Client Staff',
        }
        return role_display.get(role, role)
