from django.contrib.sitemaps import Sitemap
from django.urls import reverse
from .models import PortfolioCategory, PortfolioItem
import logging

logger = logging.getLogger(__name__)

class StaticViewSitemap(Sitemap):
    """Sitemap for main navigation pages."""
    def items(self):
        # List of (viewname, priority, changefreq)
        return [
            ('website:home', 1.0, 'daily'),
            ('website:our_work', 0.9, 'daily'),
            ('website:why_choose_us', 0.8, 'weekly'),
            ('website:testimonials', 0.8, 'weekly'),
            ('website:privacy_policy', 0.3, 'monthly'),
        ]

    def location(self, item):
        return reverse(item[0])

    def priority(self, item):
        return item[1]

    def changefreq(self, item):
        return item[2]

class PortfolioCategorySitemap(Sitemap):
    """Sitemap for product categories."""
    changefreq = "weekly"
    priority = 0.8

    def items(self):
        try:
            return PortfolioCategory.objects.filter(is_active=True).order_by('order')
        except Exception as e:
            logger.warning(f"Error fetching portfolio categories for sitemap: {e}")
            return []

    def location(self, obj):
        return reverse('website:category_detail', kwargs={'slug': obj.slug})

    def lastmod(self, obj):
        return obj.updated_at

class PortfolioItemSitemap(Sitemap):
    """Sitemap for individual products."""
    changefreq = "weekly"
    priority = 0.9  # Higher priority for individual products

    def items(self):
        try:
            return PortfolioItem.objects.filter(is_active=True).select_related('category').order_by('-updated_at')
        except Exception as e:
            logger.warning(f"Error fetching portfolio items for sitemap: {e}")
            return []

    def location(self, obj):
        return reverse('website:product_detail', kwargs={'category_slug': obj.category.slug, 'slug': obj.slug})

    def lastmod(self, obj):
        return obj.updated_at
