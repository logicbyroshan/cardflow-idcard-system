"""
Website Service Layer
=====================
Single authority for all website content mutations.
Views must ONLY: validate request → call service → return response.

Architecture rule:
  - This service owns ALL create/update/delete for website models
  - No view may call .save(), .create(), .delete() on any website model
  - All mutations go through WebsiteService methods
"""
import logging
import uuid

from django.core.exceptions import ValidationError
from django.core.cache import cache
from django.db import transaction
from django.shortcuts import get_object_or_404
from client.models import Client as PanelClient

from .models import (
    BusinessDetails, ContactSubmission, Feature, HeroImage,
    PortfolioCategory, PortfolioItem, Reel, Testimonial,
    WebsiteStatus, FAQ,
)

logger = logging.getLogger(__name__)

# ── Watermark helpers (imported lazily to avoid circular imports) ─────────
from .watermark import (  # noqa: E402
    apply_text_watermark, apply_logo_watermark,
)
from .video_processing import normalize_portfolio_video_upload, purge_portfolio_video_derivatives  # noqa: E402

# ── Upload validation constants ──────────────────────────────────────────
# S4: SVG removed — SVG files can contain inline <script> tags that execute in
# the browser when served from the same origin, bypassing XSS protections.
# If SVG uploads are ever needed again, sanitize with nh3/bleach before storing.
ALLOWED_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp')
ALLOWED_VIDEO_EXTENSIONS = ('.mp4', '.webm', '.mov', '.avi')
MAX_IMAGE_UPLOAD_SIZE = 10 * 1024 * 1024   # 10 MB
MAX_VIDEO_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB


def _validate_upload(file_obj, allowed_extensions, max_size, label='file'):
    """
    Validate an uploaded file's extension and size.
    Raises ValidationError on failure.
    """
    if file_obj is None:
        return
    name = (file_obj.name or '').lower()
    if not any(name.endswith(ext) for ext in allowed_extensions):
        raise ValidationError(
            f"Invalid {label} type. Allowed: {', '.join(allowed_extensions)}"
        )
    if file_obj.size and file_obj.size > max_size:
        raise ValidationError(
            f"{label.capitalize()} too large ({file_obj.size // (1024*1024)}MB). "
            f"Maximum is {max_size // (1024*1024)}MB."
        )
    # For images, verify the file is a valid image with Pillow
    if allowed_extensions == ALLOWED_IMAGE_EXTENSIONS:
        try:
            from PIL import Image
            from io import BytesIO
            file_obj.seek(0)
            data = file_obj.read()
            file_obj.seek(0)
            img = Image.open(BytesIO(data))
            img.verify()
        except Exception:
            raise ValidationError(f"Uploaded {label} is not a valid image.")


def _validate_image_upload(file_obj, label='image'):
    """Convenience wrapper for image validation."""
    _validate_upload(file_obj, ALLOWED_IMAGE_EXTENSIONS, MAX_IMAGE_UPLOAD_SIZE, label)


def _validate_video_upload(file_obj, label='video'):
    """Convenience wrapper for video validation."""
    _validate_upload(file_obj, ALLOWED_VIDEO_EXTENSIONS, MAX_VIDEO_UPLOAD_SIZE, label)


def _parse_bool(value, default=False):
    """Canonical boolean parser for POST/JSON values."""
    if value is None:
        return default
    return value in (True, 'true', '1', 'on', 'True')


def _detect_orientation(image_file):
    """Detect image orientation from its dimensions. Returns orientation string."""
    try:
        from PIL import Image
        from io import BytesIO
        image_file.seek(0)
        data = image_file.read()
        image_file.seek(0)
        img = Image.open(BytesIO(data))
        w, h = img.size
        ratio = w / h if h else 1
        if 0.85 <= ratio <= 1.15:
            return 'square'
        elif ratio > 1.15:
            return 'landscape'
        else:
            return 'portrait'
    except Exception:
        return ''


def _build_portfolio_item_title(category_id=None):
    """Generate default PortfolioItem title in '<Category> <CODE>' format."""
    code = uuid.uuid4().hex[:6].upper()
    if category_id:
        try:
            cat = PortfolioCategory.objects.only('name').get(pk=int(category_id))
            return f"{cat.name} {code}"
        except (PortfolioCategory.DoesNotExist, TypeError, ValueError):
            pass
    return f"Item {code}"


# =============================================================================
# WEBSITE STATUS
# =============================================================================

class WebsiteStatusService:
    """Manages the global website live/draft toggle."""

    @staticmethod
    def toggle_status():
        """Toggle website between 'live' and 'draft'. Returns new status."""
        with transaction.atomic():
            obj, _ = WebsiteStatus.objects.get_or_create(pk=1)
            obj.status = 'draft' if obj.status == 'live' else 'live'
            obj.save()
        return obj.status


# =============================================================================
# BUSINESS DETAILS
# =============================================================================

class BusinessDetailsService:
    """Manages the singleton BusinessDetails record."""

    EDITABLE_FIELDS = [
        'site_name', 'tagline', 'address', 'phone', 'email', 'working_hours',
        'facebook_url', 'instagram_url', 'twitter_url', 'whatsapp_number',
        'meta_description', 'meta_keywords',
        'footer_text',
    ]

    @classmethod
    def update(cls, data):
        """
        Create or update business details.
        data: dict of field_name → value (only non-None values are applied).
        Returns the updated BusinessDetails instance.
        """
        with transaction.atomic():
            business, _ = BusinessDetails.objects.get_or_create(pk=1)
            for field in cls.EDITABLE_FIELDS:
                val = data.get(field)
                if val is not None:
                    setattr(business, field, val)
            is_active = data.get('is_active')
            if is_active is not None:
                business.is_active = _parse_bool(is_active)
            business.save()
        return business

    @staticmethod
    def toggle_status():
        """Toggle business details active/inactive. Returns (success, is_active)."""
        business = BusinessDetails.objects.first()
        if not business:
            return False, None
        with transaction.atomic():
            business.is_active = not business.is_active
            business.save()
        return True, business.is_active


# =============================================================================
# WEBSITE CLIENT LOGOS (MAIN CLIENT MODEL)
# =============================================================================

class WebsiteClientLogoService:
    """Manage website logos stored on the main Client model."""

    @staticmethod
    def list_all():
        return PanelClient.objects.select_related('user').all().order_by('website_display_order', 'name', 'id')

    @staticmethod
    def get(pk):
        return get_object_or_404(PanelClient.objects.select_related('user'), pk=pk)

    @staticmethod
    def update_logo(pk, *, logo=None, remove_logo=False, website_is_visible=None, website_display_order=None):
        _validate_image_upload(logo, 'logo')
        with transaction.atomic():
            client = get_object_or_404(PanelClient, pk=pk)
            dirty = False

            if remove_logo and client.website_logo:
                try:
                    client.website_logo.delete(save=False)
                except Exception:
                    logger.warning("Failed deleting previous client logo for client %d", pk)
                client.website_logo = None
                dirty = True

            if logo is not None:
                if client.website_logo:
                    try:
                        client.website_logo.delete(save=False)
                    except Exception:
                        logger.warning("Failed deleting previous client logo for client %d", pk)
                client.website_logo = logo
                dirty = True

            if website_is_visible is not None and client.website_is_visible != bool(website_is_visible):
                client.website_is_visible = bool(website_is_visible)
                dirty = True

            if website_display_order is not None:
                try:
                    order_value = int(website_display_order)
                except (TypeError, ValueError):
                    raise ValidationError('Display order must be a valid number.')
                if order_value < 0:
                    raise ValidationError('Display order cannot be negative.')
                if client.website_display_order != order_value:
                    client.website_display_order = order_value
                    dirty = True

            if dirty:
                client.save()

        if dirty:
            cache.delete('home_sections')
        return client


# =============================================================================
# TESTIMONIALS / REVIEWS
# =============================================================================

class TestimonialService:
    """CRUD for Testimonial (reviews)."""

    @staticmethod
    def list_all():
        """Return queryset ordered by newest first."""
        return Testimonial.objects.all().order_by('-created_at')

    @staticmethod
    def get(pk):
        """Return a single Testimonial or raise 404."""
        return get_object_or_404(Testimonial, pk=pk)

    @staticmethod
    def create(*, reviewer_name='', reviewer_title='', reviewer_school='',
               text='', tag='', rating=5, is_active=False, reviewer_avatar=None):
        """Create a Testimonial. Returns the created instance."""
        _validate_image_upload(reviewer_avatar, 'reviewer avatar')
        rating_val = max(1, min(5, int(rating)))  # Clamp rating to 1–5
        with transaction.atomic():
            review = Testimonial(
                reviewer_name=reviewer_name,
                reviewer_title=reviewer_title,
                reviewer_school=reviewer_school,
                text=text,
                tag=tag,
                rating=rating_val,
                is_active=is_active,
            )
            if reviewer_avatar:
                review.reviewer_avatar = reviewer_avatar
            review.save()
        return review

    @staticmethod
    def create_public(*, reviewer_name, reviewer_school, text, rating=5):
        """
        Public testimonial submission (requires admin approval).
        Always created with is_active=False.
        """
        rating_val = max(1, min(5, int(rating)))
        with transaction.atomic():
            review = Testimonial.objects.create(
                reviewer_name=reviewer_name,
                reviewer_school=reviewer_school,
                text=text,
                rating=rating_val,
                is_active=False,
            )
        return review

    @staticmethod
    def update(pk, *, reviewer_name=None, reviewer_title=None,
               reviewer_school=None, text=None, tag=None,
               rating=None, is_active=None, reviewer_avatar=None):
        """Update a Testimonial. Only non-None fields are changed."""
        _validate_image_upload(reviewer_avatar, 'reviewer avatar')
        with transaction.atomic():
            review = get_object_or_404(Testimonial, pk=pk)
            for field, value in [
                ('reviewer_name', reviewer_name),
                ('reviewer_title', reviewer_title),
                ('reviewer_school', reviewer_school),
                ('text', text),
                ('tag', tag),
            ]:
                if value is not None:
                    setattr(review, field, value)
            if rating is not None:
                review.rating = max(1, min(5, int(rating)))  # Clamp to 1–5
            if is_active is not None:
                review.is_active = _parse_bool(is_active)
            if reviewer_avatar:
                review.reviewer_avatar = reviewer_avatar
            review.save()
        return review

    @staticmethod
    def delete(pk):
        """Delete a Testimonial by pk."""
        with transaction.atomic():
            review = get_object_or_404(Testimonial, pk=pk)
            # Clean up avatar file from disk
            if review.reviewer_avatar:
                try:
                    review.reviewer_avatar.delete(save=False)
                except Exception:
                    logger.warning("Failed to delete avatar file for Testimonial %d", pk)
            review.delete()

    @staticmethod
    def toggle(pk):
        """Toggle active/inactive (approval). Returns new is_active value."""
        with transaction.atomic():
            review = get_object_or_404(Testimonial, pk=pk)
            review.is_active = not review.is_active
            review.save()
        return review.is_active


# =============================================================================
# PORTFOLIO ITEMS
# =============================================================================

class PortfolioItemService:
    """CRUD for PortfolioItem (our works gallery)."""

    @staticmethod
    def list_all():
        """Return queryset with category, ordered by position then newest."""
        return PortfolioItem.objects.select_related('category').all().order_by('order', '-created_at')

    @staticmethod
    def get(pk):
        """Return a single PortfolioItem or raise 404."""
        return get_object_or_404(PortfolioItem, pk=pk)

    @staticmethod
    def create(*, category_id=None, orientation='', item_type='image',
               video_url='', order=0, is_active=True, is_featured=False,
               image=None, video_file=None):
        """Create a PortfolioItem with auto-generated title. Returns the instance.
        Type and orientation are auto-detected from uploaded files."""
        _validate_image_upload(image, 'portfolio image')
        _validate_video_upload(video_file, 'portfolio video')

        requested_type = (item_type or '').strip().lower()

        # Auto-detect type from uploads, but preserve explicit reel selection.
        if video_file:
            item_type = requested_type if requested_type in ('video', 'reel') else 'video'
        elif image:
            item_type = 'image'
        else:
            item_type = requested_type if requested_type in ('image', 'video', 'reel') else 'image'

        # Auto-detect orientation from image dimensions
        if image and item_type == 'image':
            orientation = _detect_orientation(image)

        title = _build_portfolio_item_title(category_id)

        with transaction.atomic():
            item = PortfolioItem(
                title=title,
                description='',
                orientation=orientation,
                item_type=item_type,
                video_url=video_url,
                order=int(order),
                is_active=is_active,
                is_featured=is_featured,
            )
            if category_id:
                item.category_id = int(category_id)
            if image:
                item.image = image
            if video_file:
                item.video_file = video_file
            item.save()
        return item

    @staticmethod
    def update(pk, *, orientation=None, item_type=None, video_url=None,
               category_id=None, order=None, is_active=None, is_featured=None,
               image=None, video_file=None):
        """Update a PortfolioItem. Only non-None fields are changed.
        Type and orientation are auto-detected from uploaded files."""
        _validate_image_upload(image, 'portfolio image')
        _validate_video_upload(video_file, 'portfolio video')

        requested_type = (item_type or '').strip().lower() if item_type is not None else None

        # Auto-detect type from new uploads, but preserve explicit reel selection.
        if video_file:
            item_type = requested_type if requested_type in ('video', 'reel') else 'video'
        elif image and not video_file:
            item_type = 'image'
        elif requested_type in ('image', 'video', 'reel'):
            item_type = requested_type

        # Auto-detect orientation from new image
        if image:
            orientation = _detect_orientation(image)

        with transaction.atomic():
            item = get_object_or_404(PortfolioItem, pk=pk)
            category_changed = False
            for field, value in [
                ('orientation', orientation),
                ('item_type', item_type),
            ]:
                if value is not None:
                    setattr(item, field, value)

            if video_url is not None:
                item.video_url = video_url

            if category_id is not None:
                new_category_id = int(category_id) if category_id else None
                category_changed = (item.category_id != new_category_id)
                item.category_id = new_category_id

            if order is not None:
                item.order = int(order)
            if is_active is not None:
                item.is_active = _parse_bool(is_active)
            if is_featured is not None:
                item.is_featured = _parse_bool(is_featured)
            if image:
                item.image = image
            if video_file:
                item.video_file = video_file

            # Keep generated naming pattern in sync when category changes.
            if category_changed:
                item.title = _build_portfolio_item_title(item.category_id)

            # When switching to image, clear video sources so type changes are reflected.
            if item.item_type == 'image':
                if item.video_file:
                    try:
                        item.video_file.delete(save=False)
                    except Exception:
                        logger.warning("Failed to delete previous video file for PortfolioItem %d", pk)
                item.video_file = None
                item.video_url = ''

            item.save()
        return item

    @staticmethod
    def delete(pk):
        """Delete a PortfolioItem by pk."""
        with transaction.atomic():
            item = get_object_or_404(PortfolioItem, pk=pk)
            old_video_name = item.video_file.name if item.video_file else ''
            # Clean up image and video files from disk
            for field in ('image', 'video_file'):
                file_field = getattr(item, field, None)
                if file_field:
                    try:
                        file_field.delete(save=False)
                    except Exception:
                        logger.warning("Failed to delete %s file for PortfolioItem %d", field, pk)
            if old_video_name:
                purge_portfolio_video_derivatives(old_video_name)
            item.delete()

    @staticmethod
    def toggle(pk):
        """Toggle active/inactive. Returns new is_active value."""
        with transaction.atomic():
            item = get_object_or_404(PortfolioItem, pk=pk)
            item.is_active = not item.is_active
            item.save()
        return item.is_active


# =============================================================================
# PORTFOLIO CATEGORIES
# =============================================================================

class PortfolioCategoryService:
    """CRUD for PortfolioCategory."""

    @staticmethod
    def list_all():
        """Return queryset ordered by position."""
        return PortfolioCategory.objects.all().order_by('order')

    @staticmethod
    def create(*, name='', icon='fas fa-folder', description='',
               order=0, is_bento=False, bento_size='normal'):
        """Create a PortfolioCategory. Returns the created instance."""
        with transaction.atomic():
            cat = PortfolioCategory.objects.create(
                name=name,
                icon=icon,
                description=description,
                order=int(order),
                is_bento=_parse_bool(is_bento),
                bento_size=bento_size,
            )
        return cat

    @staticmethod
    def update(pk, *, name=None, icon=None, description=None,
               order=None, is_active=None, is_bento=None, bento_size=None):
        """Update a PortfolioCategory. Only non-None fields are changed."""
        with transaction.atomic():
            cat = get_object_or_404(PortfolioCategory, pk=pk)
            for field, value in [
                ('name', name),
                ('icon', icon),
                ('description', description),
            ]:
                if value is not None:
                    setattr(cat, field, value)
            if order is not None:
                cat.order = int(order)
            if is_active is not None:
                cat.is_active = _parse_bool(is_active)
            if is_bento is not None:
                cat.is_bento = _parse_bool(is_bento)
            if bento_size in ('large', 'normal'):
                cat.bento_size = bento_size
            cat.save()
        return cat

    @staticmethod
    def delete(pk):
        """Delete a PortfolioCategory. Raises 400 if default."""
        cat = get_object_or_404(PortfolioCategory, pk=pk)
        if cat.is_default:
            raise ValueError('Cannot delete default categories')
        with transaction.atomic():
            cat.delete()

    @staticmethod
    def toggle(pk):
        """Toggle active/inactive. Returns new is_active value."""
        with transaction.atomic():
            cat = get_object_or_404(PortfolioCategory, pk=pk)
            cat.is_active = not cat.is_active
            cat.save()
        return cat.is_active


# =============================================================================
# HERO IMAGES
# =============================================================================

class HeroImageService:
    """CRUD for HeroImage (homepage carousel)."""

    @staticmethod
    def list_all():
        """Return queryset ordered by position."""
        return HeroImage.objects.order_by('order', 'pk')

    @staticmethod
    def create(*, image, title='', subtitle='', order=0):
        """Create a HeroImage. Returns the created instance."""
        _validate_image_upload(image, 'hero image')
        with transaction.atomic():
            hero = HeroImage.objects.create(
                image=image,
                title=title,
                subtitle=subtitle,
                order=int(order),
                is_active=True,
            )
        return hero

    @staticmethod
    def update(pk, *, title=None, subtitle=None, order=None,
               is_active=None, image=None):
        """Update a HeroImage. Only non-None fields are changed."""
        _validate_image_upload(image, 'hero image')
        with transaction.atomic():
            hero = get_object_or_404(HeroImage, pk=pk)
            if title is not None:
                hero.title = title
            if subtitle is not None:
                hero.subtitle = subtitle
            if order is not None:
                hero.order = int(order)
            if is_active is not None:
                hero.is_active = _parse_bool(is_active)
            if image:
                hero.image = image
            hero.save()
        return hero

    @staticmethod
    def delete(pk):
        """Delete a HeroImage by pk."""
        with transaction.atomic():
            hero = get_object_or_404(HeroImage, pk=pk)
            # Clean up image file from disk
            if hero.image:
                try:
                    hero.image.delete(save=False)
                except Exception:
                    logger.warning("Failed to delete image file for HeroImage %d", pk)
            hero.delete()

    @staticmethod
    def reorder(order_list):
        """
        Reorder hero images.
        order_list: list of pk values in desired order.
        """
        with transaction.atomic():
            for idx, pk in enumerate(order_list):
                HeroImage.objects.filter(pk=pk).update(order=idx + 1)


# =============================================================================
# CONTACT SUBMISSIONS
# =============================================================================

class ContactSubmissionService:
    """Handles public contact form submissions and admin management."""

    @staticmethod
    def list_all():
        """Return all contact submissions ordered by creation date (newest first)."""
        return ContactSubmission.objects.all().order_by('-created_at')

    @staticmethod
    def list_by_status(status):
        """Return submissions filtered by status."""
        return ContactSubmission.objects.filter(status=status).order_by('-created_at')

    @staticmethod
    def get(pk):
        """Return a single submission by ID or raise DoesNotExist."""
        return ContactSubmission.objects.get(pk=pk)

    @staticmethod
    def create(*, name, email, phone='', subject, message):
        """
        Create a ContactSubmission and attempt email notification.
        Returns the created submission.
        """
        with transaction.atomic():
            submission = ContactSubmission.objects.create(
                name=name,
                email=email,
                phone=phone,
                subject=subject,
                message=message,
            )
        # Email notification is best-effort, never blocks
        try:
            from .email_utils import send_contact_email
            send_contact_email(submission)
        except Exception:
            logger.warning("Email send failed for contact submission %s", submission.id)
        return submission

    @staticmethod
    def update_status(pk, status):
        """Update the status of a contact submission."""
        valid_statuses = ['new', 'read', 'replied', 'closed']
        if status not in valid_statuses:
            raise ValueError(f"Invalid status: {status}. Must be one of {valid_statuses}")
        with transaction.atomic():
            submission = ContactSubmission.objects.select_for_update().get(pk=pk)
            submission.status = status
            submission.save(update_fields=['status', 'updated_at'])
        return submission

    @staticmethod
    def delete(pk):
        """Delete a contact submission by ID."""
        with transaction.atomic():
            submission = ContactSubmission.objects.get(pk=pk)
            submission.delete()
        return True

    @staticmethod
    def get_stats():
        """Return aggregated stats for contact submissions."""
        from django.db.models import Count, Q
        return ContactSubmission.objects.aggregate(
            total=Count('id'),
            new=Count('id', filter=Q(status='new')),
            read=Count('id', filter=Q(status='read')),
            replied=Count('id', filter=Q(status='replied')),
            closed=Count('id', filter=Q(status='closed')),
        )


# =============================================================================
# REELS
# =============================================================================

class ReelService:
    """CRUD for Reel (short video reels)."""

    @staticmethod
    def list_all():
        """Return queryset ordered by position."""
        return Reel.objects.all().order_by('order', '-created_at')

    @staticmethod
    def get(pk):
        """Return a single Reel or raise 404."""
        return get_object_or_404(Reel, pk=pk)

    @staticmethod
    def create(*, title='', order=0, is_active=True,
               video_file=None, thumbnail=None):
        """Create a Reel. Returns the created instance. No captions."""
        _validate_video_upload(video_file, 'reel video')
        _validate_image_upload(thumbnail, 'reel thumbnail')
        if not title:
            title = f'Reel {uuid.uuid4().hex[:6].upper()}'

        # Watermark reel thumbnail and compress video to <10 MB
        if thumbnail:
            thumbnail = apply_logo_watermark(thumbnail)
        if video_file:
            video_file = normalize_portfolio_video_upload(video_file)

        with transaction.atomic():
            reel = Reel(
                title=title,
                description='',  # no captions
                order=int(order),
                is_active=is_active,
            )
            if video_file:
                reel.video_file = video_file
            if thumbnail:
                reel.thumbnail = thumbnail
            reel.save()
        return reel

    @staticmethod
    def update(pk, *, title=None, order=None, is_active=None,
               video_file=None, thumbnail=None):
        """Update a Reel. Only non-None fields are changed."""
        _validate_video_upload(video_file, 'reel video')
        _validate_image_upload(thumbnail, 'reel thumbnail')

        # Watermark new thumbnail and compress new video when replacing
        if thumbnail:
            thumbnail = apply_logo_watermark(thumbnail)
        if video_file:
            video_file = normalize_portfolio_video_upload(video_file)

        with transaction.atomic():
            reel = get_object_or_404(Reel, pk=pk)
            if title is not None:
                reel.title = title
            if order is not None:
                reel.order = int(order)
            if is_active is not None:
                reel.is_active = _parse_bool(is_active)
            if video_file:
                reel.video_file = video_file
            if thumbnail:
                reel.thumbnail = thumbnail
            reel.save()
        return reel

    @staticmethod
    def delete(pk):
        """Delete a Reel by pk."""
        with transaction.atomic():
            reel = get_object_or_404(Reel, pk=pk)
            for field in ('video_file', 'thumbnail'):
                file_field = getattr(reel, field, None)
                if file_field:
                    try:
                        file_field.delete(save=False)
                    except Exception:
                        logger.warning("Failed to delete %s file for Reel %d", field, pk)
            reel.delete()

    @staticmethod
    def toggle(pk):
        """Toggle active/inactive. Returns new is_active value."""
        with transaction.atomic():
            reel = get_object_or_404(Reel, pk=pk)
            reel.is_active = not reel.is_active
            reel.save()
        return reel.is_active
