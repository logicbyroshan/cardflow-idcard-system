"""
User Profile Service
====================
Single authority for user profile mutations (update profile, change password,
manage profile image). Views must ONLY validate request → call service → return.

Architecture rule:
  - This service owns ALL profile-related mutations
  - No view may call user.save(), user.set_password(), os.remove() on profile images
  - All mutations go through UserProfileService methods
"""
import logging
import os

from django.db import transaction

logger = logging.getLogger(__name__)

# Allowed MIME types for profile images
ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5MB


class UserProfileService:
    """Manages user profile data: name, email, phone, password, profile image."""

    @staticmethod
    def update_profile(user, data):
        """
        Update user profile fields.
        data: dict with optional keys: first_name, last_name, username, email, phone.
        Returns (success: bool, message: str, profile_data: dict|None).
        """
        from core.models import User

        with transaction.atomic():
            if 'first_name' in data:
                user.first_name = data['first_name'].strip()
            if 'last_name' in data:
                user.last_name = data['last_name'].strip()

            if 'username' in data and data['username'].strip():
                new_username = data['username'].strip()
                if User.objects.filter(username=new_username).exclude(id=user.id).exists():
                    return False, 'Username already taken', None
                user.username = new_username

            if 'email' in data and data['email'].strip():
                new_email = data['email'].strip()
                if User.objects.filter(email=new_email).exclude(id=user.id).exists():
                    return False, 'Email already in use', None
                user.email = new_email

            if 'phone' in data:
                user.phone = data['phone'].strip()

            user.save()

        return True, 'Profile updated', {
            'full_name': user.get_full_name() or user.username,
            'email': user.email,
            'username': user.username,
        }

    @staticmethod
    def change_password(user, current_password, new_password, current_session_key=None):
        """
        Change user's password after validating current password.
        Uses Django AUTH_PASSWORD_VALIDATORS for strength checks.
        Returns (success: bool, message: str).
        """
        if not current_password or not new_password:
            return False, 'Both current and new password are required'

        if not user.check_password(current_password):
            return False, 'Current password is incorrect'

        # Use Django's password validators for consistent strength checks
        from django.contrib.auth.password_validation import validate_password
        try:
            validate_password(new_password, user=user)
        except Exception as e:
            return False, str(e)

        user.set_password(new_password)
        user.save()

        # Security hardening: revoke other active sessions after password change.
        try:
            from accounts.services import _revoke_user_sessions
            _revoke_user_sessions(user.pk, exclude_session_key=current_session_key or '')
        except Exception as exc:
            logger.warning('Password-change session revocation failed for user=%s: %s', user.pk, exc)

        return True, 'Password changed successfully'

    @staticmethod
    def upload_profile_image(user, image_file):
        """
        Upload/replace the user's profile image.
        Returns (success: bool, message: str, image_url: str|None).

        NOTE: profile_image field was removed from User model in Phase 1 refactor.
        This method is kept for backward compat but now returns an error.
        """
        return False, 'Profile image feature is no longer available. Avatars are generated automatically.', None

    @staticmethod
    def remove_profile_image(user):
        """
        Remove the user's profile image.
        Returns (success: bool, message: str).

        NOTE: profile_image field was removed from User model in Phase 1 refactor.
        This method is kept for backward compat but now returns an error.
        """
        return False, 'Profile image feature is no longer available.'
