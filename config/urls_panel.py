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
import json
import os

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.http import HttpResponse, HttpResponseForbidden, JsonResponse, FileResponse, Http404
from django.views.decorators.cache import cache_page
from django.views.decorators.http import require_GET
from core.views.health import health_check


@require_GET
@cache_page(60 * 60 * 24)  # Cache for 24 hours — never changes
def panel_robots_txt(request):
    """Block ALL crawlers from the panel subdomain."""
    return HttpResponse(
        "User-agent: *\nDisallow: /\n",
        content_type="text/plain",
    )


def _protected_media_serve(request, path, document_root=None):
    """
    Serve media files with access control for sensitive directories.
    Same logic as config/urls.py — see docstring there.
    """
    from django.views.static import serve
    PROTECTED_PREFIXES = ('exports/', 'clients_imgs/', 'staff_imgs/', 'temp/')
    if any(path.startswith(p) for p in PROTECTED_PREFIXES):
        if not request.user.is_authenticated:
            return HttpResponseForbidden('Access denied')
    return serve(request, path, document_root=document_root)


@require_GET
def panel_manifest_json(request):
    """
    Serve the PWA manifest dynamically for the panel subdomain.

    Uses the static manifest as base but overrides start_url to the
    correct panel-subdomain path (no /panel/ prefix).
    """
    manifest_path = os.path.join(settings.BASE_DIR, 'static', 'website', 'manifest.json')
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        raise Http404

    # Override start_url for the panel subdomain (no /panel/ prefix)
    manifest['start_url'] = '/auth/login/'
    manifest['scope'] = '/'

    response = JsonResponse(manifest)
    response['Content-Type'] = 'application/manifest+json'
    return response


def _serve_panel_sw(request):
    """Serve the PWA service worker for the panel subdomain."""
    filepath = os.path.join(settings.BASE_DIR, 'static', 'website', 'sw.js')
    if not os.path.isfile(filepath):
        raise Http404
    response = FileResponse(open(filepath, 'rb'), content_type='application/javascript')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-cache'
    return response


urlpatterns = [
    # Health check — no auth, used by load balancers / CI/CD
    path('api/health/', health_check, name='health_check'),

    # SEO — block all crawlers on panel subdomain
    path('robots.txt', panel_robots_txt, name='panel_robots_txt'),

    # PWA — manifest and service worker at root scope
    path('manifest.json', panel_manifest_json, name='panel_pwa_manifest'),
    path('sw.js', _serve_panel_sw, name='panel_pwa_sw'),

    # Django admin
    path('admin/', admin.site.urls),

    # ==================== ADMIN PANEL (root — no /panel/ prefix) ==========
    path('', include('core.urls')),
    path('auth/', include('accounts.urls')),
    path('client/', include('client.urls')),
    path('exports/', include('exports.urls')),
    path('images/', include('mediafiles.urls')),
    path('staff/', include('staff.urls')),
    path('work/', include('workflows.urls')),
    path('website/', include('website.admin_urls')),

    # ==================== PWA MOBILE APP (/app/) ====================
    path('app/', include('PWA.mobile_app.urls')),
]

# Media file serving (with auth for protected dirs)
urlpatterns += [
    path('media/<path:path>', _protected_media_serve, {'document_root': settings.MEDIA_ROOT}),
]
