"""
Data migration: Set is_bento=True on existing default categories.
"""
from django.db import migrations


def set_bento_defaults(apps, schema_editor):
    PortfolioCategory = apps.get_model('website', 'PortfolioCategory')
    defaults = PortfolioCategory.objects.filter(is_default=True).order_by('order')
    for idx, cat in enumerate(defaults):
        cat.is_bento = True
        cat.bento_size = 'large' if idx == 0 else 'normal'
        cat.save(update_fields=['is_bento', 'bento_size'])


def reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('website', '0009_add_bento_fields_to_portfolio_category'),
    ]
    operations = [
        migrations.RunPython(set_bento_defaults, reverse),
    ]
