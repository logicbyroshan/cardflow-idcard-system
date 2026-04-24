from django.contrib.sitemaps import Sitemap
from django.urls import reverse
from .models import PortfolioCategory, PortfolioItem

class StaticViewSitemap(Sitemap):
    priority = 1.0
    changefreq = 'weekly'

    def items(self):
        return ['website:home', 'website:our_work', 'website:why_choose_us', 'website:testimonials', 'website:privacy_policy']

    def location(self, item):
        return reverse(item)

class PortfolioCategorySitemap(Sitemap):
    changefreq = "weekly"
    priority = 0.8

    def items(self):
        return PortfolioCategory.objects.filter(is_active=True)

    def location(self, obj):
        return reverse('website:category_detail', kwargs={'slug': obj.slug})

    def lastmod(self, obj):
        return obj.updated_at

class PortfolioItemSitemap(Sitemap):
    changefreq = "weekly"
    priority = 0.7

    def items(self):
        return PortfolioItem.objects.filter(is_active=True).select_related('category')

    def location(self, obj):
        return reverse('website:product_detail', kwargs={'category_slug': obj.category.slug, 'slug': obj.slug})

    def lastmod(self, obj):
        return obj.updated_at
