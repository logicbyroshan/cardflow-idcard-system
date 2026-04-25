import logging
from django.utils import timezone
from .models import UserDeviceSession

logger = logging.getLogger(__name__)

class DeviceSessionMiddleware:
    """
    Middleware to keep UserDeviceSession records in sync with user activity.
    Updates 'last_active' timestamp on every authenticated request.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # We only care about authenticated users with active sessions
        if request.user.is_authenticated and request.session.session_key:
            now = timezone.now()
            last_update = request.session.get('_last_device_session_update')

            # IMPROVED: Throttle updates to once every 60 seconds to reduce DB load
            if not last_update or (now.timestamp() - float(last_update)) > 60:
                try:
                    updated = UserDeviceSession.objects.filter(
                        session_key=request.session.session_key
                    ).update(last_active=now)
                    
                    if updated:
                        request.session['_last_device_session_update'] = now.timestamp()
                except Exception as e:
                    logger.error(f"Error updating device session activity: {e}")

        response = self.get_response(request)
        return response
