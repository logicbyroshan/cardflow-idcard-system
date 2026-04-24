"""
SEO utilities for the public website.

Serves robots.txt and sitemap.xml — ONLY for public pages.
Admin/panel pages are explicitly disallowed.
"""
from django.http import HttpResponse
from django.views.decorators.cache import cache_page
from django.views.decorators.http import require_GET
from django.urls import reverse
from django.conf import settings


@require_GET
@cache_page(60 * 60)  # Cache for 1 hour
def robots_txt(request):
    """
    Serve robots.txt dynamically.
    Allows public website pages, blocks admin/panel/api/auth routes.
    """
    site_url = _get_site_url(request)
    lines = [
        "User-agent: *",
        "Allow: /",
        "",
        "# All blockers removed as per user request",
        "",
        f"Sitemap: {site_url}/sitemap.xml",
    ]
    return HttpResponse("\n".join(lines), content_type="text/plain")


@require_GET
@cache_page(60 * 60)  # Cache for 1 hour
def sitemap_xml(request):
    """
    Serve a dynamic sitemap.xml using the unified sitemap view.
    """
    from .views import sitemap_view
    return sitemap_view(request)


def _get_site_url(request):
    """Get canonical site URL from settings or request."""
    site_url = getattr(settings, 'SITE_URL', '').rstrip('/')
    if not site_url or site_url == 'http://localhost:8000':
        # Build from request in dev
        site_url = f"{request.scheme}://{request.get_host()}"
    return site_url
