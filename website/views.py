from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.core.cache import cache
from django.db.models import Avg
import logging

from accounts.rate_limit import rate_limit

logger = logging.getLogger(__name__)

from .models import (
    BusinessDetails, 
    Feature, 
    HeroImage,
    PortfolioCategory,
    PortfolioItem, 
    TrustedClient, 
    Testimonial, 
    ContactSubmission,
    FAQ,
    Reel
)

# ==========================================
# DISPLAY LIMITS
# ==========================================
HOME_FEATURES_LIMIT = 6
HOME_RECENT_PORTFOLIO_LIMIT = 8
HOME_TESTIMONIALS_LIMIT = 5
CATEGORY_IMAGES_LIMIT = 10
REELS_INITIAL_LIMIT = 10
BUSINESS_CACHE_TTL = 300  # 5 minutes

# ==========================================
# HELPER FUNCTIONS
# ==========================================

def get_common_context():
    """
    Returns global data required by the navbar and footer on every page.
    Caches BusinessDetails for 5 minutes to avoid querying on every page load.
    """
    business = cache.get('business_details')
    if business is None:
        business = BusinessDetails.objects.first()
        cache.set('business_details', business, BUSINESS_CACHE_TTL)

    return {
        'business': business,
        'site_name': business.site_name if business else 'Adarsh ID Cards',
    }


# ==========================================
# PAGE VIEWS
# ==========================================

def home(request):
    """Homepage: Displays a summary of all sections"""
    context = get_common_context()
    
    # Dynamic hero images (cached 60s)
    hero_images = cache.get('home_hero_images')
    if hero_images is None:
        hero_images = list(HeroImage.objects.filter(is_active=True).order_by('order', 'pk'))
        cache.set('home_hero_images', hero_images, 60)
    context['hero_images'] = hero_images
    
    # Website section data (cached 60s)
    home_sections = cache.get('home_sections')
    if home_sections is None:
        home_sections = {
            'features': list(Feature.objects.filter(is_active=True).order_by('order')[:HOME_FEATURES_LIMIT]),
            'trusted_clients': list(TrustedClient.objects.filter(is_active=True).order_by('order')),
            'featured_portfolio': list(PortfolioItem.objects.filter(is_active=True, is_featured=True).order_by('order')),
            'recent_portfolio': list(PortfolioItem.objects.filter(is_active=True).order_by('-created_at')[:HOME_RECENT_PORTFOLIO_LIMIT]),
            'testimonials': list(Testimonial.objects.filter(is_active=True).order_by('-review_date')[:HOME_TESTIMONIALS_LIMIT]),
        }
        cache.set('home_sections', home_sections, 60)
    context.update(home_sections)
    return render(request, 'website/index.html', context)


def our_work(request):
    """Portfolio Page: Shows all items filtered by category"""
    context = get_common_context()
    
    # Ensure default categories exist (cached to avoid 9 queries per page load)
    if not cache.get('portfolio_defaults_ensured'):
        PortfolioCategory.ensure_defaults()
        cache.set('portfolio_defaults_ensured', True, 3600)
    
    # Get active categories
    categories = PortfolioCategory.objects.filter(is_active=True).order_by('order')
    
    # Get all active items with custom ordering:
    # Items with order > 0 first (sorted by order ASC), then order=0 sorted by latest first
    from django.db.models import Case, When, Value, IntegerField
    items = PortfolioItem.objects.filter(is_active=True).select_related('category').annotate(
        has_order=Case(
            When(order__gt=0, then=Value(0)),
            default=Value(1),
            output_field=IntegerField()
        )
    ).order_by('has_order', 'order', '-created_at')
    
    # Build category images for bento card sliding effect (multiple images per category)
    # Fetch all items with images in ONE query, then group in Python (avoids N+1)
    items_with_images = list(
        items.filter(image__isnull=False).exclude(image='').values_list('category_id', 'image')
    )
    from collections import defaultdict
    from django.conf import settings as _s
    _cat_img_map = defaultdict(list)
    for cat_id, img_path in items_with_images:
        if img_path and len(_cat_img_map[cat_id]) < CATEGORY_IMAGES_LIMIT:
            _cat_img_map[cat_id].append(f'{_s.MEDIA_URL}{img_path}')
    category_images = {str(cat.id): _cat_img_map.get(cat.id, []) for cat in categories}

    # Build category items data for gallery modal (images + videos with orientation)
    _cat_items_map = defaultdict(list)
    for item in items:
        cat_id = str(item.category_id) if item.category_id else None
        if not cat_id:
            continue
        entry = {
            'type': item.item_type or 'image',
            'orientation': item.orientation or 'square',
            'title': item.title or '',
        }
        if item.image:
            entry['image'] = item.image.url
        if item.video_file:
            entry['video'] = item.video_file.url
        elif item.video_url:
            entry['video'] = item.video_url
        _cat_items_map[cat_id].append(entry)
    category_items = dict(_cat_items_map)
    
    # Separate reel-type items for the reels section
    portfolio_reels = items.filter(item_type='reel')
    
    # Get reels count + initial page in a single queryset evaluation
    reels_qs = Reel.objects.filter(is_active=True).order_by('order')
    total_reels = reels_qs.count()
    reels = reels_qs[:REELS_INITIAL_LIMIT]
    
    context.update({
        'portfolio_items': items,
        'categories': categories,
        'bento_categories': categories.filter(is_bento=True),
        'extra_categories': categories.filter(is_bento=False),
        'category_images': category_images,
        'category_items': category_items,
        'portfolio_reels': portfolio_reels,
        'reels': reels,
        'total_reels': total_reels,
    })
    return render(request, 'website/our-works.html', context)


def load_more_reels(request):
    """API endpoint to load more reels for infinite scroll"""
    try:
        offset = max(0, int(request.GET.get('offset', 0)))
        limit = min(max(1, int(request.GET.get('limit', 10))), 50)
    except (ValueError, TypeError):
        return JsonResponse({'error': 'Invalid parameters'}, status=400)
    
    reels = Reel.objects.filter(is_active=True).order_by('order')[offset:offset + limit]
    total_reels = Reel.objects.filter(is_active=True).count()
    
    reels_data = []
    for reel in reels:
        reels_data.append({
            'id': reel.id,
            'title': reel.title,
            'description': reel.description or 'Watch our showcase',
            'thumbnail': reel.thumbnail.url if reel.thumbnail else None,
            'video_file': reel.video_file.url if reel.video_file else None,
            'video_url': reel.video_url or None,
            'views_count': reel.views_count,
            'likes_count': reel.likes_count,
        })
    
    return JsonResponse({
        'reels': reels_data,
        'total': total_reels,
        'has_more': offset + limit < total_reels,
    })


def why_choose_us(request):
    """About/Features Page"""
    context = get_common_context()
    context.update({
        'features': Feature.objects.filter(is_active=True).order_by('order'),
        'faqs': FAQ.objects.filter(is_active=True).order_by('order'),
    })
    return render(request, 'website/why-choose-us.html', context)


def testimonials_page(request):
    """Reviews Page: Text testimonials"""
    context = get_common_context()
    
    all_active = Testimonial.objects.filter(is_active=True).order_by('-review_date')
    
    # Calculate stats
    avg_rating = all_active.aggregate(avg=Avg('rating'))['avg'] or 5.0
    
    context.update({
        'text_testimonials': all_active,
        'avg_rating': round(avg_rating, 1),
        'total_reviews': all_active.count(),
    })
    return render(request, 'website/testimonials.html', context)


def privacy_policy(request):
    """Privacy Policy Page - Static content, only needs base context"""
    context = get_common_context()
    return render(request, 'website/privacy-policy.html', context)


# ==========================================
# AJAX FORM SUBMISSIONS
# ==========================================

@require_POST
@rate_limit(max_requests=3, window_seconds=300, key_prefix='public_review')
def submit_testimonial(request):
    """Handles AJAX submission of a new review (Public)"""
    try:
        from .services import TestimonialService
        name = request.POST.get('name', '').strip()
        school = request.POST.get('school', '').strip()
        text = request.POST.get('text', '').strip()
        rating = request.POST.get('rating', '5')

        if not all([name, school, text]):
            return JsonResponse({'success': False, 'message': 'All fields are required.'}, status=400)

        try:
            rating_val = max(1, min(5, int(rating)))
        except (ValueError, TypeError):
            rating_val = 5

        TestimonialService.create_public(
            reviewer_name=name,
            reviewer_school=school,
            text=text,
            rating=rating_val,
        )
        return JsonResponse({'success': True, 'message': 'Review submitted! It will appear once approved.'})
    except Exception as e:
        logger.error("Testimonial submission failed: %s", e)
        return JsonResponse({'success': False, 'message': 'Server error. Please try again later.'}, status=500)


@require_POST
@rate_limit(max_requests=5, window_seconds=300, key_prefix='public_contact')
def submit_contact(request):
    """Handles AJAX submission of the contact form"""
    try:
        from .services import ContactSubmissionService
        name = request.POST.get('name', '').strip()
        email = request.POST.get('email', '').strip()
        phone = request.POST.get('phone', '').strip()
        subject = request.POST.get('subject', '').strip()
        message = request.POST.get('message', '').strip()

        if not all([name, email, subject, message]):
            return JsonResponse({'success': False, 'message': 'Please fill required fields.'}, status=400)

        try:
            validate_email(email)
        except ValidationError:
            return JsonResponse({'success': False, 'message': 'Please enter a valid email address.'}, status=400)

        ContactSubmissionService.create(
            name=name,
            email=email,
            phone=phone,
            subject=subject,
            message=message,
        )
        return JsonResponse({'success': True, 'message': 'Message sent successfully!'})
    except Exception as e:
        logger.error("Contact form submission failed: %s", e)
        return JsonResponse({'success': False, 'message': 'Server error. Please try again later.'}, status=500)
