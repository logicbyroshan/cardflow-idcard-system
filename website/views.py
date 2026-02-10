from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.core.cache import cache
from django.db.models import Avg
import logging

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
        cache.set('business_details', business, 300)  # 5 minutes

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
    
    # Dynamic hero images (ordered, active only)
    hero_images = HeroImage.objects.filter(is_active=True).order_by('order', 'pk')
    context['hero_images'] = hero_images
    
    # We fetch featured items specifically for the home page
    context.update({
        'features': Feature.objects.filter(is_active=True).order_by('order')[:6],
        'trusted_clients': TrustedClient.objects.filter(is_active=True).order_by('order'),
        
        # We split portfolio by orientation or feature status for layout variety
        'featured_portfolio': PortfolioItem.objects.filter(is_active=True, is_featured=True).order_by('order'),
        'recent_portfolio': PortfolioItem.objects.filter(is_active=True).order_by('-created_at')[:8],
        
        'testimonials': Testimonial.objects.filter(is_active=True).order_by('-review_date')[:5],
    })
    return render(request, 'website/index.html', context)


def our_work(request):
    """Portfolio Page: Shows all items filtered by category"""
    context = get_common_context()
    
    # Ensure default categories exist
    PortfolioCategory.ensure_defaults()
    
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
    
    # Build category cover images (first image per category)
    category_images = {}
    for cat in categories:
        cover = cat.cover_image_url
        category_images[str(cat.id)] = cover
    
    # Separate reel-type items for the reels section
    portfolio_reels = items.filter(item_type='reel')
    
    # Get first 10 active reels for initial load (dedicated Reel model)
    reels = Reel.objects.filter(is_active=True).order_by('order')[:10]
    total_reels = Reel.objects.filter(is_active=True).count()
    
    context.update({
        'portfolio_items': items,
        'categories': categories,
        'bento_categories': categories.filter(is_bento=True),
        'extra_categories': categories.filter(is_bento=False),
        'category_images': category_images,
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
            'video_url': reel.video_url or None,
            'views_count': reel.views_count,
            'likes_count': reel.likes_count,
        })
    
    return JsonResponse({
        'reels': reels_data,
        'total': total_reels,
        'has_more': offset + limit < total_reels,
    })


# --- REMOVED: Trusted Clients standalone page (backed up to backups/trusted_clients_page/) ---
# def trusted_clients_view(request):
#     """Clients Page: Displays the full list of schools/corporates served"""
#     context = get_common_context()
#     clients = TrustedClient.objects.filter(is_active=True).order_by('order')
#     context.update({'clients': clients})
#     return render(request, 'website/trusted-clients.html', context)


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
def submit_testimonial(request):
    """Handles AJAX submission of a new review (Public)"""
    try:
        name = request.POST.get('name', '').strip()
        school = request.POST.get('school', '').strip()
        text = request.POST.get('text', '').strip()
        rating = request.POST.get('rating', '5')

        if not all([name, school, text]):
            return JsonResponse({'success': False, 'message': 'All fields are required.'}, status=400)

        # Validate and clamp rating
        try:
            rating_val = int(rating)
        except (ValueError, TypeError):
            rating_val = 5
        rating_val = max(1, min(5, rating_val))

        Testimonial.objects.create(
            reviewer_name=name,
            reviewer_school=school,
            text=text,
            rating=rating_val,
            is_active=False  # Requires Admin Approval
        )
        return JsonResponse({'success': True, 'message': 'Review submitted! It will appear once approved.'})
    except Exception as e:
        logger.error(f"Testimonial submission failed: {e}")
        return JsonResponse({'success': False, 'message': 'Server error. Please try again later.'}, status=500)


@require_POST
def submit_contact(request):
    """Handles AJAX submission of the contact form"""
    try:
        name = request.POST.get('name', '').strip()
        email = request.POST.get('email', '').strip()
        phone = request.POST.get('phone', '').strip()
        subject = request.POST.get('subject', '').strip()
        message = request.POST.get('message', '').strip()

        if not all([name, email, subject, message]):
            return JsonResponse({'success': False, 'message': 'Please fill required fields.'}, status=400)

        # Validate email format
        try:
            validate_email(email)
        except ValidationError:
            return JsonResponse({'success': False, 'message': 'Please enter a valid email address.'}, status=400)

        # Create the lead in the DB
        submission = ContactSubmission.objects.create(
            name=name,
            email=email,
            phone=phone,
            subject=subject,
            message=message
        )

        # Attempt to send email notification
        try:
            from .email_utils import send_contact_email
            send_contact_email(submission)
        except Exception:
            logger.warning(f"Email send failed for contact submission {submission.id}")

        return JsonResponse({'success': True, 'message': 'Message sent successfully!'})
    except Exception as e:
        logger.error(f"Contact form submission failed: {e}")
        return JsonResponse({'success': False, 'message': 'Server error. Please try again later.'}, status=500)
