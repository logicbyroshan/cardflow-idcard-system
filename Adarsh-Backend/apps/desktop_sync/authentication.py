"""
Desktop API Key Authentication for DRF.

Desktop software sends:  X-Desktop-Key: dsk_<token>
No JWT. No user session. Org-scoped access only.
"""
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from apps.desktop_sync.models import DesktopApiKey


class DesktopKeyAuthentication(BaseAuthentication):
    """
    DRF authentication class that validates X-Desktop-Key header.
    On success, returns (desktop_api_key, None) — no User object.
    """
    HEADER = 'HTTP_X_DESKTOP_KEY'

    def authenticate(self, request):
        raw_key = request.META.get(self.HEADER)
        if not raw_key:
            return None  # Let other authenticators try

        key_obj = DesktopApiKey.authenticate(raw_key)
        if not key_obj:
            raise AuthenticationFailed("Invalid or inactive desktop API key.")

        return (key_obj, None)

    def authenticate_header(self, request):
        return 'DesktopKey realm="desktop"'


class IsDesktopAuthenticated:
    """
    DRF permission: request.user must be a DesktopApiKey instance.
    Use as permission_classes = [IsDesktopAuthenticated].
    """
    def has_permission(self, request, view):
        return isinstance(request.user, DesktopApiKey)

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)
