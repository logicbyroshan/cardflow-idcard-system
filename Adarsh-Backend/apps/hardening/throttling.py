from rest_framework.throttling import UserRateThrottle, AnonRateThrottle, SimpleRateThrottle
from shared.constants import Role
from apps.desktop_sync.models import DesktopApiKey

class ProRateThrottle(SimpleRateThrottle):
    """
    Dedicated rate limiter for platform-wide PRO_USER actions.
    Default limit configured via REST_FRAMEWORK settings.
    """
    scope = 'pro'

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated and request.user.role == Role.PRO_USER:
            return self.get_ident(request)
        return None


class HardenedUserRateThrottle(UserRateThrottle):
    """
    Standard authenticated user rate throttle.
    Hardened to exempt PRO_USER and Desktop keys so they don't consume standard user quotas.
    """
    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        if request.user.role == Role.PRO_USER:
            return None
        if isinstance(request.user, DesktopApiKey):
            return None
        return self.get_ident(request)


class HardenedAnonRateThrottle(AnonRateThrottle):
    """
    Standard anonymous rate throttle.
    """
    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return None
        return self.get_ident(request)
