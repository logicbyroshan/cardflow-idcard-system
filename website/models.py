from django.db import models


class PortfolioCategory(models.Model):
    name = models.CharField(max_length=200)
    icon = models.CharField(max_length=200, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ['order']


class PortfolioItem(models.Model):
    ITEM_TYPES = (
        ('image', 'Image'),
        ('video', 'Video'),
        ('link', 'Link'),
    )
    title = models.CharField(max_length=300)
    category = models.ForeignKey(PortfolioCategory, on_delete=models.CASCADE, related_name='items')
    item_type = models.CharField(max_length=20, choices=ITEM_TYPES, default='image')
    video_url = models.CharField(max_length=1024, blank=True, null=True)
    body = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ['order']
