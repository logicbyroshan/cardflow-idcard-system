"""
URL Configuration — Admin Panel (panel.adarshbhopal.in)

This URL conf is activated by SubdomainRoutingMiddleware when the
request arrives on the PANEL_DOMAIN.  Routes are at the ROOT level
(no /panel/ prefix) because the subdomain itself identifies this as
the admin panel.

Backward compatibility: The middleware silently rewrites incoming
/panel/… paths to /… so that any hardcoded /panel/ references in
JS, templates, or Python code continue to work transparently.

SEO: This entire domain is blocked from indexing via:
  - robots.txt below (Disallow: /)
  - X-Robots-Tag header (SecurityHeadersMiddleware)
  - <meta name="robots" content="noindex, nofollow"> in base.html

For local development (single domain), config/urls.py is used instead.
"""
import os
import sys

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.http import HttpResponse, FileResponse, Http404
from django.views.decorators.cache import cache_page
from django.views.decorators.http import require_GET
from core.views.health import health_check
from website import views as website_views


@require_GET
@cache_page(60 * 60 * 24)  # Cache for 24 hours — never changes
def panel_robots_txt(request):
    """Allow ALL crawlers to index the panel subdomain as per user request."""
    return HttpResponse(
        "User-agent: *\nDisallow: /\n",
        content_type="text/plain",
    )


def _protected_media_serve(request, path, document_root=None):
    """
    Serve media files with access control for sensitive directories.

    In production (DEBUG=False), protected files are served by Nginx via
    X-Accel-Redirect — Django only performs the auth check then hands off.
    Nginx must have the `location /protected-media/` block marked `internal;`
    (see deployment/nginx_example.conf).

    In development (DEBUG=True), Django's `serve()` is used as a fallback.
    """
    from django.http import HttpResponse
    from django.views.static import serve
    from django.urls import reverse
    from django.contrib.auth.views import redirect_to_login
    from core.models import BackgroundTask
    from core.services.permission_service import PermissionService

    def _normalize_media_path(raw_path):
        parts = []
        for part in str(raw_path or '').replace('\\', '/').split('/'):
            part = part.strip()
            if not part or part == '.':
                continue
            if part == '..':
                return ''
            parts.append(part)
        return '/'.join(parts)

    rel_path = _normalize_media_path(path)
    if not rel_path:
        return HttpResponse(status=404)

    PROTECTED_PREFIXES = (
        'adarshimg/',
        'exports/',
        'clients_imgs/',
        'staff_imgs/',
        'temp/',
    )
    if any(rel_path.startswith(p) for p in PROTECTED_PREFIXES):
        if not request.user.is_authenticated:
            # Redirect to login, preserving the original URL in ?next=
            # so the user is returned here after successful authentication.
            login_url = reverse('accounts:login')
            return redirect_to_login(request.get_full_path(), login_url=login_url)

        # Keep authz parity with config/urls.py to prevent cross-tenant file access.
        if not PermissionService.is_super_admin(request.user):
            if rel_path.startswith('adarshimg/'):
                from client.models import Client

                parts = rel_path.split('/')
                folder_code = ''
                if len(parts) >= 3 and parts[1].lower() == 'thumbs':
                    folder_code = parts[2]
                elif len(parts) >= 2:
                    folder_code = parts[1]

                client = Client.objects.filter(image_folder_code=folder_code).only('id').first() if folder_code else None
                if not client or not PermissionService.can_access_client(request.user, client.id):
                    return HttpResponse(status=404)

            # For async export files, only the owning user can access.
            # Check both 'exports/' and 'temp/exports/' prefixes since async
            # exports are stored under temp/exports/.
            # Normalize stored result_path to forward slashes for cross-platform
            # compatibility (os.path.relpath uses backslashes on Windows).
            elif rel_path.startswith('exports/') or rel_path.startswith('temp/exports/'):
                from django.db.models import Q
                normalized_path = rel_path.replace('\\', '/')
                owns_file = BackgroundTask.objects.filter(
                    user=request.user,
                ).filter(
                    Q(result_path=normalized_path) |
                    Q(result_path=normalized_path.replace('/', '\\'))
                ).exists()
                if not owns_file:
                    return HttpResponse(status=404)

            elif not PermissionService.is_any_admin(request.user):
                return HttpResponse(status=404)

    # Production with Nginx: serve via X-Accel-Redirect (zero-copy, non-blocking).
    # Requires MEDIA_USE_XACCEL=true in env AND the Nginx internal
    # /protected-media/ location block (see deployment/nginx_example.conf).
    if getattr(settings, 'MEDIA_USE_XACCEL', False):
        response = HttpResponse()
        response['X-Accel-Redirect'] = f'/protected-media/{rel_path}'
        response['Content-Type'] = ''  # let Nginx detect from file extension
        return response

    # Fallback: Django serves the file directly (dev + prod without X-Accel)
    response = serve(request, rel_path, document_root=document_root)

    # Super Mode can use larger stream blocks for protected downloads.
    if hasattr(response, 'block_size') and getattr(request, 'user', None) and request.user.is_authenticated:
        try:
            from core.services.super_mode_service import SuperModeService

            response.block_size = SuperModeService.download_block_size_bytes(request.user)
        except Exception:
            pass

    return response



urlpatterns = [
    # Health check — no auth, used by load balancers / CI/CD
    path('api/health/', health_check, name='health_check'),

    # Panel PWA endpoints (same payload logic, host-aware inside the view).
    path('manifest.json', website_views.pwa_manifest, name='panel_pwa_manifest'),
    path('sw.js', website_views.pwa_service_worker, name='panel_pwa_service_worker'),

    path('robots.txt', panel_robots_txt, name='panel_robots_txt'),

    # Django admin
    path('admin/', admin.site.urls),

    # Local-only debug toolbar route for panel subdomain development.
    # The toolbar package is optional in production, so only register it when
    # DEBUG is enabled and the package can be imported.

    # ==================== ADMIN PANEL (root — no /panel/ prefix) ==========
    path('', include('core.urls')),
    path('auth/', include('accounts.urls')),
    path('client/', include('client.urls')),
    path('exports/', include('exports.urls')),
    path('images/', include('mediafiles.urls')),
    path('staff/', include('staff.urls')),
    path('work/', include('idcards.urls')),
    path('reprint/', include('reprintcard.urls')),
    # ==================== PWA MOBILE APP (/app/) ====================
    path('app/', include('mobile_app.urls')),
    
    # ==================== NATIVE MOBILE APP API (/api/mobile/) ====================
    path('api/mobile/', include('mobile_api.urls')),
]

def _running_tests():
    return os.getenv('RUNNING_TESTS', '').lower() in ('1', 'true', 'yes', 'on') or any(
        mod.startswith('_pytest') for mod in sys.modules
    )

if getattr(settings, 'DEBUG', False) and not _running_tests():
    try:
        import debug_toolbar  # noqa: F401
    except Exception:
        pass
    else:
        urlpatterns.insert(6, path('__debug__/', include('debug_toolbar.urls')))

# Media file serving (with auth for protected dirs)
urlpatterns += [
    path('media/<path:path>', _protected_media_serve, {'document_root': settings.MEDIA_ROOT}),
]

handler400 = 'core.views.errors.error_400'
handler403 = 'core.views.errors.error_403'
handler404 = 'core.views.errors.error_404'
handler500 = 'core.views.errors.error_500'
