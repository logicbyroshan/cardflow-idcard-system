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
import re

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.http import HttpResponse, JsonResponse, FileResponse, Http404
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

    PROTECTED_PREFIXES = (
        'adarshimg/',
        'exports/',
        'clients_imgs/',
        'staff_imgs/',
        'temp/',
    )
    if any(path.startswith(p) for p in PROTECTED_PREFIXES):
        if not request.user.is_authenticated:
            # Redirect to login, preserving the original URL in ?next=
            # so the user is returned here after successful authentication.
            login_url = reverse('accounts:login')
            return redirect_to_login(request.get_full_path(), login_url=login_url)

    # Production with Nginx: serve via X-Accel-Redirect (zero-copy, non-blocking).
    # Requires MEDIA_USE_XACCEL=true in env AND the Nginx internal
    # /protected-media/ location block (see deployment/nginx_example.conf).
    if getattr(settings, 'MEDIA_USE_XACCEL', False):
        response = HttpResponse()
        response['X-Accel-Redirect'] = f'/protected-media/{path}'
        response['Content-Type'] = ''  # let Nginx detect from file extension
        return response

    # Fallback: Django serves the file directly (dev + prod without X-Accel)
    return serve(request, path, document_root=document_root)


def _is_mobile_ua(request):
    """Quick mobile user-agent check."""
    ua = request.META.get('HTTP_USER_AGENT', '')
    return bool(re.search(
        r'Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini',
        ua, re.I,
    ))


@require_GET
def panel_manifest_json(request):
    """
    Serve the PWA manifest dynamically for the panel subdomain.

    Mobile devices  → mobile app manifest  (start_url: /app/)
    Desktop devices → admin panel manifest (start_url: /auth/login/)

    Both use scope '/' so that login redirects stay inside the PWA
    standalone window.
    """
    if _is_mobile_ua(request):
        # Mobile → ID Card Manager (mobile app)
        manifest = {
            'name': 'ID Card Manager',
            'short_name': 'IDCard',
            'description': 'Mobile ID Card Management System',
            'start_url': '/app/',
            'scope': '/',
            'id': '/app/',
            'display': 'standalone',
            'background_color': '#667eea',
            'theme_color': '#667eea',
            'orientation': 'portrait',
            'prefer_related_applications': False,
            'categories': ['business', 'productivity'],
            'icons': [
                {
                    'src': '/static/mobile/images/icon-192.png',
                    'sizes': '192x192',
                    'type': 'image/png',
                    'purpose': 'any',
                },
                {
                    'src': '/static/mobile/images/icon-192.png',
                    'sizes': '192x192',
                    'type': 'image/png',
                    'purpose': 'maskable',
                },
                {
                    'src': '/static/mobile/images/icon-512.png',
                    'sizes': '512x512',
                    'type': 'image/png',
                    'purpose': 'any',
                },
                {
                    'src': '/static/mobile/images/icon-512.png',
                    'sizes': '512x512',
                    'type': 'image/png',
                    'purpose': 'maskable',
                },
            ],
        }
    else:
        # Desktop → Admin Panel
        manifest_path = os.path.join(settings.BASE_DIR, 'static', 'website', 'manifest.json')
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            raise Http404

        # Override for the admin panel PWA on panel subdomain
        manifest['name'] = 'Adarsh ID Cards - Admin Panel'
        manifest['short_name'] = 'Adarsh Admin'
        manifest['description'] = 'Manage ID cards, clients, staff and orders'
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


def _serve_mobile_sw(request):
    """Serve the mobile PWA service worker with correct scope header."""
    filepath = os.path.join(settings.BASE_DIR, 'static', 'mobile', 'sw.js')
    if not os.path.isfile(filepath):
        raise Http404
    response = FileResponse(open(filepath, 'rb'), content_type='application/javascript')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-cache'
    return response


urlpatterns = [
    # Health check — no auth, used by load balancers / CI/CD
    path('api/health/', health_check, name='health_check'),

    # Versioned API — new endpoints go in config/urls_api_v1.py
    path('api/v1/', include('config.urls_api_v1', namespace='v1')),
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
    path('work/', include('idcards.urls')),
    path('website/', include('website.admin_urls')),
    path('print/', include('cardprint.urls')),
    path('reprint/', include('reprintcard.urls')),

    # ==================== PWA MOBILE APP (/app/) ====================
    # Mobile manifest & SW served via Django for correct headers
    path('app/manifest.json', panel_manifest_json, name='mobile_pwa_manifest'),
    path('app/sw.js', _serve_mobile_sw, name='mobile_pwa_sw'),
    path('app/', include('mobile_app.urls')),
]

# Media file serving (with auth for protected dirs)
urlpatterns += [
    path('media/<path:path>', _protected_media_serve, {'document_root': settings.MEDIA_ROOT}),
]
