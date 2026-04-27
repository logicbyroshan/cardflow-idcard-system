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
    Delegates to AuthService for centralized limit management.
    """
    from .services import AuthService
    raw_limits = AuthService.role_surface_limits(user)
    # Map 'desktop' key from service to 'web' key used in signal logic
    return {
        'web': raw_limits.get('desktop', 1),
        'mobile': raw_limits.get('mobile', 1)
    }

@receiver(user_logged_in)
def manage_user_device_sessions(sender, request, user, **kwargs):
    """
    Hook into login to record the session and enforce device-type limits.
    Uses atomic transaction and select_for_update to prevent race conditions.
    """
    if not user or not user.id:
        return

    # Impersonation transitions intentionally bypass global device-limit enforcement
    # so acting as a user from Pro mode does not log out that user's real devices.
    if getattr(request, '_skip_device_session_enforcement', False):
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
            # UPDATED: Ensure current session is explicitly marked as freshest
            UserDeviceSession.objects.filter(session_key=session_key).update(
                last_active=timezone.now()
            )

            # 2. Enforce limits for this device type
            limits = get_limits(user)
            limit = limits.get(device_type, 1)

            # UPDATED: Use select_for_update and only() for high performance and race protection
            active_sessions_qs = UserDeviceSession.objects.select_for_update().filter(
                user=user,
                device_type=device_type
            ).only('id', 'session_key', 'last_active').order_by('-last_active')

            # UPDATED Step 1: EXCLUDE current session BEFORE deletion to prevent immediate logout
            active_sessions = [s for s in active_sessions_qs if s.session_key != session_key]

            # UPDATED Step 2: Apply correct limit logic (if other sessions >= limit, remove oldest)
            if len(active_sessions) >= limit:
                stale_entries = active_sessions[limit-1:]
                from django.contrib.sessions.backends.db import SessionStore
                
                for entry in stale_entries:
                    try:
                        # UPDATED Step 3: Safe and thorough session deletion
                        # Delete DB session
                        Session.objects.filter(session_key=entry.session_key).delete()
                        
                        # Delete session properly from backend (robustly handles cache/db invalidation)
                        try:
                            SessionStore().delete(entry.session_key)
                        except Exception:
                            pass

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
