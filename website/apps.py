from django.apps import AppConfig


class WebsiteConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'website'
    verbose_name = 'Website (Landing Pages)'

    def ready(self):
        from django.core.cache import cache
        from django.db.models.signals import post_delete, post_save
        from core.services.cache_version_service import CacheVersionService

        from .models import BusinessDetails, Feature, PortfolioItem, Testimonial

        def _invalidate_public_section_caches(**_kwargs):
            cache.delete('home_sections')
            cache.delete('business_details')
            cache.delete('website:why_choose_us:sections')
            try:
                CacheVersionService.bump('website_public_sections', 'public')
            except Exception:
                pass

        models_to_watch = (BusinessDetails, Feature, Testimonial, PortfolioItem)
        for model_cls in models_to_watch:
            post_save.connect(
                _invalidate_public_section_caches,
                sender=model_cls,
                weak=False,
                dispatch_uid=f'website_cache_invalidate_save_{model_cls.__name__}',
            )
            post_delete.connect(
                _invalidate_public_section_caches,
                sender=model_cls,
                weak=False,
                dispatch_uid=f'website_cache_invalidate_delete_{model_cls.__name__}',
            )
