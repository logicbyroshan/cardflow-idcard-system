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
        "# Block admin & internal routes",
        "Disallow: /panel/",
        "Disallow: /admin/",
        "Disallow: /api/",
        "Disallow: /auth/",
        "Disallow: /submit-contact/",
        "Disallow: /submit-testimonial/",
        "",
        f"Sitemap: {site_url}/sitemap.xml",
    ]
    return HttpResponse("\n".join(lines), content_type="text/plain")


@require_GET
@cache_page(60 * 60)  # Cache for 1 hour
def sitemap_xml(request):
    """
    Serve a basic sitemap.xml for public website pages only.
    Only includes safe, public-facing pages.
    """
    site_url = _get_site_url(request)

    pages = [
        {"loc": "/", "changefreq": "weekly", "priority": "1.0"},
        {"loc": reverse("website:our_work"), "changefreq": "weekly", "priority": "0.8"},
        {"loc": reverse("website:why_choose_us"), "changefreq": "monthly", "priority": "0.7"},
        {"loc": reverse("website:testimonials"), "changefreq": "monthly", "priority": "0.6"},
        {"loc": reverse("website:privacy_policy"), "changefreq": "yearly", "priority": "0.3"},
    ]

    xml_entries = []
    for page in pages:
        xml_entries.append(
            f"  <url>\n"
            f"    <loc>{site_url}{page['loc']}</loc>\n"
            f"    <changefreq>{page['changefreq']}</changefreq>\n"
            f"    <priority>{page['priority']}</priority>\n"
            f"  </url>"
        )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(xml_entries)
        + "\n</urlset>\n"
    )
    return HttpResponse(xml, content_type="application/xml")


def _get_site_url(request):
    """Get canonical site URL from settings or request."""
    site_url = getattr(settings, 'SITE_URL', '').rstrip('/')
    if not site_url or site_url == 'http://localhost:8000':
        # Build from request in dev
        site_url = f"{request.scheme}://{request.get_host()}"
    return site_url
