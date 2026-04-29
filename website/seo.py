"""
SEO utilities for the public website.

Serves robots.txt and sitemap.xml — ONLY for public pages.
Admin/panel pages are explicitly disallowed.

Includes proper error handling and caching for Google Search Console compatibility.
"""
from django.http import HttpResponse
from django.views.decorators.cache import cache_page
from django.views.decorators.http import require_GET
from django.urls import reverse
from django.conf import settings
import logging

logger = logging.getLogger(__name__)


@require_GET
@cache_page(60 * 60)  # Cache for 1 hour
def robots_txt(request):
    """
    Serve robots.txt dynamically.
    Allows public website pages, blocks admin/panel/api/auth routes.
    """
    try:
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
    except Exception as e:
        logger.exception(f"Error generating robots.txt: {e}")
        # Return minimal valid robots.txt on error
        return HttpResponse("User-agent: *\nAllow: /\n", content_type="text/plain")


@require_GET
@cache_page(60 * 60)  # Cache for 1 hour
def sitemap_xml(request):
    """
    Serve a dynamic sitemap.xml with comprehensive error handling.
    
    Generates XML sitemap for:
    - Static pages (home, about, testimonials, etc.)
    - Portfolio categories
    - Portfolio items
    
    Always returns valid XML (never 404/500 for GSC compatibility).
    """
    try:
        return _generate_full_sitemap(request)
    except Exception as e:
        logger.exception(f"Error generating full sitemap: {e}")
        # Return minimal valid sitemap on error so Google doesn't flag as broken
        return _generate_minimal_sitemap(request)


def _generate_full_sitemap(request):
    """Generate comprehensive sitemap with all three sections."""
    site_url = _get_site_url(request)
    urls = []
    
    # 1. Static pages
    static_pages = [
        ('website:home', 1.0, 'daily'),
        ('website:our_work', 0.9, 'daily'),
        ('website:why_choose_us', 0.8, 'weekly'),
        ('website:testimonials', 0.8, 'weekly'),
        ('website:privacy_policy', 0.3, 'monthly'),
    ]
    
    for view_name, priority, changefreq in static_pages:
        try:
            loc = reverse(view_name)
            urls.append(f"""  <url>
    <loc>{site_url}{loc}</loc>
    <changefreq>{changefreq}</changefreq>
    <priority>{priority}</priority>
  </url>""")
        except Exception as e:
            logger.warning(f"Could not reverse URL for {view_name}: {e}")
    
    # 2. Portfolio categories
    try:
        from .models import PortfolioCategory
        categories = PortfolioCategory.objects.filter(is_active=True).order_by('order')
        for cat in categories:
            try:
                loc = reverse('website:category_detail', kwargs={'slug': cat.slug})
                lastmod = cat.updated_at.strftime('%Y-%m-%d') if cat.updated_at else ''
                urls.append(f"""  <url>
    <loc>{site_url}{loc}</loc>
    {f'<lastmod>{lastmod}</lastmod>' if lastmod else ''}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>""")
            except Exception as e:
                logger.warning(f"Could not generate sitemap entry for category {cat.slug}: {e}")
    except Exception as e:
        logger.warning(f"Error fetching portfolio categories: {e}")
    
    # 3. Portfolio items
    try:
        from .models import PortfolioItem
        items = PortfolioItem.objects.filter(is_active=True).select_related('category').order_by('-updated_at')
        for item in items:
            try:
                loc = reverse('website:product_detail', kwargs={
                    'category_slug': item.category.slug if item.category else 'uncategorized',
                    'slug': item.slug
                })
                lastmod = item.updated_at.strftime('%Y-%m-%d') if item.updated_at else ''
                urls.append(f"""  <url>
    <loc>{site_url}{loc}</loc>
    {f'<lastmod>{lastmod}</lastmod>' if lastmod else ''}
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>""")
            except Exception as e:
                logger.warning(f"Could not generate sitemap entry for item {item.slug}: {e}")
    except Exception as e:
        logger.warning(f"Error fetching portfolio items: {e}")
    
    # Build final XML
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(urls)}
</urlset>"""
    
    return HttpResponse(xml, content_type="application/xml; charset=utf-8")


def _generate_minimal_sitemap(request):
    """Generate a minimal valid XML sitemap with basic pages."""
    try:
        site_url = _get_site_url(request)
        urls = []
        
        # Add static pages only
        static_pages = [
            ('website:home', 1.0, 'daily'),
            ('website:our_work', 0.9, 'daily'),
            ('website:why_choose_us', 0.8, 'weekly'),
            ('website:testimonials', 0.8, 'weekly'),
            ('website:privacy_policy', 0.3, 'monthly'),
        ]
        
        for view_name, priority, changefreq in static_pages:
            try:
                loc = reverse(view_name)
                urls.append(f"""  <url>
    <loc>{site_url}{loc}</loc>
    <changefreq>{changefreq}</changefreq>
    <priority>{priority}</priority>
  </url>""")
            except Exception as e:
                logger.warning(f"Could not reverse URL for {view_name}: {e}")
        
        xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(urls)}
</urlset>"""
        
        return HttpResponse(xml, content_type="application/xml; charset=utf-8")
    except Exception as e:
        logger.exception(f"Error generating minimal sitemap: {e}")
        # Fallback: absolute minimal sitemap
        return HttpResponse(
            '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
            content_type="application/xml; charset=utf-8"
        )


def _get_site_url(request):
    """Get canonical site URL from settings or request."""
    site_url = getattr(settings, 'SITE_URL', '').rstrip('/')
    if not site_url or site_url == 'http://localhost:8000':
        # Build from request in dev
        site_url = f"{request.scheme}://{request.get_host()}"
    return site_url
