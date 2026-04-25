from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.dispatch import receiver
from django.utils import timezone
from django.contrib.sessions.models import Session
from .models import UserDeviceSession

def get_client_ip(request):
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip

def get_device_type(request):
    # IMPROVED: Highest priority to explicit client header
    client_type = request.headers.get('X-Client-Type', '').lower()
    if client_type in ('mobile', 'web'):
        return client_type

    ua = request.META.get('HTTP_USER_AGENT', '').lower()
    # Check if this is the mobile app surface or explicitly marked as mobile app
    if request.path.startswith('/app/') or request.headers.get('X-Mobile-App') == 'true':
        return 'mobile'
    
    # Common mobile indicators in User-Agent
    mobile_indicators = ['android', 'iphone', 'ipad', 'webos', 'iemobile', 'opera mini']
    if any(ind in ua for ind in mobile_indicators):
        return 'mobile'
    
    return 'web'

def get_limits(user):
    """
    Define session limits based on user role.
    PRO USER -> 5 web + 5 mobile
    ADMIN -> 2 web + 2 mobile
    NORMAL USER -> 1 web + 1 mobile
    """
    role = getattr(user, 'role', 'client')
    if user.is_superuser or role in ('super_admin', 'admin_staff'):
        return {'web': 2, 'mobile': 2}
    if role == 'pro_user':
        return {'web': 5, 'mobile': 5}
    # Default for 'client', 'client_staff' or unknown
    return {'web': 1, 'mobile': 1}

@receiver(user_logged_in)
def manage_user_device_sessions(sender, request, user, **kwargs):
    """
    Hook into login to record the session and enforce device-type limits.
    Uses atomic transaction and select_for_update to prevent race conditions.
    """
    if not user or not user.id:
        return

    from django.db import transaction
    import logging
    logger = logging.getLogger(__name__)

    # Ensure session exists
    if not request.session.session_key:
        request.session.create()
    
    session_key = request.session.session_key
    device_type = get_device_type(request)

    try:
        with transaction.atomic():
            # 1. Record/Update current device session
            UserDeviceSession.objects.update_or_create(
                session_key=session_key,
                defaults={
                    'user': user,
                    'device_type': device_type,
                    'user_agent': request.META.get('HTTP_USER_AGENT', '')[:500],
                    'ip_address': get_client_ip(request),
                    'last_active': timezone.now()
                }
            )

            # 2. Enforce limits for this device type
            limits = get_limits(user)
            limit = limits.get(device_type, 1)

            # UPDATED: Use select_for_update and only() for high performance and race protection
            active_sessions = UserDeviceSession.objects.select_for_update().filter(
                user=user,
                device_type=device_type
            ).only('id', 'session_key').order_by('-last_active')

            if active_sessions.count() > limit:
                # Identify oldest sessions to revoke
                stale_entries = active_sessions[limit:]
                from django.core.cache import cache
                for entry in stale_entries:
                    try:
                        # Revoke Django session
                        Session.objects.filter(session_key=entry.session_key).delete()
                        
                        # Clear from cache (standard Django prefix pattern)
                        cache.delete(f"django.contrib.sessions.cache{entry.session_key}")
                        
                        logger.info(f"Revoked session {entry.session_key[:8]} for user {user.username} (Limit hit)")
                        entry.delete()
                    except Exception:
                        pass
    except Exception as e:
        # FAIL GRACEFULLY: Do not block the user from logging in if session tracking fails
        logger.error(f"Failed to enforce session limits for {user.username}: {e}")

@receiver(user_logged_out)
def cleanup_device_session(sender, request, user, **kwargs):
    """Remove the device session record upon manual logout."""
    session_key = request.session.session_key
    if session_key:
        UserDeviceSession.objects.filter(session_key=session_key).delete()
