"""Desktop API Throttling."""
from rest_framework.throttling import SimpleRateThrottle
from apps.desktop_sync.models import DesktopApiKey


class DesktopRateThrottle(SimpleRateThrottle):
    """
    Separate rate limiter for Desktop API Key clients.
    Exempt from standard User/Anon throttles.
    Allows 300 requests per minute by default, or configurable via settings.
    """
    scope = 'desktop'

    def __init__(self):
        # Safe fallback if DEFAULT_THROTTLE_RATES is cleared or missing in local/test settings
        from django.conf import settings
        drf = getattr(settings, 'REST_FRAMEWORK', {})
        rates = drf.get('DEFAULT_THROTTLE_RATES', {})
        if self.scope not in rates:
            rates[self.scope] = '300/min'
        super().__init__()

    def get_cache_key(self, request, view):
        if isinstance(request.user, DesktopApiKey):
            # Throttle by unique API key ID
            ident = str(request.user.id)
        else:
            # Fallback (should not be hit if authentication succeeded)
            ident = self.get_ident(request)

        return self.cache_format % {
            'scope': self.scope,
            'ident': ident
        }
