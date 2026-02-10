"""
Data migration: Copy existing hero_image1-4 from BusinessDetails → HeroImage rows.
"""
from django.db import migrations


def migrate_hero_images(apps, schema_editor):
    BusinessDetails = apps.get_model('website', 'BusinessDetails')
    HeroImage = apps.get_model('website', 'HeroImage')

    business = BusinessDetails.objects.first()
    if not business:
        return

    defaults = [
        ('hero_image1', 'Premium Quality', 'Trusted by 500+ Schools'),
        ('hero_image2', '', ''),
        ('hero_image3', '', ''),
        ('hero_image4', '', ''),
    ]

    for idx, (field, title, subtitle) in enumerate(defaults, start=1):
        img = getattr(business, field, None)
        if img and str(img):
            HeroImage.objects.create(
                image=img,
                title=title,
                subtitle=subtitle,
                order=idx,
                is_active=True,
            )


def reverse_migration(apps, schema_editor):
    # Reverse is a no-op — the old fields still exist on BusinessDetails
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('website', '0007_add_hero_image_model'),
    ]

    operations = [
        migrations.RunPython(migrate_hero_images, reverse_migration),
    ]
