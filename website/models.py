from django.db import models
from django.utils import timezone
from django.core.validators import MaxValueValidator, MinValueValidator
from django.utils.text import slugify
import re


# ==========================================
# 0. WEBSITE STATUS (Live / Draft toggle)
# ==========================================

class WebsiteStatus(models.Model):
    """
    Singleton: tracks whether the public website is Live or Draft.
    """
    STATUS_CHOICES = [
        ('live', 'Live'),
        ('draft', 'Draft'),
    ]
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='live')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Website Status'
        verbose_name_plural = 'Website Status'

    def __str__(self):
        return f"Website is {self.get_status_display()}"

    def save(self, *args, **kwargs):
        if not self.pk and WebsiteStatus.objects.exists():
            return
        super().save(*args, **kwargs)

    @classmethod
    def get_status(cls):
        obj = cls.objects.first()
        return obj.status if obj else 'live'


# ==========================================
# 1. SITE CONFIGURATION (Singleton Pattern)
# ==========================================

class BusinessDetails(models.Model):
    """
    Global site information. 
    Note: Ideally, only one instance of this model should exist.
    """
    # Basic Info
    site_name = models.CharField(max_length=255, default='Adarsh ID Cards')
    tagline = models.CharField(max_length=500, blank=True)
    
    # Contact Info
    address = models.CharField(max_length=500, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    working_hours = models.CharField(max_length=255, blank=True, help_text='e.g. Mon-Sat: 9AM - 6PM')
    
    # Social Media Links
    facebook_url = models.URLField(blank=True, help_text='Facebook page URL')
    instagram_url = models.URLField(blank=True, help_text='Instagram profile URL')
    twitter_url = models.URLField(blank=True, help_text='Twitter/X profile URL')
    whatsapp_number = models.CharField(max_length=20, blank=True, help_text='WhatsApp number with country code e.g. 919876543210')
    
    # Hero Section
    hero_title = models.CharField(max_length=255, blank=True)
    hero_description = models.TextField(blank=True)
    hero_image1 = models.ImageField(upload_to='images/Hero/', null=True, blank=True)
    hero_image2 = models.ImageField(upload_to='images/Hero/', null=True, blank=True)
    hero_image3 = models.ImageField(upload_to='images/Hero/', null=True, blank=True)
    hero_image4 = models.ImageField(upload_to='images/Hero/', null=True, blank=True)
    
    # SEO
    meta_description = models.TextField(blank=True)
    meta_keywords = models.CharField(max_length=500, blank=True)

    # Footer
    footer_text = models.CharField(max_length=500, blank=True, help_text='Custom footer text')

    # Status
    is_active = models.BooleanField(default=True, help_text='Active/Inactive toggle for business details')

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Business Detail'
        verbose_name_plural = 'Business Details'

    def __str__(self):
        return self.site_name

    def save(self, *args, **kwargs):
        """Ensure only one instance of BusinessDetails exists. Sanitize HTML fields."""
        if not self.pk and BusinessDetails.objects.exists():
            return  # Or raise an error
        # Sanitize hero_title: allow only <span>, <br>, <strong>, <em> tags
        if self.hero_title:
            self.hero_title = self._sanitize_html(self.hero_title)
        super(BusinessDetails, self).save(*args, **kwargs)

    @staticmethod
    def _sanitize_html(value):
        """Strip all HTML tags except a safe allowlist."""
        ALLOWED_TAGS = {'span', 'br', 'strong', 'em', 'b', 'i'}
        # Remove <script>, <style>, and event handlers first
        value = re.sub(r'<script[^>]*>.*?</script>', '', value, flags=re.DOTALL | re.IGNORECASE)
        value = re.sub(r'<style[^>]*>.*?</style>', '', value, flags=re.DOTALL | re.IGNORECASE)
        value = re.sub(r'\son\w+\s*=\s*["\'][^"\']*["\']', '', value, flags=re.IGNORECASE)

        def _replace_tag(match):
            full = match.group(0)
            tag_name = match.group(1).lower().strip('/')
            if tag_name in ALLOWED_TAGS:
                return full
            return ''
        return re.sub(r'<(/?\s*\w+)[^>]*>', _replace_tag, value)


# ==========================================
# 1b. HERO IMAGES (Unlimited, Ordered)
# ==========================================

class HeroImage(models.Model):
    """
    Dynamic hero slider images.
    Replaces the fixed hero_image1–4 fields on BusinessDetails.
    Supports unlimited images with ordering and per-image captions.
    """
    image = models.ImageField(upload_to='images/Hero/', help_text='Slider image')
    title = models.CharField(max_length=150, blank=True, help_text='Optional card title (e.g. "Premium Quality")')
    subtitle = models.CharField(max_length=200, blank=True, help_text='Optional card subtitle (e.g. "Trusted by 500+ Schools")')
    order = models.PositiveIntegerField(default=0, db_index=True, help_text='Display order (lower = first)')
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Hero Image'
        verbose_name_plural = 'Hero Images'
        ordering = ['order', 'pk']

    def __str__(self):
        return f"Hero #{self.order} — {self.title or 'Untitled'}"


# ==========================================
# 2. CORE FEATURES / SERVICES
# ==========================================

class Feature(models.Model):
    """Features for 'Why Choose Us' section"""
    title = models.CharField(max_length=255)
    description = models.TextField()
    icon = models.CharField(
        max_length=50, 
        default='fas fa-shield-alt', 
        help_text='Font Awesome icon class (e.g., fas fa-star)'
    )
    number = models.PositiveIntegerField(default=1, help_text='Display order/number')
    highlight = models.CharField(max_length=255, blank=True, help_text='Highlight tags (comma separated)')
    
    is_featured = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    order = models.IntegerField(default=0)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Feature'
        verbose_name_plural = 'Features'
        ordering = ['order', 'number']

    def __str__(self):
        return self.title


# ==========================================
# 3. PORTFOLIO & WORK
# ==========================================

class PortfolioCategory(models.Model):
    """Categories for organizing portfolio items. 9 defaults + user-created."""
    DEFAULT_CATEGORIES = [
        ('id-cards', 'ID Cards', 'fas fa-id-card'),
        ('lanyards', 'Lanyards', 'fas fa-ribbon'),
        ('certificates', 'Certificates', 'fas fa-certificate'),
        ('marksheets', 'Marksheets', 'fas fa-file-alt'),
        ('fee-cards', 'Fee Cards', 'fas fa-credit-card'),
        ('invitations', 'Invitations', 'fas fa-envelope-open-text'),
        ('visiting-cards', 'Visiting Cards', 'fas fa-address-card'),
        ('brochures', 'Brochures', 'fas fa-book-open'),
        ('others', 'Others', 'fas fa-print'),
    ]

    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True, blank=True)
    icon = models.CharField(max_length=50, default='fas fa-folder', help_text='Font Awesome icon class')
    description = models.TextField(blank=True)
    is_default = models.BooleanField(default=False, help_text='Default categories cannot be deleted')
    is_bento = models.BooleanField(default=False, help_text='Show in the bento grid section')
    bento_size = models.CharField(
        max_length=10, default='normal',
        choices=[('large', 'Large'), ('normal', 'Normal')],
        help_text='Card size in bento grid',
    )
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Portfolio Category'
        verbose_name_plural = 'Portfolio Categories'
        ordering = ['order', 'name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    @property
    def cover_image_url(self):
        """First active item's image as the category cover."""
        item = self.items.filter(
            is_active=True, image__isnull=False
        ).exclude(image='').order_by('order', '-created_at').first()
        return item.image.url if item and item.image else None

    @classmethod
    def ensure_defaults(cls):
        """Create the 9 default categories if they don't exist."""
        for i, (slug, name, icon) in enumerate(cls.DEFAULT_CATEGORIES):
            obj, created = cls.objects.get_or_create(
                slug=slug,
                defaults={
                    'name': name,
                    'icon': icon,
                    'order': i,
                    'is_default': True,
                    'is_bento': True,
                    'bento_size': 'large' if i == 0 else 'normal',
                }
            )
            # For existing records, enable bento flag if not already set
            if not created and not obj.is_bento:
                obj.is_bento = True
                obj.bento_size = 'large' if i == 0 else 'normal'
                obj.save(update_fields=['is_bento', 'bento_size'])


class PortfolioItem(models.Model):
    """Gallery of products and past works"""
    ITEM_TYPE_CHOICES = [
        ('image', 'Image'),
        ('video', 'Video'),
        ('reel', 'Reel'),
    ]
    ORIENTATION_CHOICES = [
        ('square', 'Square'),
        ('portrait', 'Portrait'),
        ('landscape', 'Landscape'),
        ('featured', 'Featured'),
        ('', 'Default'),
    ]
    
    title = models.CharField(max_length=255)
    slug = models.SlugField(unique=True, blank=True)
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to='images/Products/', blank=True, null=True)
    category = models.ForeignKey(
        PortfolioCategory, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='items'
    )
    orientation = models.CharField(max_length=20, choices=ORIENTATION_CHOICES, blank=True, default='')
    item_type = models.CharField(max_length=10, choices=ITEM_TYPE_CHOICES, default='image')
    video_url = models.URLField(blank=True, help_text='Video URL for video/reel items')
    video_file = models.FileField(upload_to='videos/Portfolio/', null=True, blank=True, help_text='Upload video file')
    
    is_featured = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    order = models.IntegerField(default=0)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Portfolio Item'
        verbose_name_plural = 'Portfolio Items'
        ordering = ['order', '-created_at']

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.title)
        super().save(*args, **kwargs)

    @property
    def media_url(self):
        """Return the best available media URL."""
        if self.video_file:
            return self.video_file.url
        if self.video_url:
            return self.video_url
        if self.image:
            return self.image.url
        return None


# ==========================================
# 4. SOCIAL PROOF (Testimonials & Clients)
# ==========================================

class TrustedClient(models.Model):
    """Logos of schools/corporates served - displayed on website"""
    name = models.CharField(max_length=255, help_text='School/Company name')
    logo = models.ImageField(upload_to='images/Schools/Logos/', help_text='School/Company logo (small, transparent preferred)')
    
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Trusted Client'
        verbose_name_plural = 'Trusted Clients'
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class Testimonial(models.Model):
    """Customer text reviews"""
    reviewer_name = models.CharField(max_length=255)
    reviewer_title = models.CharField(max_length=255, blank=True, help_text='e.g., Principal, Admin Head')
    reviewer_school = models.CharField(max_length=255, blank=True)
    reviewer_avatar = models.ImageField(upload_to='images/Avatars/', blank=True, null=True)
    
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        default=5,
        help_text='Star rating (1-5)'
    )
    review_date = models.DateField(default=timezone.now)
    helpful_count = models.PositiveIntegerField(default=0)
    tag = models.CharField(max_length=100, blank=True, help_text='e.g. Quality, Delivery')
    text = models.TextField(blank=True)
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Testimonial'
        verbose_name_plural = 'Testimonials'
        ordering = ['-review_date']

    def __str__(self):
        return self.reviewer_name


class FAQ(models.Model):
    """Frequently Asked Questions"""
    question = models.CharField(max_length=500)
    answer = models.TextField()
    order = models.IntegerField(default=0, help_text='Display order')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'FAQ'
        verbose_name_plural = 'FAQs'
        ordering = ['order', 'created_at']

    def __str__(self):
        return self.question[:50]


class Reel(models.Model):
    """Short video reels for showcasing work"""
    title = models.CharField(max_length=255)
    description = models.CharField(max_length=500, blank=True)
    thumbnail = models.ImageField(upload_to='images/Reels/', null=True, blank=True)
    video_url = models.URLField(blank=True, help_text='YouTube/Instagram reel URL')
    video_file = models.FileField(upload_to='videos/Reels/', null=True, blank=True)
    views_count = models.CharField(max_length=20, default='1K', help_text='e.g. 12.5K')
    likes_count = models.CharField(max_length=20, default='100', help_text='e.g. 890')
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Reel'
        verbose_name_plural = 'Reels'
        ordering = ['order', '-created_at']

    def __str__(self):
        return self.title


# ==========================================
# 5. USER INTERACTION
# ==========================================

class ContactSubmission(models.Model):
    """Submissions from the 'Contact Us' form"""
    STATUS_CHOICES = [
        ('new', 'New'),
        ('read', 'Read'),
        ('replied', 'Replied'),
        ('closed', 'Closed'),
    ]
    
    EMAIL_STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('sent', 'Sent'),
        ('failed', 'Failed'),
    ]
    
    name = models.CharField(max_length=255)
    email = models.EmailField()
    phone = models.CharField(max_length=20, blank=True)
    subject = models.CharField(max_length=255)
    message = models.TextField()
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='new')
    
    # Email automation tracking
    email_status = models.CharField(max_length=20, choices=EMAIL_STATUS_CHOICES, default='pending')
    email_retry_count = models.IntegerField(default=0)
    email_last_attempt = models.DateTimeField(null=True, blank=True)
    email_sent_at = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Contact Submission'
        verbose_name_plural = 'Contact Submissions'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['email_status']),
            models.Index(fields=['created_at']),
        ]
    
    def __str__(self):
        return f"{self.name}: {self.subject}"
    
    def get_next_retry_delay(self):
        """Returns delay in seconds for next retry based on attempt count"""
        delays = {
            0: 60,        # 1 minute
            1: 600,       # 10 minutes
            2: 3600,      # 1 hour
            3: 86400,     # 24 hours
        }
        return delays.get(self.email_retry_count)
