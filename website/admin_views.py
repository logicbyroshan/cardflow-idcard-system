"""
Website Admin Views

Dashboard + CRUD API for managing public website content.
Mounted at /panel/website/
"""
import json

from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from core.services.permission_service import PermissionService
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


# =============================================================================
# DECORATORS
# =============================================================================

def website_admin_required(view_func):
    """Require super_admin or admin_staff with perm_website_view."""
    from functools import wraps

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
            from django.shortcuts import redirect
            return redirect('/panel/auth/login/')
        if not (PermissionService.is_super_admin(user) or PermissionService.has_permission(user, 'perm_website_view')):
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'success': False, 'message': 'Website access denied'}, status=403)
            from django.shortcuts import redirect
            return redirect('/panel/')
        return view_func(request, *args, **kwargs)
    return wrapper


def website_edit_required(view_func):
    """Require super_admin or perm_website_edit for write operations."""
    from functools import wraps

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        if not (PermissionService.is_super_admin(user) or PermissionService.has_permission(user, 'perm_website_edit')):
            return JsonResponse({'success': False, 'message': 'Edit permission required'}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper


def website_add_required(view_func):
    """Require super_admin or perm_website_add for create operations."""
    from functools import wraps

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        if not (PermissionService.is_super_admin(user) or PermissionService.has_permission(user, 'perm_website_add')):
            return JsonResponse({'success': False, 'message': 'Add permission required'}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper


def website_delete_required(view_func):
    """Require super_admin or perm_website_delete for delete operations."""
    from functools import wraps

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        if not (PermissionService.is_super_admin(user) or PermissionService.has_permission(user, 'perm_website_delete')):
            return JsonResponse({'success': False, 'message': 'Delete permission required'}, status=403)
        return view_func(request, *args, **kwargs)
    return wrapper


def website_publish_required(view_func):
    """Require super_admin or perm_website_publish for publish operations."""
    from functools import wraps

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
        if not (PermissionService.is_super_admin(user) or PermissionService.has_permission(user, 'perm_website_publish')):
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
    obj, _ = WebsiteStatus.objects.get_or_create(pk=1)
    obj.status = 'draft' if obj.status == 'live' else 'live'
    obj.save()
    ActivityService.log_website_update(request, f'status changed to {obj.status}')
    return JsonResponse({'success': True, 'status': obj.status})


# =============================================================================
# API — BUSINESS DETAILS
# =============================================================================

@require_POST
@website_edit_required
def api_business_update(request):
    """Create or update business details (singleton)."""
    business, _ = BusinessDetails.objects.get_or_create(pk=1)

    fields = [
        'site_name', 'tagline', 'address', 'phone', 'email', 'working_hours',
        'facebook_url', 'instagram_url', 'twitter_url', 'whatsapp_number',
        'hero_title', 'hero_description', 'meta_description', 'meta_keywords',
        'footer_text',
    ]
    for f in fields:
        val = request.POST.get(f)
        if val is not None:
            setattr(business, f, val)

    # Handle is_active toggle
    is_active = request.POST.get('is_active')
    if is_active is not None:
        business.is_active = is_active in ('true', '1', 'on', 'True')

    # Legacy hero_image1-4 fields are kept on model for backward compat
    # but new uploads go through the HeroImage API (/api/hero-images/create/)

    business.save()
    ActivityService.log_website_update(request, 'business details')
    return JsonResponse({'success': True, 'message': 'Business details updated'})


@require_POST
@website_edit_required
def api_business_toggle_status(request):
    """Toggle business details active/inactive."""
    business = BusinessDetails.objects.first()
    if not business:
        return JsonResponse({'success': False, 'message': 'No business details found'}, status=404)
    business.is_active = not business.is_active
    business.save()
    return JsonResponse({'success': True, 'is_active': business.is_active})


# =============================================================================
# API — TRUSTED CLIENTS
# =============================================================================

@website_admin_required
def api_client_list(request):
    """List trusted clients."""
    qs = TrustedClient.objects.all().order_by('order')
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
    client = TrustedClient(
        name=request.POST.get('name', ''),
        order=int(request.POST.get('order', 0)),
        is_active=request.POST.get('is_active', 'true') in ('true', '1', 'on', 'True'),
    )
    logo = request.FILES.get('logo')
    if logo:
        client.logo = logo
    client.save()
    return JsonResponse({'success': True, 'message': 'Client created', 'id': client.id})


@website_admin_required
def api_client_get(request, pk):
    """Get a single trusted client."""
    c = get_object_or_404(TrustedClient, pk=pk)
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
    c = get_object_or_404(TrustedClient, pk=pk)
    name = request.POST.get('name')
    if name is not None:
        c.name = name
    order = request.POST.get('order')
    if order is not None:
        c.order = int(order)
    is_active = request.POST.get('is_active')
    if is_active is not None:
        c.is_active = is_active in ('true', '1', 'on', 'True')
    logo = request.FILES.get('logo')
    if logo:
        c.logo = logo
    c.save()
    return JsonResponse({'success': True, 'message': 'Client updated'})


@require_POST
@website_delete_required
def api_client_delete(request, pk):
    """Delete a trusted client."""
    c = get_object_or_404(TrustedClient, pk=pk)
    c.delete()
    return JsonResponse({'success': True, 'message': 'Client deleted'})


@require_POST
@website_edit_required
def api_client_toggle(request, pk):
    """Toggle trusted client active/inactive."""
    c = get_object_or_404(TrustedClient, pk=pk)
    c.is_active = not c.is_active
    c.save()
    return JsonResponse({'success': True, 'is_active': c.is_active})


# =============================================================================
# API — TESTIMONIALS / REVIEWS
# =============================================================================

@website_admin_required
def api_review_list(request):
    """List testimonials."""
    qs = Testimonial.objects.all().order_by('-created_at')
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
    review = Testimonial(
        reviewer_name=request.POST.get('reviewer_name', ''),
        reviewer_title=request.POST.get('reviewer_title', ''),
        reviewer_school=request.POST.get('reviewer_school', ''),
        text=request.POST.get('text', ''),
        tag=request.POST.get('tag', ''),
        rating=int(request.POST.get('rating', 5)),
        is_active=request.POST.get('is_active', 'false') in ('true', '1', 'on', 'True'),
    )
    avatar = request.FILES.get('reviewer_avatar')
    if avatar:
        review.reviewer_avatar = avatar
    review.save()
    return JsonResponse({'success': True, 'message': 'Review created', 'id': review.id})


@website_admin_required
def api_review_get(request, pk):
    """Get a single review."""
    r = get_object_or_404(Testimonial, pk=pk)
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
    r = get_object_or_404(Testimonial, pk=pk)
    for f in ['reviewer_name', 'reviewer_title', 'reviewer_school', 'text', 'tag']:
        val = request.POST.get(f)
        if val is not None:
            setattr(r, f, val)
    rating = request.POST.get('rating')
    if rating is not None:
        r.rating = int(rating)
    is_active = request.POST.get('is_active')
    if is_active is not None:
        r.is_active = is_active in ('true', '1', 'on', 'True')
    avatar = request.FILES.get('reviewer_avatar')
    if avatar:
        r.reviewer_avatar = avatar
    r.save()
    return JsonResponse({'success': True, 'message': 'Review updated'})


@require_POST
@website_delete_required
def api_review_delete(request, pk):
    """Delete a testimonial."""
    r = get_object_or_404(Testimonial, pk=pk)
    r.delete()
    return JsonResponse({'success': True, 'message': 'Review deleted'})


@require_POST
@website_edit_required
def api_review_toggle(request, pk):
    """Toggle review active/inactive (approval)."""
    r = get_object_or_404(Testimonial, pk=pk)
    r.is_active = not r.is_active
    r.save()
    return JsonResponse({'success': True, 'is_active': r.is_active})


# =============================================================================
# API — PORTFOLIO / OUR WORKS
# =============================================================================

@website_admin_required
def api_portfolio_list(request):
    """List portfolio items."""
    qs = PortfolioItem.objects.select_related('category').all().order_by('order', '-created_at')
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
    import uuid
    cat_id = request.POST.get('category')
    
    # Auto-generate title from category name
    title = 'Portfolio Item'
    if cat_id:
        try:
            cat = PortfolioCategory.objects.get(pk=int(cat_id))
            title = f"{cat.name} {uuid.uuid4().hex[:6].upper()}"
        except PortfolioCategory.DoesNotExist:
            title = f"Item {uuid.uuid4().hex[:6].upper()}"
    else:
        title = f"Item {uuid.uuid4().hex[:6].upper()}"
    
    item = PortfolioItem(
        title=title,
        description='',
        orientation=request.POST.get('orientation', ''),
        item_type=request.POST.get('item_type', 'image'),
        video_url=request.POST.get('video_url', ''),
        order=int(request.POST.get('order', 0)),
        is_active=request.POST.get('is_active', 'true') in ('true', '1', 'on', 'True'),
        is_featured=request.POST.get('is_featured', 'false') in ('true', '1', 'on', 'True'),
    )
    if cat_id:
        item.category_id = int(cat_id)
    img = request.FILES.get('image')
    if img:
        item.image = img
    vid = request.FILES.get('video_file')
    if vid:
        item.video_file = vid
    item.save()
    return JsonResponse({'success': True, 'message': 'Portfolio item created', 'id': item.id})


@website_admin_required
def api_portfolio_get(request, pk):
    """Get a single portfolio item."""
    p = get_object_or_404(PortfolioItem, pk=pk)
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
    p = get_object_or_404(PortfolioItem, pk=pk)
    for f in ['orientation', 'item_type', 'video_url']:
        val = request.POST.get(f)
        if val is not None:
            setattr(p, f, val)
    cat_id = request.POST.get('category')
    if cat_id is not None:
        p.category_id = int(cat_id) if cat_id else None
    order = request.POST.get('order')
    if order is not None:
        p.order = int(order)
    is_active = request.POST.get('is_active')
    if is_active is not None:
        p.is_active = is_active in ('true', '1', 'on', 'True')
    is_featured = request.POST.get('is_featured')
    if is_featured is not None:
        p.is_featured = is_featured in ('true', '1', 'on', 'True')
    img = request.FILES.get('image')
    if img:
        p.image = img
    vid = request.FILES.get('video_file')
    if vid:
        p.video_file = vid
    p.save()
    return JsonResponse({'success': True, 'message': 'Portfolio item updated'})


@require_POST
@website_delete_required
def api_portfolio_delete(request, pk):
    """Delete a portfolio item."""
    p = get_object_or_404(PortfolioItem, pk=pk)
    p.delete()
    return JsonResponse({'success': True, 'message': 'Portfolio item deleted'})


@require_POST
@website_edit_required
def api_portfolio_toggle(request, pk):
    """Toggle portfolio item active/inactive."""
    p = get_object_or_404(PortfolioItem, pk=pk)
    p.is_active = not p.is_active
    p.save()
    return JsonResponse({'success': True, 'is_active': p.is_active})


# =============================================================================
# API — PORTFOLIO CATEGORIES
# =============================================================================

@website_admin_required
def api_portfolio_category_list(request):
    """List portfolio categories."""
    cats = PortfolioCategory.objects.all().order_by('order')
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
    body = json.loads(request.body) if request.content_type == 'application/json' else request.POST
    cat = PortfolioCategory.objects.create(
        name=body.get('name', ''),
        icon=body.get('icon', 'fas fa-folder'),
        description=body.get('description', ''),
        order=int(body.get('order', 0)),
        is_bento=body.get('is_bento', False) in (True, 'true', '1', 'on'),
        bento_size=body.get('bento_size', 'normal'),
    )
    return JsonResponse({'success': True, 'message': 'Category created', 'id': cat.id, 'slug': cat.slug})


@require_POST
@website_edit_required
def api_portfolio_category_update(request, pk):
    """Update a portfolio category."""
    cat = get_object_or_404(PortfolioCategory, pk=pk)
    body = json.loads(request.body) if request.content_type == 'application/json' else request.POST
    for f in ['name', 'icon', 'description']:
        val = body.get(f)
        if val is not None:
            setattr(cat, f, val)
    order = body.get('order')
    if order is not None:
        cat.order = int(order)
    is_active = body.get('is_active')
    if is_active is not None:
        cat.is_active = is_active in (True, 'true', '1', 'on')
    is_bento = body.get('is_bento')
    if is_bento is not None:
        cat.is_bento = is_bento in (True, 'true', '1', 'on')
    bento_size = body.get('bento_size')
    if bento_size in ('large', 'normal'):
        cat.bento_size = bento_size
    cat.save()
    return JsonResponse({'success': True, 'message': 'Category updated'})


@require_POST
@website_delete_required
def api_portfolio_category_delete(request, pk):
    """Delete a portfolio category (only non-default)."""
    cat = get_object_or_404(PortfolioCategory, pk=pk)
    if cat.is_default:
        return JsonResponse({'success': False, 'message': 'Cannot delete default categories'}, status=400)
    cat.delete()
    return JsonResponse({'success': True, 'message': 'Category deleted'})


# =============================================================================
# API — HERO IMAGES
# =============================================================================

@website_edit_required
def api_hero_image_list(request):
    """GET: return all hero images ordered by position."""
    images = HeroImage.objects.order_by('order', 'pk')
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

    title = request.POST.get('title', '')
    subtitle = request.POST.get('subtitle', '')
    order = int(request.POST.get('order', 0))

    hero = HeroImage.objects.create(
        image=image_file,
        title=title,
        subtitle=subtitle,
        order=order,
        is_active=True,
    )
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
    hero = get_object_or_404(HeroImage, pk=pk)

    title = request.POST.get('title')
    subtitle = request.POST.get('subtitle')
    order = request.POST.get('order')
    is_active = request.POST.get('is_active')

    if title is not None:
        hero.title = title
    if subtitle is not None:
        hero.subtitle = subtitle
    if order is not None:
        hero.order = int(order)
    if is_active is not None:
        hero.is_active = is_active in ('true', '1', 'on', 'True')

    new_image = request.FILES.get('image')
    if new_image:
        hero.image = new_image

    hero.save()
    ActivityService.log_website_update(request, 'hero image updated')
    return JsonResponse({'success': True, 'message': 'Hero image updated'})


@require_POST
@website_delete_required
def api_hero_image_delete(request, pk):
    """POST: delete a hero image."""
    hero = get_object_or_404(HeroImage, pk=pk)
    hero.delete()
    ActivityService.log_website_update(request, 'hero image deleted')
    return JsonResponse({'success': True, 'message': 'Hero image deleted'})


@require_POST
@website_edit_required
def api_hero_image_reorder(request):
    """POST: reorder hero images. Body: { "order": [id1, id2, ...] }"""
    try:
        data = json.loads(request.body)
        order_list = data.get('order', [])
        for idx, pk in enumerate(order_list):
            HeroImage.objects.filter(pk=pk).update(order=idx + 1)
        return JsonResponse({'success': True, 'message': 'Order updated'})
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid data'}, status=400)
