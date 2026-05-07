"""
Manage Website Views
===================
Dashboard + CRUD API for managing public website content.
Mounted at /dashboard (on main domain adarshbhopal.in)

Architecture rule: Views are ULTRA-THIN.
  - Validate request (parse POST/FILES/JSON)
  - Call WebsiteService method
  - Return JsonResponse
  - NO .save(), .create(), .delete(), .update() on any model
"""
import json
import logging

from django.core.exceptions import ValidationError
from django.core.paginator import Paginator
from django.shortcuts import render, get_object_or_404, redirect
from django.http import Http404, JsonResponse
from django.views.decorators.http import require_POST, require_GET

from core.services.permission_service import (
    PermissionService,
)
from core.services.activity_service import ActivityService
from core.models import SystemSettings
from accounts.rate_limit import rate_limit
from core.utils.email_utils import (
    send_emergency_panel_access_email,
    send_not_found_mode_enabled_broadcast,
)
from client.models import Client as PanelClient

from website.models import (
    BusinessDetails,
    Feature,
    PortfolioCategory,
    PortfolioItem,
    Testimonial,
    FAQ,
    ContactSubmission,
    WebsiteStatus,
)
from website.services import (
    WebsiteStatusService,
    BusinessDetailsService,
    WebsiteClientLogoService,
    TestimonialService,
    PortfolioItemService,
    PortfolioCategoryService,
    ContactSubmissionService,
    _parse_bool,
)
from website.views import BENTO_FORCE_INCLUDE_SLUGS, BENTO_FORCE_EXCLUDE_SLUGS


# =============================================================================
# DECORATORS — thin wrappers delegating to PermissionService (single authority)
# =============================================================================

def _is_ajax_or_api_request(request) -> bool:
    return (
        request.headers.get('X-Requested-With') == 'XMLHttpRequest'
        or request.path.startswith('/dashboard/api/')
    )


def _permission_denied_for_website(request, message='Website access denied'):
    if _is_ajax_or_api_request(request):
        return JsonResponse({'success': False, 'message': message}, status=403)
    return redirect('/panel/')


def _auth_required_for_website(request):
    if _is_ajax_or_api_request(request):
        return JsonResponse({'success': False, 'message': 'Authentication required'}, status=401)
    return redirect('/accounts/login/')


def _website_permission_required(*permission_names, denied_message='Website access denied'):
    from functools import wraps

    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            user = request.user
            if not user.is_authenticated:
                return _auth_required_for_website(request)
            if not any(PermissionService.has(user, perm) for perm in permission_names):
                return _permission_denied_for_website(request, denied_message)
            return view_func(request, *args, **kwargs)

        return wrapper

    return decorator


def website_admin_required(view_func):
    """Require admin website access permission."""
    return _website_permission_required(
        'perm_website_view',
        'perm_website_add',
        'perm_website_edit',
        'perm_website_delete',
        'perm_website_publish',
    )(view_func)


def website_view_required(view_func):
    """Require general website admin access permission."""
    return _website_permission_required('perm_website_view')(view_func)


def website_clients_read_required(view_func):
    """Require Clients tab read access permission."""
    return website_admin_required(view_func)


def website_clients_manage_required(view_func):
    """Require Clients tab manage permission."""
    return _website_permission_required('perm_website_edit')(view_func)


def website_portfolio_read_required(view_func):
    """Require Portfolio tab read access permission."""
    return website_admin_required(view_func)


def website_portfolio_add_required(view_func):
    """Require Portfolio tab create/add permission."""
    return _website_permission_required('perm_website_add')(view_func)


def website_portfolio_edit_required(view_func):
    """Require Portfolio tab edit/toggle permission."""
    return _website_permission_required('perm_website_edit')(view_func)


def website_portfolio_delete_required(view_func):
    """Require Portfolio tab delete permission."""
    return _website_permission_required('perm_website_delete')(view_func)


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

def _get_base_context(request, active_tab='business'):
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
    """Route Website root to the first allowed tab for this user."""
    user = request.user
    if PermissionService.has(user, 'perm_website_view'):
        return redirect('manage_website:business')
    if PermissionService.has(user, 'perm_website_add'):
        return redirect('manage_website:portfolio')
    if PermissionService.has(user, 'perm_website_edit'):
        return redirect('manage_website:clients')
    if PermissionService.has(user, 'perm_website_publish'):
        return redirect('manage_website:business')
    return redirect('/panel/')


@website_view_required
def business_details_page(request):
    """Business Details management page."""
    context = _get_base_context(request, 'business')
    business = BusinessDetails.objects.first()
    context['business'] = business
    context['website_status'] = WebsiteStatus.get_status()
    context['website_not_found_mode'] = SystemSettings.get_value('website_not_found_mode', 'false') == 'true'
    context['can_publish_website'] = PermissionService.has(request.user, 'perm_website_publish')
    context['can_send_pro_access_link'] = PermissionService.is_pro_user(request.user)
    return render(request, 'website/admin/business-details.html', context)


@website_clients_read_required
def clients_page(request):
    """Website client logo management page (uses main Client records)."""
    context = _get_base_context(request, 'clients')

    visibility_filter = (
        request.GET.get('visibility', '')
        or request.GET.get('status', '')
        or ''
    ).strip().lower()
    if visibility_filter not in ('visible', 'hidden'):
        visibility_filter = ''

    clients_qs = PanelClient.objects.select_related('user').all().order_by('website_display_order', 'name', 'id')
    if visibility_filter == 'visible':
        clients_qs = clients_qs.filter(website_is_visible=True)
    elif visibility_filter == 'hidden':
        clients_qs = clients_qs.filter(website_is_visible=False)

    per_page_options = [10, 25, 50, 100]
    default_per_page = 25
    try:
        per_page = int(request.GET.get('per_page', default_per_page))
        if per_page not in per_page_options:
            per_page = default_per_page
    except (TypeError, ValueError):
        per_page = default_per_page

    paginator = Paginator(clients_qs, per_page)
    page_obj = paginator.get_page(request.GET.get('page', 1))

    page_count = len(page_obj.object_list)
    if paginator.count:
        page_start = ((page_obj.number - 1) * per_page) + 1
        page_end = page_start + page_count - 1
    else:
        page_start = 0
        page_end = 0

    context['clients_list'] = page_obj.object_list
    context['current_visibility'] = visibility_filter
    context['current_status'] = visibility_filter
    context['page_obj'] = page_obj
    context['per_page'] = per_page
    context['per_page_options'] = per_page_options
    context['total_clients_count'] = paginator.count
    context['page_start'] = page_start
    context['page_end'] = page_end
    return render(request, 'website/admin/clients.html', context)


@website_view_required
def reviews_page(request):
    """Reviews / Testimonials management page."""
    context = _get_base_context(request, 'reviews')

    reviews_qs = Testimonial.objects.all().order_by('-created_at')

    per_page_options = [10, 25, 50, 100]
    default_per_page = 25
    try:
        per_page = int(request.GET.get('per_page', default_per_page))
        if per_page not in per_page_options:
            per_page = default_per_page
    except (TypeError, ValueError):
        per_page = default_per_page

    paginator = Paginator(reviews_qs, per_page)
    page_obj = paginator.get_page(request.GET.get('page', 1))

    page_count = len(page_obj.object_list)
    if paginator.count:
        page_start = ((page_obj.number - 1) * per_page) + 1
        page_end = page_start + page_count - 1
    else:
        page_start = 0
        page_end = 0

    context['reviews'] = page_obj.object_list
    context['page_obj'] = page_obj
    context['per_page'] = per_page
    context['per_page_options'] = per_page_options
    context['total_reviews_count'] = paginator.count
    context['page_start'] = page_start
    context['page_end'] = page_end
    return render(request, 'website/admin/reviews.html', context)


@website_portfolio_read_required
def portfolio_page(request):
    """Our Works / Portfolio management page."""
    from django.db.models import Count
    context = _get_base_context(request, 'portfolio')
    # Cache ensure_defaults to avoid 9 get_or_create queries per page load
    from django.core.cache import cache
    if not cache.get('portfolio_defaults_ensured'):
        PortfolioCategory.ensure_defaults()
        cache.set('portfolio_defaults_ensured', True, 3600)

    items_qs = PortfolioItem.objects.select_related('category').all().order_by('order', '-created_at')

    per_page_options = [10, 25, 50, 100]
    default_per_page = 25
    try:
        per_page = int(request.GET.get('per_page', default_per_page))
        if per_page not in per_page_options:
            per_page = default_per_page
    except (TypeError, ValueError):
        per_page = default_per_page

    paginator = Paginator(items_qs, per_page)
    page_obj = paginator.get_page(request.GET.get('page', 1))

    page_count = len(page_obj.object_list)
    if paginator.count:
        page_start = ((page_obj.number - 1) * per_page) + 1
        page_end = page_start + page_count - 1
    else:
        page_start = 0
        page_end = 0

    context['items'] = page_obj.object_list
    context['categories'] = PortfolioCategory.objects.annotate(item_count=Count('items')).order_by('order')
    context['public_bento_include_slugs'] = list(BENTO_FORCE_INCLUDE_SLUGS)
    context['public_bento_exclude_slugs'] = list(BENTO_FORCE_EXCLUDE_SLUGS)
    context['page_obj'] = page_obj
    context['per_page'] = per_page
    context['per_page_options'] = per_page_options
    context['total_items_count'] = paginator.count
    context['page_start'] = page_start
    context['page_end'] = page_end
    return render(request, 'website/admin/portfolio.html', context)


# =============================================================================
# API — WEBSITE STATUS
# =============================================================================

@require_GET
@website_publish_required
def api_website_status_summary(request):
    """Return website status summary used by website controls in panel UI."""
    not_found_mode = SystemSettings.get_value('website_not_found_mode', 'false') == 'true'
    return JsonResponse({
        'success': True,
        'website_status': WebsiteStatus.get_status(),
        'website_not_found_mode': not_found_mode,
        'can_send_pro_access_link': PermissionService.is_pro_user(request.user),
    })

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


@require_POST
@website_publish_required
def api_set_website_not_found_mode(request):
    """Enable/disable public website Not Found mode."""
    try:
        enabled = _parse_bool(request.POST.get('enabled', 'false'))
        previous_enabled = SystemSettings.get_value('website_not_found_mode', 'false') == 'true'

        SystemSettings.set_value(
            'website_not_found_mode',
            'true' if enabled else 'false',
            'When true, public website routes return 404 Not Found.',
        )

        from django.core.cache import cache
        cache.delete('website_not_found_mode_cache')

        if enabled and not previous_enabled:
            send_not_found_mode_enabled_broadcast(request=request, enabled_by=request.user)

        ActivityService.log_website_update(
            request,
            f"website not found mode {'enabled' if enabled else 'disabled'}",
        )
        return JsonResponse({'success': True, 'enabled': enabled})
    except Exception as e:
        logging.getLogger(__name__).exception("Toggle website not-found mode error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_POST
@website_publish_required
def api_send_pro_panel_access_link(request):
    """
    Pro-only endpoint: send tokenized panel access link email to an active account.
    Intended for emergency login support when website Not Found mode is active.
    """
    try:
        if not PermissionService.is_pro_user(request.user):
            return JsonResponse(
                {'success': False, 'message': 'Only Pro User can send emergency access links.'},
                status=403,
            )

        not_found_mode = SystemSettings.get_value('website_not_found_mode', 'false') == 'true'
        if not not_found_mode:
            return JsonResponse(
                {'success': False, 'message': 'Enable Domain Not Found Mode first.'},
                status=400,
            )

        email = (request.POST.get('email') or '').strip()
        if not email:
            return JsonResponse({'success': False, 'message': 'Email is required.'}, status=400)

        success, message = send_emergency_panel_access_email(
            target_email=email,
            request=request,
            issued_by=request.user,
        )
        if not success:
            return JsonResponse({'success': False, 'message': message}, status=400)

        ActivityService.log_website_update(
            request,
            f'pro emergency panel access link sent to {email}',
        )
        return JsonResponse({'success': True, 'message': message})
    except Exception as e:
        logging.getLogger(__name__).exception("Send pro panel access link error: %s", e)
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
# API — CLIENT LOGOS (MAIN CLIENT MODEL)
# =============================================================================

@require_GET
@website_clients_read_required
def api_client_list(request):
    """List panel clients for website logo management."""
    qs = WebsiteClientLogoService.list_all()
    data = [{
        'id': c.id,
        'name': c.name,
        'logo': c.website_logo.url if c.website_logo else None,
        'website_is_visible': bool(c.website_is_visible),
        'website_display_order': int(c.website_display_order or 0),
        'website_visibility_display': 'Visible' if c.website_is_visible else 'Hidden',
        'status': c.status,
        'status_display': c.get_status_display(),
        'created_at': c.created_at.strftime('%Y-%m-%d') if c.created_at else '',
    } for c in qs]
    return JsonResponse({'success': True, 'clients': data})


@require_POST
@website_clients_manage_required
def api_client_create(request):
    """Clients are created from Manage Clients panel, not Website tab."""
    return JsonResponse(
        {'success': False, 'message': 'Create client from Manage Clients page.'},
        status=400,
    )


@require_GET
@website_clients_read_required
def api_client_get(request, pk):
    """Get a single panel client for logo edit modal."""
    try:
        c = WebsiteClientLogoService.get(pk)
    except Http404:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)
    return JsonResponse({
        'success': True,
        'client': {
            'id': c.id,
            'name': c.name,
            'logo': c.website_logo.url if c.website_logo else None,
            'website_is_visible': bool(c.website_is_visible),
            'website_display_order': int(c.website_display_order or 0),
            'website_visibility_display': 'Visible' if c.website_is_visible else 'Hidden',
            'status': c.status,
            'status_display': c.get_status_display(),
        }
    })


@require_POST
@website_clients_manage_required
def api_client_update(request, pk):
    """Update website logo for a panel client."""
    try:
        logo = request.FILES.get('logo')
        remove_logo = _parse_bool(request.POST.get('remove_logo', 'false'))
        visibility_raw = request.POST.get('website_is_visible', None)
        website_is_visible = None
        if visibility_raw is not None and str(visibility_raw).strip() != '':
            website_is_visible = _parse_bool(visibility_raw)

        order_raw = request.POST.get('website_display_order', None)
        website_display_order = None
        if order_raw is not None and str(order_raw).strip() != '':
            try:
                website_display_order = int(str(order_raw).strip())
            except (TypeError, ValueError):
                return JsonResponse({'success': False, 'message': 'Display order must be a valid number.'}, status=400)

            if website_display_order < 0:
                return JsonResponse({'success': False, 'message': 'Display order cannot be negative.'}, status=400)
            if website_display_order > 9999:
                return JsonResponse({'success': False, 'message': 'Display order is too large.'}, status=400)

        if logo is None and not remove_logo and website_is_visible is None and website_display_order is None:
            return JsonResponse({'success': False, 'message': 'No changes submitted.'}, status=400)

        WebsiteClientLogoService.update_logo(
            pk,
            logo=logo,
            remove_logo=remove_logo,
            website_is_visible=website_is_visible,
            website_display_order=website_display_order,
        )
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    except Http404:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=404)
    return JsonResponse({'success': True, 'message': 'Client settings updated'})


@require_POST
@website_clients_manage_required
def api_client_delete(request, pk):
    """Clients are deleted from Manage Clients panel, not Website tab."""
    return JsonResponse(
        {'success': False, 'message': 'Delete client from Manage Clients page.'},
        status=400,
    )


@require_POST
@website_clients_manage_required
def api_client_toggle(request, pk):
    """Client status is managed from Manage Clients panel."""
    return JsonResponse(
        {'success': False, 'message': 'Client status can be changed from Manage Clients page.'},
        status=400,
    )


# =============================================================================
# API — TESTIMONIALS / REVIEWS
# =============================================================================

@require_GET
@website_view_required
def api_review_list(request):
    """List testimonials."""
    qs = TestimonialService.list_all()
    data = [{
        'id': r.id,
        'reviewer_name': r.reviewer_name,
        'reviewer_email': r.reviewer_email,
        'reviewer_title': r.reviewer_title,
        'reviewer_school': r.reviewer_school,
        'reviewer_avatar': r.reviewer_avatar.url if r.reviewer_avatar else None,
        'attachment_image': r.attachment_image.url if r.attachment_image else None,
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
            reviewer_email=request.POST.get('reviewer_email', ''),
            reviewer_title=request.POST.get('reviewer_title', ''),
            reviewer_school=request.POST.get('reviewer_school', ''),
            text=request.POST.get('text', ''),
            tag=request.POST.get('tag', ''),
            rating=int(request.POST.get('rating', 5)),
            is_active=_parse_bool(request.POST.get('is_active', 'false')),
            reviewer_avatar=request.FILES.get('reviewer_avatar'),
            attachment_image=request.FILES.get('attachment_image'),
        )
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    return JsonResponse({'success': True, 'message': 'Review created', 'id': review.id})


@require_GET
@website_view_required
def api_review_get(request, pk):
    """Get a single review."""
    try:
        r = TestimonialService.get(pk)
    except Http404:
        return JsonResponse({'success': False, 'message': 'Review not found'}, status=404)
    return JsonResponse({
        'success': True,
        'review': {
            'id': r.id,
            'reviewer_name': r.reviewer_name,
            'reviewer_email': r.reviewer_email,
            'reviewer_title': r.reviewer_title,
            'reviewer_school': r.reviewer_school,
            'reviewer_avatar': r.reviewer_avatar.url if r.reviewer_avatar else None,
            'attachment_image': r.attachment_image.url if r.attachment_image else None,
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
            reviewer_email=request.POST.get('reviewer_email'),
            reviewer_title=request.POST.get('reviewer_title'),
            reviewer_school=request.POST.get('reviewer_school'),
            text=request.POST.get('text'),
            tag=request.POST.get('tag'),
            rating=request.POST.get('rating'),
            is_active=request.POST.get('is_active'),
            reviewer_avatar=request.FILES.get('reviewer_avatar'),
            attachment_image=request.FILES.get('attachment_image'),
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

@require_GET
@website_portfolio_read_required
def api_portfolio_list(request):
    """List portfolio items."""
    qs = PortfolioItemService.list_all()
    data = [{
        'id': p.id,
        'title': p.title,
        'image': p.image.url if p.image else None,
        'category': p.category.name if p.category else '—',
        'category_id': p.category_id,
        'orientation': p.orientation,
        'item_type': p.item_type,
        'video_url': p.video_url or None,
        'video_file': p.video_file.url if p.video_file else None,
        'video_stream': p.video_stream_url or None,
        'video_fallback': p.video_fallback_url or None,
        'video_thumbnail': p.video_thumbnail_url or None,
        'order': p.order,
        'is_active': p.is_active,
        'is_featured': p.is_featured,
    } for p in qs]
    return JsonResponse({'success': True, 'items': data})


@require_POST
@website_portfolio_add_required
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


@require_POST
@rate_limit(max_requests=5, window_seconds=60, key_prefix='portfolio_bulk')
@website_portfolio_add_required
def api_portfolio_bulk_upload(request):
    """
    Bulk upload portfolio media.
    
    Accepts multipart form with:
      - images: multiple image files (max 50)
      - videos: multiple video files (max 10)
      - category: category ID
      - video_item_type: video | reel (used only when uploading videos)
    """
    MAX_BULK_IMAGES = 50
    MAX_BULK_VIDEOS = 10
    MAX_SINGLE_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB per image (matches service validation)
    MAX_SINGLE_VIDEO_SIZE = 100 * 1024 * 1024  # 100 MB per video (matches service validation)
    ALLOWED_IMAGE_TYPES = ('.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp')
    ALLOWED_VIDEO_TYPES = ('.mp4', '.webm', '.mov', '.avi')
    
    category_id = request.POST.get('category', '')
    image_files = request.FILES.getlist('images')
    video_files = request.FILES.getlist('videos')
    video_item_type = (request.POST.get('video_item_type', 'video') or 'video').strip().lower()
    if video_item_type not in ('video', 'reel'):
        video_item_type = 'video'
    
    if image_files and video_files:
        return JsonResponse({
            'success': False,
            'message': 'Please upload either images or videos in one request, not both.'
        }, status=400)

    if not image_files and not video_files:
        return JsonResponse({'success': False, 'message': 'No files selected'}, status=400)

    if image_files:
        files = image_files
        if len(files) > MAX_BULK_IMAGES:
            return JsonResponse({
                'success': False,
                'message': f'Maximum {MAX_BULK_IMAGES} images allowed per upload. You selected {len(files)}.'
            }, status=400)

        # Validate every image file before processing any
        for img_file in files:
            ext = '.' + img_file.name.rsplit('.', 1)[-1].lower() if '.' in img_file.name else ''
            if ext not in ALLOWED_IMAGE_TYPES:
                return JsonResponse({
                    'success': False,
                    'message': f'{img_file.name}: Invalid file type. Allowed: {", ".join(ALLOWED_IMAGE_TYPES)}'
                }, status=400)
            if img_file.size > MAX_SINGLE_IMAGE_SIZE:
                size_mb = img_file.size / (1024 * 1024)
                return JsonResponse({
                    'success': False,
                    'message': f'{img_file.name}: Too large ({size_mb:.1f} MB). Max 10 MB per image.'
                }, status=400)

        created = 0
        errors = []

        for img_file in files:
            try:
                PortfolioItemService.create(
                    category_id=category_id or None,
                    orientation='',
                    item_type='image',
                    video_url='',
                    order=0,
                    is_active=True,
                    is_featured=False,
                    image=img_file,
                    video_file=None,
                )
                created += 1
            except (ValidationError, Exception) as e:
                err_msg = e.message if hasattr(e, 'message') else str(e)
                errors.append(f'{img_file.name}: {err_msg}')

        if created == 0:
            return JsonResponse({
                'success': False,
                'message': 'No images were uploaded. ' + '; '.join(errors[:3])
            }, status=400)

        msg = f'{created} image{"s" if created != 1 else ""} uploaded successfully'
        if errors:
            msg += f' ({len(errors)} failed)'

        return JsonResponse({'success': True, 'message': msg, 'created': created, 'errors': errors[:5]})

    files = video_files
    if len(files) > MAX_BULK_VIDEOS:
        return JsonResponse({
            'success': False,
            'message': f'Maximum {MAX_BULK_VIDEOS} videos allowed per upload. You selected {len(files)}.'
        }, status=400)

    # Validate every video file before processing any
    for vid_file in files:
        ext = '.' + vid_file.name.rsplit('.', 1)[-1].lower() if '.' in vid_file.name else ''
        if ext not in ALLOWED_VIDEO_TYPES:
            return JsonResponse({
                'success': False,
                'message': f'{vid_file.name}: Invalid file type. Allowed: {", ".join(ALLOWED_VIDEO_TYPES)}'
            }, status=400)
        if vid_file.size > MAX_SINGLE_VIDEO_SIZE:
            size_mb = vid_file.size / (1024 * 1024)
            return JsonResponse({
                'success': False,
                'message': f'{vid_file.name}: Too large ({size_mb:.1f} MB). Max 100 MB per video.'
            }, status=400)

    created = 0
    errors = []

    for vid_file in files:
        try:
            PortfolioItemService.create(
                category_id=category_id or None,
                orientation='',
                item_type=video_item_type,
                video_url='',
                order=0,
                is_active=True,
                is_featured=False,
                image=None,
                video_file=vid_file,
            )
            created += 1
        except (ValidationError, Exception) as e:
            err_msg = e.message if hasattr(e, 'message') else str(e)
            errors.append(f'{vid_file.name}: {err_msg}')

    if created == 0:
        return JsonResponse({
            'success': False,
            'message': 'No videos were uploaded. ' + '; '.join(errors[:3])
        }, status=400)

    msg = f'{created} video{"s" if created != 1 else ""} uploaded successfully'
    if errors:
        msg += f' ({len(errors)} failed)'

    return JsonResponse({'success': True, 'message': msg, 'created': created, 'errors': errors[:5]})


@require_GET
@website_portfolio_read_required
def api_portfolio_get(request, pk):
    """Get a single portfolio item."""
    try:
        p = PortfolioItemService.get(pk)
    except Http404:
        return JsonResponse({'success': False, 'message': 'Portfolio item not found'}, status=404)
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
            'video_stream': p.video_stream_url or None,
            'video_fallback': p.video_fallback_url or None,
            'video_thumbnail': p.video_thumbnail_url or None,
            'order': p.order,
            'is_active': p.is_active,
            'is_featured': p.is_featured,
        }
    })


@require_POST
@website_portfolio_edit_required
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
@website_portfolio_delete_required
def api_portfolio_delete(request, pk):
    """Delete a portfolio item."""
    try:
        PortfolioItemService.delete(pk)
        return JsonResponse({'success': True, 'message': 'Portfolio item deleted'})
    except Exception as e:
        logging.getLogger(__name__).exception("Portfolio delete error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_POST
@website_portfolio_edit_required
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

@require_GET
@website_portfolio_read_required
def api_portfolio_category_list(request):
    """List portfolio categories."""
    from django.db.models import Count
    cats = PortfolioCategoryService.list_all().annotate(_items_count=Count('items'))
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
        'items_count': c._items_count,
    } for c in cats]
    return JsonResponse({'success': True, 'categories': data})


@require_POST
@website_portfolio_add_required
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
@website_portfolio_edit_required
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
@website_portfolio_delete_required
def api_portfolio_category_delete(request, pk):
    """Delete a portfolio category (only non-default)."""
    try:
        PortfolioCategoryService.delete(pk)
    except ValueError as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)
    return JsonResponse({'success': True, 'message': 'Category deleted'})


# =============================================================================
# CONTACT SUBMISSIONS — Page + API
# =============================================================================

@website_view_required
def contacts_page(request):
    """Contact Messages management page."""
    context = _get_base_context(request, 'contacts')

    allowed_statuses = ['new', 'read', 'replied', 'closed']
    status_filter = (request.GET.get('status', '') or '').strip().lower()
    if status_filter not in allowed_statuses:
        status_filter = ''

    if status_filter:
        contacts_qs = ContactSubmissionService.list_by_status(status_filter)
    else:
        contacts_qs = ContactSubmissionService.list_all()

    per_page_options = [10, 25, 50, 100]
    default_per_page = 25
    try:
        per_page = int(request.GET.get('per_page', default_per_page))
        if per_page not in per_page_options:
            per_page = default_per_page
    except (TypeError, ValueError):
        per_page = default_per_page

    paginator = Paginator(contacts_qs, per_page)
    page_obj = paginator.get_page(request.GET.get('page', 1))

    page_count = len(page_obj.object_list)
    if paginator.count:
        page_start = ((page_obj.number - 1) * per_page) + 1
        page_end = page_start + page_count - 1
    else:
        page_start = 0
        page_end = 0

    context['contacts'] = page_obj.object_list
    context['stats'] = ContactSubmissionService.get_stats()
    context['current_status'] = status_filter
    context['page_obj'] = page_obj
    context['per_page'] = per_page
    context['per_page_options'] = per_page_options
    context['total_contacts'] = paginator.count
    context['page_start'] = page_start
    context['page_end'] = page_end
    return render(request, 'website/admin/contacts.html', context)


@require_GET
@website_view_required
def api_contact_list(request):
    """List all contact submissions as JSON."""
    status_filter = request.GET.get('status', '')
    if status_filter and status_filter in ['new', 'read', 'replied', 'closed']:
        contacts = ContactSubmissionService.list_by_status(status_filter)
    else:
        contacts = ContactSubmissionService.list_all()
    
    return JsonResponse({
        'success': True,
        'contacts': [
            {
                'id': c.id,
                'name': c.name,
                'email': c.email,
                'phone': c.phone,
                'subject': c.subject,
                'message': c.message,
                'status': c.status,
                'email_status': c.email_status,
                'created_at': c.created_at.isoformat(),
            }
            for c in contacts
        ]
    })


@require_GET
@website_view_required
def api_contact_get(request, pk):
    """Get a single contact submission."""
    try:
        c = ContactSubmissionService.get(pk)
        # Auto-mark as read if new
        if c.status == 'new':
            ContactSubmissionService.update_status(pk, 'read')
            c.refresh_from_db()
        return JsonResponse({
            'success': True,
            'contact': {
                'id': c.id,
                'name': c.name,
                'email': c.email,
                'phone': c.phone,
                'subject': c.subject,
                'message': c.message,
                'status': c.status,
                'email_status': c.email_status,
                'created_at': c.created_at.isoformat(),
                'updated_at': c.updated_at.isoformat(),
            }
        })
    except ContactSubmission.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Contact not found'}, status=404)


@require_POST
@website_edit_required
def api_contact_update_status(request, pk):
    """Update the status of a contact submission."""
    try:
        if request.content_type == 'application/json':
            import json
            data = json.loads(request.body)
            status = data.get('status', '')
        else:
            status = request.POST.get('status', '')
        
        if not status:
            return JsonResponse({'success': False, 'message': 'Status is required'}, status=400)
        
        ContactSubmissionService.update_status(pk, status)
        ActivityService.log_website_update(request, f'contact status updated to {status}')
        return JsonResponse({'success': True, 'message': 'Status updated'})
    except ValueError as e:
        return JsonResponse({'success': False, 'message': str(e)}, status=400)
    except ContactSubmission.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Contact not found'}, status=404)


@require_POST
@website_delete_required
def api_contact_delete(request, pk):
    """Delete a contact submission."""
    try:
        ContactSubmissionService.delete(pk)
        ActivityService.log_website_update(request, 'contact message deleted')
        return JsonResponse({'success': True, 'message': 'Contact deleted'})
    except ContactSubmission.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Contact not found'}, status=404)
    except Exception as e:
        logging.getLogger(__name__).exception("Contact delete error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)
