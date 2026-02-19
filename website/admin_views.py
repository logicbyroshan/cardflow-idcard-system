"""
Website Admin Views
===================
Dashboard + CRUD API for managing public website content.
Mounted at /panel/website/

Architecture rule: Views are ULTRA-THIN.
  - Validate request (parse POST/FILES/JSON)
  - Call WebsiteService method
  - Return JsonResponse
  - NO .save(), .create(), .delete(), .update() on any model
"""
import json
import logging

from django.core.exceptions import ValidationError
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from core.services.permission_service import (
    PermissionService,
    api_require_permission,
)
from core.services.activity_service import ActivityService

from .models import (
    BusinessDetails,
    Feature,
    HeroImage,
    PortfolioCategory,
    PortfolioItem,
    TrustedClient,
    Testimonial,
    Reel,
    FAQ,
    ContactSubmission,
    WebsiteStatus,
)
from .services import (
    WebsiteStatusService,
    BusinessDetailsService,
    TrustedClientService,
    TestimonialService,
    PortfolioItemService,
    PortfolioCategoryService,
    HeroImageService,
    _parse_bool,
)


# =============================================================================
# DECORATORS — thin wrappers delegating to PermissionService (single authority)
# =============================================================================

def website_admin_required(view_func):
    """Require perm_website_view (super_admin auto-passes via PermissionService.has)."""
    from functools import wraps

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
            from django.shortcuts import redirect
            return redirect('/panel/auth/login/')
        if not PermissionService.has(user, 'perm_website_view'):
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'success': False, 'message': 'Website access denied'}, status=403)
            from django.shortcuts import redirect
            return redirect('/panel/')
        return view_func(request, *args, **kwargs)
    return wrapper


def website_edit_required(view_func):
    """Require perm_website_edit (super_admin auto-passes via PermissionService.has)."""
    from functools import wraps

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        if not PermissionService.has(user, 'perm_website_edit'):
            return JsonResponse({'success': False, 'message': 'Edit permission required'}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper


def website_add_required(view_func):
    """Require perm_website_add (super_admin auto-passes via PermissionService.has)."""
    from functools import wraps

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        if not PermissionService.has(user, 'perm_website_add'):
            return JsonResponse({'success': False, 'message': 'Add permission required'}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper


def website_delete_required(view_func):
    """Require perm_website_delete (super_admin auto-passes via PermissionService.has)."""
    from functools import wraps

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        if not PermissionService.has(user, 'perm_website_delete'):
            return JsonResponse({'success': False, 'message': 'Delete permission required'}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper


def website_publish_required(view_func):
    """Require perm_website_publish (super_admin auto-passes via PermissionService.has)."""
    from functools import wraps

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        if not PermissionService.has(user, 'perm_website_publish'):
            return JsonResponse({'success': False, 'message': 'Publish permission required'}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper


# =============================================================================
# HELPER
# =============================================================================

def _get_base_context(request, active_tab='overview'):
    """Common context for all website admin pages."""
    perms = PermissionService.get_permission_context(request.user)
    perms.update({
        'active_page': 'manage_website',
        'active_tab': active_tab,
        'user_role': request.user.get_role_display() if hasattr(request.user, 'get_role_display') else 'User',
    })
    return perms


# =============================================================================
# PAGE VIEWS
# =============================================================================

@website_admin_required
def website_dashboard(request):
    """Website Admin Dashboard — overview with stat cards."""
    context = _get_base_context(request, 'overview')

    # Stats
    context['total_portfolio'] = PortfolioItem.objects.count()
    context['active_portfolio'] = PortfolioItem.objects.filter(is_active=True).count()
    context['total_reviews'] = Testimonial.objects.count()
    context['active_reviews'] = Testimonial.objects.filter(is_active=True).count()
    context['total_clients'] = TrustedClient.objects.count()
    context['active_clients'] = TrustedClient.objects.filter(is_active=True).count()
    context['total_features'] = Feature.objects.count()
    context['total_reels'] = Reel.objects.count()
    context['total_contacts'] = ContactSubmission.objects.count()
    context['new_contacts'] = ContactSubmission.objects.filter(status='new').count()
    context['website_status'] = WebsiteStatus.get_status()
    context['total_hero_images'] = HeroImage.objects.count()
    context['active_hero_images'] = HeroImage.objects.filter(is_active=True).count()
    context['total_categories'] = PortfolioCategory.objects.count()
    context['bento_categories_count'] = PortfolioCategory.objects.filter(is_bento=True).count()

    return render(request, 'website/admin/dashboard.html', context)


@website_admin_required
def business_details_page(request):
    """Business Details management page."""
    context = _get_base_context(request, 'business')
    business = BusinessDetails.objects.first()
    context['business'] = business
    context['hero_images'] = HeroImage.objects.order_by('order', 'pk')
    return render(request, 'website/admin/business-details.html', context)


@website_admin_required
def clients_page(request):
    """Trusted Clients / Partners management page."""
    context = _get_base_context(request, 'clients')
    context['clients_list'] = TrustedClient.objects.all().order_by('order')
    return render(request, 'website/admin/clients.html', context)


@website_admin_required
def reviews_page(request):
    """Reviews / Testimonials management page."""
    context = _get_base_context(request, 'reviews')
    context['reviews'] = Testimonial.objects.all().order_by('-created_at')
    return render(request, 'website/admin/reviews.html', context)


@website_admin_required
def portfolio_page(request):
    """Our Works / Portfolio management page."""
    context = _get_base_context(request, 'portfolio')
    PortfolioCategory.ensure_defaults()
    context['items'] = PortfolioItem.objects.select_related('category').all().order_by('order', '-created_at')
    context['categories'] = PortfolioCategory.objects.all().order_by('order')
    return render(request, 'website/admin/portfolio.html', context)


# =============================================================================
# API — WEBSITE STATUS
# =============================================================================

@require_POST
@website_publish_required
def api_toggle_website_status(request):
    """Toggle website between Live and Draft."""
    try:
        new_status = WebsiteStatusService.toggle_status()
        # Clear middleware cache so the change takes effect immediately
        from django.core.cache import cache
        cache.delete('website_status_cache')
        ActivityService.log_website_update(request, f'status changed to {new_status}')
        return JsonResponse({'success': True, 'status': new_status})
    except Exception as e:
        logging.getLogger(__name__).exception("Toggle website status error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


# =============================================================================
# API — BUSINESS DETAILS
# =============================================================================

@require_POST
@website_edit_required
def api_business_update(request):
    """Create or update business details (singleton)."""
    try:
        data = {}
        for f in BusinessDetailsService.EDITABLE_FIELDS + ['is_active']:
            val = request.POST.get(f)
            if val is not None:
                data[f] = val
        BusinessDetailsService.update(data)
        ActivityService.log_website_update(request, 'business details')
        return JsonResponse({'success': True, 'message': 'Business details updated'})
    except Exception as e:
        logging.getLogger(__name__).exception("Business update error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_POST
@website_edit_required
def api_business_toggle_status(request):
    """Toggle business details active/inactive."""
    try:
        success, is_active = BusinessDetailsService.toggle_status()
        if not success:
            return JsonResponse({'success': False, 'message': 'No business details found'}, status=404)
        return JsonResponse({'success': True, 'is_active': is_active})
    except Exception as e:
        logging.getLogger(__name__).exception("Business toggle status error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


# =============================================================================
# API — TRUSTED CLIENTS
# =============================================================================

@website_admin_required
def api_client_list(request):
    """List trusted clients."""
    qs = TrustedClientService.list_all()
    data = [{
        'id': c.id,
        'name': c.name,
        'logo': c.logo.url if c.logo else None,
        'order': c.order,
        'is_active': c.is_active,
    } for c in qs]
    return JsonResponse({'success': True, 'clients': data})


@require_POST
@website_add_required
def api_client_create(request):
    """Create a trusted client."""
    try:
        client = TrustedClientService.create(
            name=request.POST.get('name', ''),
            order=int(request.POST.get('order', 0)),
            is_active=_parse_bool(request.POST.get('is_active', 'true')),
            logo=request.FILES.get('logo'),
        )
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    return JsonResponse({'success': True, 'message': 'Client created', 'id': client.id})


@website_admin_required
def api_client_get(request, pk):
    """Get a single trusted client."""
    c = TrustedClientService.get(pk)
    return JsonResponse({
        'success': True,
        'client': {
            'id': c.id,
            'name': c.name,
            'logo': c.logo.url if c.logo else None,
            'order': c.order,
            'is_active': c.is_active,
        }
    })


@require_POST
@website_edit_required
def api_client_update(request, pk):
    """Update a trusted client."""
    try:
        TrustedClientService.update(
            pk,
            name=request.POST.get('name'),
            order=request.POST.get('order'),
            is_active=request.POST.get('is_active'),
            logo=request.FILES.get('logo'),
        )
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    return JsonResponse({'success': True, 'message': 'Client updated'})


@require_POST
@website_delete_required
def api_client_delete(request, pk):
    """Delete a trusted client."""
    try:
        TrustedClientService.delete(pk)
        return JsonResponse({'success': True, 'message': 'Client deleted'})
    except Exception as e:
        logging.getLogger(__name__).exception("Client delete error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_POST
@website_edit_required
def api_client_toggle(request, pk):
    """Toggle trusted client active/inactive."""
    try:
        is_active = TrustedClientService.toggle(pk)
        return JsonResponse({'success': True, 'is_active': is_active})
    except Exception as e:
        logging.getLogger(__name__).exception("Client toggle error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


# =============================================================================
# API — TESTIMONIALS / REVIEWS
# =============================================================================

@website_admin_required
def api_review_list(request):
    """List testimonials."""
    qs = TestimonialService.list_all()
    data = [{
        'id': r.id,
        'reviewer_name': r.reviewer_name,
        'reviewer_title': r.reviewer_title,
        'reviewer_school': r.reviewer_school,
        'reviewer_avatar': r.reviewer_avatar.url if r.reviewer_avatar else None,
        'rating': r.rating,
        'text': r.text,
        'tag': r.tag,
        'is_active': r.is_active,
        'created_at': r.created_at.strftime('%Y-%m-%d'),
    } for r in qs]
    return JsonResponse({'success': True, 'reviews': data})


@require_POST
@website_add_required
def api_review_create(request):
    """Create a testimonial."""
    try:
        review = TestimonialService.create(
            reviewer_name=request.POST.get('reviewer_name', ''),
            reviewer_title=request.POST.get('reviewer_title', ''),
            reviewer_school=request.POST.get('reviewer_school', ''),
            text=request.POST.get('text', ''),
            tag=request.POST.get('tag', ''),
            rating=int(request.POST.get('rating', 5)),
            is_active=_parse_bool(request.POST.get('is_active', 'false')),
            reviewer_avatar=request.FILES.get('reviewer_avatar'),
        )
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    return JsonResponse({'success': True, 'message': 'Review created', 'id': review.id})


@website_admin_required
def api_review_get(request, pk):
    """Get a single review."""
    r = TestimonialService.get(pk)
    return JsonResponse({
        'success': True,
        'review': {
            'id': r.id,
            'reviewer_name': r.reviewer_name,
            'reviewer_title': r.reviewer_title,
            'reviewer_school': r.reviewer_school,
            'reviewer_avatar': r.reviewer_avatar.url if r.reviewer_avatar else None,
            'rating': r.rating,
            'text': r.text,
            'tag': r.tag,
            'is_active': r.is_active,
        }
    })


@require_POST
@website_edit_required
def api_review_update(request, pk):
    """Update a testimonial."""
    try:
        TestimonialService.update(
            pk,
            reviewer_name=request.POST.get('reviewer_name'),
            reviewer_title=request.POST.get('reviewer_title'),
            reviewer_school=request.POST.get('reviewer_school'),
            text=request.POST.get('text'),
            tag=request.POST.get('tag'),
            rating=request.POST.get('rating'),
            is_active=request.POST.get('is_active'),
            reviewer_avatar=request.FILES.get('reviewer_avatar'),
        )
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    return JsonResponse({'success': True, 'message': 'Review updated'})


@require_POST
@website_delete_required
def api_review_delete(request, pk):
    """Delete a testimonial."""
    try:
        TestimonialService.delete(pk)
        return JsonResponse({'success': True, 'message': 'Review deleted'})
    except Exception as e:
        logging.getLogger(__name__).exception("Review delete error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_POST
@website_edit_required
def api_review_toggle(request, pk):
    """Toggle review active/inactive (approval)."""
    try:
        is_active = TestimonialService.toggle(pk)
        return JsonResponse({'success': True, 'is_active': is_active})
    except Exception as e:
        logging.getLogger(__name__).exception("Review toggle error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


# =============================================================================
# API — PORTFOLIO / OUR WORKS
# =============================================================================

@website_admin_required
def api_portfolio_list(request):
    """List portfolio items."""
    qs = PortfolioItemService.list_all()
    data = [{
        'id': p.id,
        'image': p.image.url if p.image else None,
        'category': p.category.name if p.category else '—',
        'category_id': p.category_id,
        'orientation': p.orientation,
        'item_type': p.item_type,
        'video_url': p.video_url or None,
        'video_file': p.video_file.url if p.video_file else None,
        'order': p.order,
        'is_active': p.is_active,
        'is_featured': p.is_featured,
    } for p in qs]
    return JsonResponse({'success': True, 'items': data})


@require_POST
@website_add_required
def api_portfolio_create(request):
    """Create a portfolio item."""
    try:
        item = PortfolioItemService.create(
            category_id=request.POST.get('category'),
            orientation=request.POST.get('orientation', ''),
            item_type=request.POST.get('item_type', 'image'),
            video_url=request.POST.get('video_url', ''),
            order=int(request.POST.get('order', 0)),
            is_active=_parse_bool(request.POST.get('is_active', 'true')),
            is_featured=_parse_bool(request.POST.get('is_featured', 'false')),
            image=request.FILES.get('image'),
            video_file=request.FILES.get('video_file'),
        )
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    return JsonResponse({'success': True, 'message': 'Portfolio item created', 'id': item.id})


@website_admin_required
def api_portfolio_get(request, pk):
    """Get a single portfolio item."""
    p = PortfolioItemService.get(pk)
    return JsonResponse({
        'success': True,
        'item': {
            'id': p.id,
            'image': p.image.url if p.image else None,
            'category_id': p.category_id,
            'orientation': p.orientation,
            'item_type': p.item_type,
            'video_url': p.video_url,
            'video_file': p.video_file.url if p.video_file else None,
            'order': p.order,
            'is_active': p.is_active,
            'is_featured': p.is_featured,
        }
    })


@require_POST
@website_edit_required
def api_portfolio_update(request, pk):
    """Update a portfolio item."""
    try:
        PortfolioItemService.update(
            pk,
            orientation=request.POST.get('orientation'),
            item_type=request.POST.get('item_type'),
            video_url=request.POST.get('video_url'),
            category_id=request.POST.get('category'),
            order=request.POST.get('order'),
            is_active=request.POST.get('is_active'),
            is_featured=request.POST.get('is_featured'),
            image=request.FILES.get('image'),
            video_file=request.FILES.get('video_file'),
        )
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    return JsonResponse({'success': True, 'message': 'Portfolio item updated'})


@require_POST
@website_delete_required
def api_portfolio_delete(request, pk):
    """Delete a portfolio item."""
    try:
        PortfolioItemService.delete(pk)
        return JsonResponse({'success': True, 'message': 'Portfolio item deleted'})
    except Exception as e:
        logging.getLogger(__name__).exception("Portfolio delete error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_POST
@website_edit_required
def api_portfolio_toggle(request, pk):
    """Toggle portfolio item active/inactive."""
    try:
        is_active = PortfolioItemService.toggle(pk)
        return JsonResponse({'success': True, 'is_active': is_active})
    except Exception as e:
        logging.getLogger(__name__).exception("Portfolio toggle error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


# =============================================================================
# API — PORTFOLIO CATEGORIES
# =============================================================================

@website_admin_required
def api_portfolio_category_list(request):
    """List portfolio categories."""
    cats = PortfolioCategoryService.list_all()
    data = [{
        'id': c.id,
        'name': c.name,
        'slug': c.slug,
        'icon': c.icon,
        'description': c.description,
        'is_default': c.is_default,
        'is_bento': c.is_bento,
        'bento_size': c.bento_size,
        'order': c.order,
        'is_active': c.is_active,
        'items_count': c.items.count(),
    } for c in cats]
    return JsonResponse({'success': True, 'categories': data})


@require_POST
@website_add_required
def api_portfolio_category_create(request):
    """Create a portfolio category."""
    try:
        body = json.loads(request.body) if request.content_type == 'application/json' else request.POST
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid request data'}, status=400)
    cat = PortfolioCategoryService.create(
        name=body.get('name', ''),
        icon=body.get('icon', 'fas fa-folder'),
        description=body.get('description', ''),
        order=int(body.get('order', 0)),
        is_bento=body.get('is_bento', False),
        bento_size=body.get('bento_size', 'normal'),
    )
    return JsonResponse({'success': True, 'message': 'Category created', 'id': cat.id, 'slug': cat.slug})


@require_POST
@website_edit_required
def api_portfolio_category_update(request, pk):
    """Update a portfolio category."""
    try:
        body = json.loads(request.body) if request.content_type == 'application/json' else request.POST
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid request data'}, status=400)
    PortfolioCategoryService.update(
        pk,
        name=body.get('name'),
        icon=body.get('icon'),
        description=body.get('description'),
        order=body.get('order'),
        is_active=body.get('is_active'),
        is_bento=body.get('is_bento'),
        bento_size=body.get('bento_size'),
    )
    return JsonResponse({'success': True, 'message': 'Category updated'})


@require_POST
@website_delete_required
def api_portfolio_category_delete(request, pk):
    """Delete a portfolio category (only non-default)."""
    try:
        PortfolioCategoryService.delete(pk)
    except ValueError as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)
    return JsonResponse({'success': True, 'message': 'Category deleted'})


# =============================================================================
# API — HERO IMAGES
# =============================================================================

@website_edit_required
def api_hero_image_list(request):
    """GET: return all hero images ordered by position."""
    images = HeroImageService.list_all()
    data = [
        {
            'id': img.pk,
            'image_url': img.image.url if img.image else '',
            'title': img.title,
            'subtitle': img.subtitle,
            'order': img.order,
            'is_active': img.is_active,
        }
        for img in images
    ]
    return JsonResponse({'success': True, 'images': data})


@require_POST
@website_add_required
def api_hero_image_create(request):
    """POST: upload a new hero image."""
    image_file = request.FILES.get('image')
    if not image_file:
        return JsonResponse({'success': False, 'message': 'Image file is required'}, status=400)

    try:
        hero = HeroImageService.create(
            image=image_file,
            title=request.POST.get('title', ''),
            subtitle=request.POST.get('subtitle', ''),
            order=int(request.POST.get('order', 0)),
        )
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    ActivityService.log_website_update(request, 'hero image added')
    return JsonResponse({
        'success': True,
        'message': 'Hero image added',
        'id': hero.pk,
        'image_url': hero.image.url,
    })


@require_POST
@website_edit_required
def api_hero_image_update(request, pk):
    """POST: update hero image details (replace image optional)."""
    try:
        HeroImageService.update(
            pk,
            title=request.POST.get('title'),
            subtitle=request.POST.get('subtitle'),
            order=request.POST.get('order'),
            is_active=request.POST.get('is_active'),
            image=request.FILES.get('image'),
        )
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    ActivityService.log_website_update(request, 'hero image updated')
    return JsonResponse({'success': True, 'message': 'Hero image updated'})


@require_POST
@website_delete_required
def api_hero_image_delete(request, pk):
    """POST: delete a hero image."""
    try:
        HeroImageService.delete(pk)
        ActivityService.log_website_update(request, 'hero image deleted')
        return JsonResponse({'success': True, 'message': 'Hero image deleted'})
    except Exception as e:
        logging.getLogger(__name__).exception("Hero image delete error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_POST
@website_edit_required
def api_hero_image_reorder(request):
    """POST: reorder hero images. Body: { "order": [id1, id2, ...] }"""
    try:
        data = json.loads(request.body)
        order_list = data.get('order', [])
        HeroImageService.reorder(order_list)
        return JsonResponse({'success': True, 'message': 'Order updated'})
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid data'}, status=400)
