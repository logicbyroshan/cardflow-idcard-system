"""
Settings API Views
Profile management views for all user roles.
"""
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.contrib.auth import update_session_auth_hash
import json
import os


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
            'profile_image': user.profile_image.url if getattr(user, 'profile_image', None) and user.profile_image else None,
            'member_since': user.date_joined.strftime('%b %Y') if user.date_joined else '',
        }
    })


@login_required
@require_http_methods(["POST"])
def api_update_profile(request):
    """Update current user's profile data (first_name, last_name, username, email, phone)."""
    try:
        data = json.loads(request.body)
        user = request.user
        
        if 'first_name' in data:
            user.first_name = data['first_name'].strip()
        if 'last_name' in data:
            user.last_name = data['last_name'].strip()
        if 'username' in data and data['username'].strip():
            new_username = data['username'].strip()
            # Check uniqueness (exclude self)
            from core.models import User
            if User.objects.filter(username=new_username).exclude(id=user.id).exists():
                return JsonResponse({'success': False, 'message': 'Username already taken'})
            user.username = new_username
        if 'email' in data and data['email'].strip():
            new_email = data['email'].strip()
            from core.models import User
            if User.objects.filter(email=new_email).exclude(id=user.id).exists():
                return JsonResponse({'success': False, 'message': 'Email already in use'})
            user.email = new_email
        if 'phone' in data:
            user.phone = data['phone'].strip()
        
        user.save()
        return JsonResponse({
            'success': True,
            'message': 'Profile updated',
            'profile': {
                'full_name': user.get_full_name() or user.username,
                'email': user.email,
                'username': user.username,
            }
        })
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)})


@login_required
@require_http_methods(["POST"])
def api_change_password(request):
    """Change current user's password."""
    try:
        data = json.loads(request.body)
        user = request.user
        
        current_password = data.get('current_password')
        new_password = data.get('new_password')
        
        if not current_password or not new_password:
            return JsonResponse({'success': False, 'message': 'Both current and new password are required'})
        
        if not user.check_password(current_password):
            return JsonResponse({'success': False, 'message': 'Current password is incorrect'})
        
        if len(new_password) < 6:
            return JsonResponse({'success': False, 'message': 'Password must be at least 6 characters'})
        
        user.set_password(new_password)
        user.save()
        # Keep the session valid after password change
        update_session_auth_hash(request, user)
        return JsonResponse({'success': True, 'message': 'Password changed successfully'})
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)})


@login_required
@require_http_methods(["POST"])
def api_upload_profile_image(request):
    """Upload profile image."""
    try:
        image_file = request.FILES.get('profile_image')
        if not image_file:
            return JsonResponse({'success': False, 'message': 'No image file provided'})
        
        # Validate file type
        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        if image_file.content_type not in allowed_types:
            return JsonResponse({'success': False, 'message': 'Invalid file type. Use JPEG, PNG, GIF, or WebP.'})
        
        # Validate file size (5MB)
        if image_file.size > 5 * 1024 * 1024:
            return JsonResponse({'success': False, 'message': 'File too large. Maximum 5MB.'})
        
        user = request.user
        # Delete old image if it exists
        if user.profile_image:
            old_path = user.profile_image.path
            if os.path.exists(old_path):
                os.remove(old_path)
        
        user.profile_image = image_file
        user.save()
        
        return JsonResponse({
            'success': True,
            'message': 'Profile image updated',
            'image_url': user.profile_image.url,
        })
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)})


@login_required
@require_http_methods(["POST"])
def api_remove_profile_image(request):
    """Remove profile image."""
    try:
        user = request.user
        if user.profile_image:
            old_path = user.profile_image.path
            if os.path.exists(old_path):
                os.remove(old_path)
            user.profile_image = None
            user.save()
            return JsonResponse({'success': True, 'message': 'Profile image removed'})
        return JsonResponse({'success': False, 'message': 'No profile image to remove'})
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)})


__all__ = [
    'api_get_profile',
    'api_update_profile',
    'api_change_password',
    'api_upload_profile_image',
    'api_remove_profile_image',
]

