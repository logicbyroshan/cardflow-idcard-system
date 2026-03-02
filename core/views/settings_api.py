"""
Settings API Views
==================
Profile management views for all user roles.

Architecture rule: Views are ULTRA-THIN.
  - Validate request (parse POST/FILES/JSON)
  - Call UserProfileService method
  - Return JsonResponse
  - NO .save(), .set_password(), os.remove() — all in service layer
"""
import json
import logging
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.contrib.auth import update_session_auth_hash

from core.services.user_profile_service import UserProfileService
from accounts.rate_limit import rate_limit

logger = logging.getLogger(__name__)


@login_required
@require_http_methods(["GET"])
def api_get_profile(request):
    """Get current user's profile data."""
    user = request.user
    return JsonResponse({
        'success': True,
        'profile': {
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'full_name': user.get_full_name() or user.username,
            'phone': getattr(user, 'phone', '') or '',
            'role': getattr(user, 'role', 'client'),
            'role_display': user.get_role_display() if hasattr(user, 'get_role_display') else user.role,
            'profile_image': None,  # profile_image removed in Phase 1 refactor
            'member_since': user.date_joined.strftime('%b %Y') if user.date_joined else '',
        }
    })


@login_required
@require_http_methods(["POST"])
def api_update_profile(request):
    """Update current user's profile data."""
    try:
        data = json.loads(request.body)
        success, message, profile_data = UserProfileService.update_profile(request.user, data)
        if not success:
            return JsonResponse({'success': False, 'message': message})
        return JsonResponse({
            'success': True,
            'message': message,
            'profile': profile_data,
        })
    except Exception as e:
        logger.exception("Settings API error (update_profile): %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'})


@login_required
@require_http_methods(["POST"])
@rate_limit(max_requests=5, window_seconds=300, key_prefix='password_change')
def api_change_password(request):
    """Change current user's password."""
    try:
        data = json.loads(request.body)
        success, message = UserProfileService.change_password(
            request.user,
            data.get('current_password'),
            data.get('new_password'),
        )
        if success:
            update_session_auth_hash(request, request.user)
        return JsonResponse({'success': success, 'message': message})
    except Exception as e:
        logger.exception("Settings API error (change_password): %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'})


@login_required
@require_http_methods(["POST"])
@rate_limit(max_requests=10, window_seconds=60, key_prefix='profile_image')
def api_upload_profile_image(request):
    """Upload profile image."""
    try:
        success, message, image_url = UserProfileService.upload_profile_image(
            request.user,
            request.FILES.get('profile_image'),
        )
        response = {'success': success, 'message': message}
        if image_url:
            response['image_url'] = image_url
        return JsonResponse(response)
    except Exception as e:
        logger.exception("Settings API error (upload_profile_image): %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'})


@login_required
@require_http_methods(["POST"])
def api_remove_profile_image(request):
    """Remove profile image."""
    try:
        success, message = UserProfileService.remove_profile_image(request.user)
        return JsonResponse({'success': success, 'message': message})
    except Exception as e:
        logger.exception("Settings API error (remove_profile_image): %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'})


__all__ = [
    'api_get_profile',
    'api_update_profile',
    'api_change_password',
    'api_upload_profile_image',
    'api_remove_profile_image',
]

