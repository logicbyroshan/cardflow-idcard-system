"""
URL Configuration — Admin Panel (panel.adarshbhopal.in)

This URL conf is activated by SubdomainRoutingMiddleware when the
request arrives on the PANEL_DOMAIN.  It contains the admin panel,
PWA mobile app, Django admin, and authenticated media serving.

SEO: This entire domain is blocked from indexing via:
  - robots.txt below (Disallow: /)
  - X-Robots-Tag header (SecurityHeadersMiddleware)
  - <meta name="robots" content="noindex, nofollow"> in base.html

For local development (single domain), config/urls.py is used instead.
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.http import HttpResponse, HttpResponseForbidden
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


urlpatterns = [
    # Health check — no auth, used by load balancers / CI/CD
    path('api/health/', health_check, name='health_check'),

    # SEO — block all crawlers on panel subdomain
    path('robots.txt', panel_robots_txt, name='panel_robots_txt'),

    # Django admin
    path('admin/', admin.site.urls),

    # ==================== ADMIN PANEL (/panel/) ====================
    path('panel/', include('core.urls')),
    path('panel/auth/', include('accounts.urls')),
    path('panel/client/', include('client.urls')),
    path('panel/exports/', include('exports.urls')),
    path('panel/images/', include('mediafiles.urls')),
    path('panel/staff/', include('staff.urls')),
    path('panel/work/', include('workflows.urls')),
    path('panel/website/', include('website.admin_urls')),

    # ==================== PWA MOBILE APP (/app/) ====================
    path('app/', include('PWA.mobile_app.urls')),
]

# Media file serving (with auth for protected dirs)
urlpatterns += [
    path('media/<path:path>', _protected_media_serve, {'document_root': settings.MEDIA_ROOT}),
]
