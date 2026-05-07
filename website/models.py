from django.db import models
from django.utils import timezone
from django.core.validators import MaxValueValidator, MinValueValidator
from django.core.exceptions import ValidationError
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
            raise ValidationError("Only one WebsiteStatus instance is allowed. Update the existing one.")
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
    phone1 = models.CharField(max_length=20, blank=True, help_text='First phone number with country code e.g. 919876543210')
    phone2 = models.CharField(max_length=20, blank=True, help_text='Second phone number with country code e.g. 919876543211')
    email = models.EmailField(blank=True)
    
    # Social Media Links
    facebook_url = models.URLField(blank=True, help_text='Facebook page URL')
    instagram_url = models.URLField(blank=True, help_text='Instagram profile URL')
    linkedin_url = models.URLField(blank=True, help_text='LinkedIn profile URL')
    youtube_url = models.URLField(blank=True, help_text='YouTube channel URL')
    

    
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
            raise ValidationError("Only one BusinessDetails instance is allowed. Update the existing one.")
        # Sanitize hero_title: allow only <span>, <br>, <strong>, <em> tags
        if self.hero_title:
            self.hero_title = self._sanitize_html(self.hero_title)
        super(BusinessDetails, self).save(*args, **kwargs)

    @staticmethod
    def _sanitize_html(value):
        """Strip all HTML tags except a safe allowlist, and remove dangerous attributes."""
        ALLOWED_TAGS = {'span', 'br', 'strong', 'em', 'b', 'i'}
        # Remove <script>, <style>, and event handlers first
        value = re.sub(r'<script[^>]*>.*?</script>', '', value, flags=re.DOTALL | re.IGNORECASE)
        value = re.sub(r'<style[^>]*>.*?</style>', '', value, flags=re.DOTALL | re.IGNORECASE)
        # Remove ALL event handler attributes (on*=...)
        value = re.sub(r'\son\w+\s*=\s*(?:"[^"]*"|\x27[^\x27]*\x27|[^\s>]+)', '', value, flags=re.IGNORECASE)
        # Remove javascript: protocol in any attribute
        value = re.sub(r'javascript\s*:', '', value, flags=re.IGNORECASE)
        # Remove data: protocol in any attribute (prevent data URI attacks)
        value = re.sub(r'data\s*:[^\s>]*', '', value, flags=re.IGNORECASE)

        def _replace_tag(match):
            full = match.group(0)
            tag_name = match.group(1).lower().strip('/')
            if tag_name in ALLOWED_TAGS:
                # For allowed tags, strip all attributes except safe ones
                if tag_name == 'span':
                    # Only allow class and style on span
                    cleaned = re.sub(r'\s+(?!class=|style=)\w+=(?:"[^"]*"|\x27[^\x27]*\x27|[^\s>]+)', '', full, flags=re.IGNORECASE)
                    return cleaned
                # For other allowed tags, strip ALL attributes
                return f'<{match.group(1).strip()}>'
            return ''
        return re.sub(r'<(/?\s*\w+)[^>]*>', _replace_tag, value)





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
    
    is_featured = models.BooleanField(default=False, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    order = models.IntegerField(default=0)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Feature'
        verbose_name_plural = 'Features'
        ordering = ['order', 'number']
        indexes = [
            models.Index(fields=['is_active', 'order']),
        ]

    def __str__(self):
        return self.title


# ==========================================
# 3. PORTFOLIO & WORK
# ==========================================

class PortfolioCategory(models.Model):
    """Categories for organizing portfolio items."""
    DEFAULT_CATEGORIES = [
        ('id-cards', 'ID Cards', 'fas fa-id-card'),
        ('lanyards', 'Lanyards', 'fas fa-ribbon'),
        ('badges', 'Badges', 'fas fa-id-badge'),
        ('school-stationery', 'School Stationery', 'fas fa-pencil-ruler'),
        ('student-diaries', 'Student Diaries', 'fas fa-book'),
        ('prospectus', 'Prospectus', 'fas fa-scroll'),
        ('t-shirts', 'T-Shirts', 'fas fa-tshirt'),
        ('mugs', 'Mugs', 'fas fa-mug-hot'),
        ('pamphlets', 'Pamphlets', 'fas fa-file-alt'),
        ('brochures', 'Brochures', 'fas fa-book-open'),
        ('certificates', 'Certificates', 'fas fa-certificate'),
        ('marksheets', 'Marksheets', 'fas fa-file-alt'),
        ('fee-cards', 'Fee Cards', 'fas fa-credit-card'),
        ('invitations', 'Invitations', 'fas fa-envelope-open-text'),
        ('visiting-cards', 'Visiting Cards', 'fas fa-address-card'),
        ('others', 'Others', 'fas fa-print'),
    ]

    # Categories shown in the bento grid (slug → bento_size)
    BENTO_LAYOUT = {
        'id-cards': 'large',           # Row 1: span 2 cols + 2 rows
        'lanyards': 'normal',          # Row 1
        'badges': 'normal',            # Row 1
        'school-stationery': 'normal', # Row 2 (beside id-cards)
        'pamphlets': 'wide',           # Row 3: span 2 cols
        'student-diaries': 'wide',     # Row 3: span 2 cols (equal width to pamphlets)
        'office-stationery': 'large',  # Row 4: span 2 cols + 2 rows
    }

    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True, blank=True)
    icon = models.CharField(max_length=50, default='fas fa-folder', help_text='Font Awesome icon class')
    description = models.TextField(blank=True)
    is_default = models.BooleanField(default=False, help_text='Default categories cannot be deleted')
    is_bento = models.BooleanField(default=False, help_text='Show in the bento grid section')
    bento_size = models.CharField(
        max_length=10, default='normal',
        choices=[('large', 'Large'), ('wide', 'Wide'), ('normal', 'Normal')],
        help_text='Card size in bento grid',
    )
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)
    
    # SEO Meta Tags
    meta_title = models.CharField(max_length=255, blank=True, help_text='Optional SEO title override')
    meta_description = models.TextField(blank=True, help_text='Optional SEO description override')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Portfolio Category'
        verbose_name_plural = 'Portfolio Categories'
        ordering = ['order', 'name']
        indexes = [
            models.Index(fields=['is_active', 'order']),
        ]

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        from django.urls import reverse
        return reverse('website:category_detail', kwargs={'slug': self.slug})

    def save(self, *args, **kwargs):
        if not self.slug:
            from django.utils.text import slugify
            base_slug = slugify(self.name)
            slug = base_slug
            counter = 1
            while PortfolioCategory.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f'{base_slug}-{counter}'
                counter += 1
            self.slug = slug
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
        """Create default categories and set bento grid layout."""
        for i, (slug, name, icon) in enumerate(cls.DEFAULT_CATEGORIES):
            bento_size = cls.BENTO_LAYOUT.get(slug, 'normal')
            is_bento = slug in cls.BENTO_LAYOUT
            obj, created = cls.objects.get_or_create(
                slug=slug,
                defaults={
                    'name': name,
                    'icon': icon,
                    'order': i,
                    'is_default': True,
                    'is_bento': is_bento,
                    'bento_size': bento_size,
                }
            )
            if not created:
                changed = False
                if obj.is_bento != is_bento:
                    obj.is_bento = is_bento
                    changed = True
                if is_bento and obj.bento_size != bento_size:
                    obj.bento_size = bento_size
                    changed = True
                if obj.order != i:
                    obj.order = i
                    changed = True
                if changed:
                    obj.save(update_fields=['is_bento', 'bento_size', 'order'])


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
    
    is_featured = models.BooleanField(default=False, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    order = models.IntegerField(default=0)
    
    # SEO Meta Tags
    meta_title = models.CharField(max_length=255, blank=True, help_text='Optional SEO title override')
    meta_description = models.TextField(blank=True, help_text='Optional SEO description override')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Portfolio Item'
        verbose_name_plural = 'Portfolio Items'
        ordering = ['order', '-created_at']
        indexes = [
            models.Index(fields=['is_active', 'order']),
            models.Index(fields=['is_active', 'is_featured']),
            models.Index(fields=['is_active', '-created_at']),
            models.Index(fields=['category', 'is_active', 'order']),
        ]

    def __str__(self):
        return self.title

    def get_absolute_url(self):
        from django.urls import reverse
        return reverse('website:product_detail', kwargs={
            'category_slug': self.category.slug if self.category else 'uncategorized',
            'slug': self.slug
        })

    def _needs_portfolio_image_processing(self):
        """Return True when image should run through watermark/WebP pipeline."""
        if self.item_type != 'image' or not self.image:
            return False

        image_file = getattr(self.image, 'file', None)
        if getattr(image_file, '_portfolio_processed', False):
            return False

        if self._state.adding or not self.pk:
            return True

        previous = type(self).objects.filter(pk=self.pk).only('image').first()
        if not previous or not previous.image:
            return True
        return (self.image.name or '') != (previous.image.name or '')

    def _needs_portfolio_video_processing(self):
        """Return True when uploaded video should run through FFmpeg pipeline."""
        if not self.video_file:
            return False

        video_file = getattr(self.video_file, 'file', None)
        if getattr(video_file, '_portfolio_video_processed', False):
            return False

        if self._state.adding or not self.pk:
            return True

        previous = type(self).objects.filter(pk=self.pk).only('video_file').first()
        if not previous or not previous.video_file:
            return True
        return (self.video_file.name or '') != (previous.video_file.name or '')

    def save(self, *args, **kwargs):
        previous_video_name = ''
        if self.pk:
            previous = type(self).objects.filter(pk=self.pk).only('video_file').first()
            if previous and previous.video_file:
                previous_video_name = previous.video_file.name or ''

        if self._needs_portfolio_image_processing():
            from .watermark import process_portfolio_image
            # Ensure portfolio images are compressed to the requested maximum (200KB)
            self.image = process_portfolio_image(self.image, max_kb=200)

        # Defer heavy video processing to background worker to avoid blocking
        # request/transaction lifecycle. The background job will normalize,
        # compress and generate derivatives for the saved file.

        if not self.slug:
            from django.utils.text import slugify
            base_slug = slugify(self.title)
            slug = base_slug
            counter = 1
            while PortfolioItem.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f'{base_slug}-{counter}'
                counter += 1
            self.slug = slug
        super().save(*args, **kwargs)

        current_video_name = self.video_file.name if self.video_file else ''
        video_changed = (previous_video_name or '') != (current_video_name or '')

        if video_changed and previous_video_name:
            from .video_processing import purge_portfolio_video_derivatives
            purge_portfolio_video_derivatives(previous_video_name)

        if current_video_name and video_changed:
            # Submit background job to process video (normalize/compress + derivatives)
            try:
                from core.services.background_worker import background_worker
                from .video_processing import process_portfolio_video_file
                # Fire-and-forget: background_worker.executor handles threads and
                # closes DB connections in its worker lifecycle. We pass the
                # relative media path and desired max bytes.
                background_worker.executor.submit(process_portfolio_video_file, current_video_name, 10 * 1024 * 1024)
            except Exception:
                # If background submission fails, fall back to synchronous generation
                try:
                    from .video_processing import ensure_portfolio_video_derivatives
                    ensure_portfolio_video_derivatives(current_video_name)
                except Exception:
                    pass

    def delete(self, *args, **kwargs):
        old_video_name = self.video_file.name if self.video_file else ''
        super().delete(*args, **kwargs)
        if old_video_name:
            from .video_processing import purge_portfolio_video_derivatives
            purge_portfolio_video_derivatives(old_video_name)

    @property
    def video_fallback_url(self):
        """Direct MP4/file URL fallback (or external URL if no uploaded file)."""
        if self.video_file:
            return self.video_file.url
        return self.video_url or ''

    @property
    def video_stream_url(self):
        """HLS playlist URL when generated, otherwise empty string."""
        if not self.video_file:
            return ''
        from .video_processing import get_portfolio_video_stream_url
        return get_portfolio_video_stream_url(self.video_file.name)

    @property
    def video_thumbnail_url(self):
        """Use explicit image thumbnail if present, else generated video thumbnail."""
        if self.image:
            return self.image.url
        if not self.video_file:
            return ''
        from .video_processing import get_portfolio_video_thumbnail_url
        return get_portfolio_video_thumbnail_url(self.video_file.name)

    @property
    def video_source_url(self):
        """Best playback source for website: HLS stream when available, else fallback URL."""
        if self.video_file:
            return self.video_stream_url or self.video_file.url
        return self.video_url or ''

    @property
    def media_url(self):
        """Return the best available media URL."""
        if self.item_type in ('video', 'reel'):
            src = self.video_source_url or self.video_fallback_url
            if src:
                return src
        if self.video_url:
            return self.video_url
        if self.image:
            return self.image.url
        return None


# ==========================================
# 4. SOCIAL PROOF (Testimonials)
# ==========================================

class Testimonial(models.Model):
    """Customer text reviews"""
    reviewer_name = models.CharField(max_length=255)
    reviewer_email = models.EmailField(blank=True, default='', db_index=True)
    reviewer_ip = models.GenericIPAddressField(blank=True, null=True, db_index=True)
    reviewer_title = models.CharField(max_length=255, blank=True, help_text='e.g., Principal, Admin Head')
    reviewer_school = models.CharField(max_length=255, blank=True)
    reviewer_avatar = models.ImageField(upload_to='images/Avatars/', blank=True, null=True)
    attachment_image = models.ImageField(upload_to='images/TestimonialAttachments/', blank=True, null=True)
    
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        default=5,
        help_text='Star rating (1-5)'
    )
    review_date = models.DateField(default=timezone.now)
    helpful_count = models.PositiveIntegerField(default=0)
    tag = models.CharField(max_length=100, blank=True, help_text='e.g. Quality, Delivery')
    text = models.TextField(blank=True)
    
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Testimonial'
        verbose_name_plural = 'Testimonials'
        ordering = ['-review_date']
        indexes = [
            models.Index(fields=['is_active', '-review_date']),
        ]

    def __str__(self):
        return self.reviewer_name


class FAQ(models.Model):
    """Frequently Asked Questions"""
    question = models.CharField(max_length=500)
    answer = models.TextField()
    order = models.IntegerField(default=0, help_text='Display order')
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'FAQ'
        verbose_name_plural = 'FAQs'
        ordering = ['order', 'created_at']
        indexes = [
            models.Index(fields=['is_active', 'order']),
        ]

    def __str__(self):
        return self.question[:50]


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
    email = models.EmailField(db_index=True)
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
        """Returns delay in seconds for next retry based on attempt count.
        Returns None if max retries (4) have been exceeded."""
        delays = {
            0: 60,        # 1 minute
            1: 600,       # 10 minutes
            2: 3600,      # 1 hour
            3: 86400,     # 24 hours
        }
        return delays.get(self.email_retry_count, None)  # None = stop retrying
