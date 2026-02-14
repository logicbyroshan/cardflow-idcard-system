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
    def change_password(user, current_password, new_password):
        """
        Change user's password after validating current password.
        Returns (success: bool, message: str).
        """
        if not current_password or not new_password:
            return False, 'Both current and new password are required'

        if not user.check_password(current_password):
            return False, 'Current password is incorrect'

        if len(new_password) < 6:
            return False, 'Password must be at least 6 characters'

        user.set_password(new_password)
        user.save()
        return True, 'Password changed successfully'

    @staticmethod
    def upload_profile_image(user, image_file):
        """
        Upload/replace the user's profile image.
        Returns (success: bool, message: str, image_url: str|None).
        """
        if not image_file:
            return False, 'No image file provided', None

        if image_file.content_type not in ALLOWED_IMAGE_TYPES:
            return False, 'Invalid file type. Use JPEG, PNG, GIF, or WebP.', None

        if image_file.size > MAX_IMAGE_SIZE:
            return False, 'File too large. Maximum 5MB.', None

        with transaction.atomic():
            # Delete old image file
            if user.profile_image:
                try:
                    old_path = user.profile_image.path
                    if os.path.exists(old_path):
                        os.remove(old_path)
                except Exception:
                    logger.warning(f"Could not delete old profile image for user {user.id}")

            user.profile_image = image_file
            user.save()

        return True, 'Profile image updated', user.profile_image.url

    @staticmethod
    def remove_profile_image(user):
        """
        Remove the user's profile image.
        Returns (success: bool, message: str).
        """
        if not user.profile_image:
            return False, 'No profile image to remove'

        with transaction.atomic():
            try:
                old_path = user.profile_image.path
                if os.path.exists(old_path):
                    os.remove(old_path)
            except Exception:
                logger.warning(f"Could not delete profile image file for user {user.id}")

            user.profile_image = None
            user.save()

        return True, 'Profile image removed'
