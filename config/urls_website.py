"""
URL Configuration — Public Website (www.adarshbhopal.in)

This URL conf is activated by SubdomainRoutingMiddleware when the
request arrives on the WEBSITE_DOMAIN.  It contains ONLY public-facing
routes — no admin panel, no PWA, no Django admin.

For local development (single domain), config/urls.py is used instead.
"""
from django.conf import settings
from django.urls import path, include
from website import seo
from core.views.health import health_check


def _public_media_serve(request, path, document_root=None):
    """
    Serve media files on the public website.
    Only exposes directories needed for the public site (portfolio images,
    business logos, hero images, reels). Protected directories are NOT served.
    """
    from django.views.static import serve
    from django.http import HttpResponseNotFound

    # Only allow public media directories on the website domain
    PUBLIC_PREFIXES = ('adarshimg/', 'images/', 'videos/')
    if not any(path.startswith(p) for p in PUBLIC_PREFIXES):
        return HttpResponseNotFound('Not found')
    return serve(request, path, document_root=document_root)


urlpatterns = [
    # Health check — no auth, used by load balancers / CI/CD
    path('api/health/', health_check, name='health_check'),

    # SEO (with error handling and caching)
    path('robots.txt', seo.robots_txt, name='robots_txt'),
    path('sitemap.xml', seo.sitemap_xml, name='sitemap_view'),

    # Public website at root
    path('', include('website.urls')),
]

# Media — only public directories (portfolio/hero images)
urlpatterns += [
    path('media/<path:path>', _public_media_serve, {'document_root': settings.MEDIA_ROOT}),
]

handler400 = 'core.views.errors.error_400'
handler403 = 'core.views.errors.error_403'
handler404 = 'core.views.errors.error_404'
handler500 = 'core.views.errors.error_500'
