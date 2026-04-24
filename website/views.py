from collections import defaultdict
import random
from urllib.parse import urlsplit, parse_qsl, urlencode

from django.shortcuts import render, redirect
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_POST, require_GET
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.core.cache import cache
from django.conf import settings as _s
from django.db.models import Avg, Case, When, Value, IntegerField, Q, F
from django.urls import resolve, Resolver404, reverse
import logging
from django.contrib.sitemaps.views import sitemap
from .sitemaps import StaticViewSitemap, PortfolioCategorySitemap, PortfolioItemSitemap
from django.shortcuts import get_object_or_404

from accounts.rate_limit import rate_limit
from core.services.cache_version_service import CacheVersionService
from .services import TestimonialService, ContactSubmissionService
from client.models import Client as PanelClient

logger = logging.getLogger(__name__)

from .models import (
    BusinessDetails, 
    Feature, 
    HeroImage,
    PortfolioCategory,
    PortfolioItem, 
    Testimonial, 
    Reel
)

# ==========================================
# DISPLAY LIMITS
# ==========================================
HOME_RECENT_PORTFOLIO_LIMIT = 8
HOME_TESTIMONIALS_LIMIT = 5
CATEGORY_IMAGES_LIMIT = 6
PORTFOLIO_BATCH_SIZE = 12
CATEGORY_MODAL_INITIAL_LIMIT = 15
CATEGORY_MODAL_MAX_LIMIT = 30
REELS_INITIAL_LIMIT = 10
BUSINESS_CACHE_TTL = 300  # 5 minutes
WHY_CHOOSE_US_CACHE_TTL = 300
WEBSITE_PUBLIC_CACHE_SCOPE = 'public'


def _website_public_cache_key(bucket):
    """Build versioned cache keys for public website sections."""
    version = CacheVersionService.get('website_public_sections', WEBSITE_PUBLIC_CACHE_SCOPE)
    return f'website:{bucket}:v{version}'

# Public bento overrides.
# Removed from bento: school-stationery, office-stationery
# Added to bento: certificates, marksheets, mugs, t-shirts
BENTO_FORCE_INCLUDE_SLUGS = [
    'certificates',
    'marksheets',
    'mugs',
    't-shirts',
]
BENTO_FORCE_EXCLUDE_SLUGS = [
    'school-stationery',
    'office-stationery',
]
BENTO_PREFERRED_ORDER = [
    'id-cards',
    'lanyards',
    'badges',
    'student-diaries',
    'pamphlets',
    *BENTO_FORCE_INCLUDE_SLUGS,
]

# ==========================================
# HELPER FUNCTIONS
# ==========================================

def get_common_context():
    """
    Returns global data required by the navbar and footer on every page.
    Caches BusinessDetails for 5 minutes to avoid querying on every page load.
    """
    business_cache_key = _website_public_cache_key('business_details')
    business = cache.get(business_cache_key)
    if business is None:
        business = BusinessDetails.objects.first()
        cache.set(business_cache_key, business, BUSINESS_CACHE_TTL)

    return {
        'business': business,
        'site_name': business.site_name if business else 'Adarsh ID Cards',
        'global_keywords': 'Adarsh ID Cards, Adarsh Bhopal, ID Card Printing Bhopal, Custom Lanyards Bhopal, School ID Cards MP, Identity Solutions Madhya Pradesh, PVC ID Card Manufacturer, RFID Cards Bhopal, Digital Lanyard Printing, School Stationery Suppliers Bhopal',
    }


def _interleave_random_by_category(items):
    """
    Shuffle items and interleave by category so adjacent cards are more likely
    to come from different categories.
    """
    entries = list(items or [])
    if len(entries) <= 2:
        return entries

    grouped = defaultdict(list)
    uncategorized = []
    for entry in entries:
        category_id = getattr(entry, 'category_id', None)
        if category_id is None:
            uncategorized.append(entry)
            continue
        grouped[str(category_id)].append(entry)

    rng = random.SystemRandom()
    for bucket in grouped.values():
        rng.shuffle(bucket)
    rng.shuffle(uncategorized)

    category_keys = [key for key, bucket in grouped.items() if bucket]
    mixed = []

    while category_keys:
        rng.shuffle(category_keys)
        next_round = []
        for key in category_keys:
            bucket = grouped.get(key) or []
            if not bucket:
                continue
            mixed.append(bucket.pop())
            if bucket:
                next_round.append(key)
        category_keys = next_round

    mixed.extend(uncategorized)
    return mixed


def _pop_best_category_item(grouped, excluded_categories, rng):
    """Pop one item, preferring categories not recently used and with more remaining items."""
    available_keys = [key for key, bucket in grouped.items() if bucket]
    if not available_keys:
        return None, None

    preferred_keys = [key for key in available_keys if key not in excluded_categories]
    candidate_keys = preferred_keys or available_keys
    max_bucket_size = max(len(grouped[key]) for key in candidate_keys)
    best_keys = [key for key in candidate_keys if len(grouped[key]) == max_bucket_size]
    picked_key = rng.choice(best_keys)
    return picked_key, grouped[picked_key].pop()


def _build_home_product_rows_by_category(items):
    """Build two marquee rows with category variety both within and across rows."""
    entries = list(items or [])
    if not entries:
        return [], []

    if len(entries) == 1:
        return entries, list(reversed(entries))

    grouped = defaultdict(list)
    for entry in entries:
        grouped[getattr(entry, 'category_id', None)].append(entry)

    rng = random.SystemRandom()
    for bucket in grouped.values():
        rng.shuffle(bucket)

    target_row1 = (len(entries) + 1) // 2
    target_row2 = len(entries) // 2
    row1, row2 = [], []
    last_row1_category = None
    last_row2_category = None

    while len(row1) < target_row1 or len(row2) < target_row2:
        progressed = False

        if len(row1) < target_row1:
            category_key, item = _pop_best_category_item(
                grouped,
                excluded_categories={last_row1_category},
                rng=rng,
            )
            if item is not None:
                row1.append(item)
                last_row1_category = category_key
                progressed = True

        if len(row2) < target_row2:
            exclusions = {last_row2_category}
            if len(row1) > len(row2):
                exclusions.add(getattr(row1[len(row2)], 'category_id', None))
            category_key, item = _pop_best_category_item(
                grouped,
                excluded_categories=exclusions,
                rng=rng,
            )
            if item is not None:
                row2.append(item)
                last_row2_category = category_key
                progressed = True

        if not progressed:
            break

    if not row2:
        row2 = list(reversed(row1))
    return row1, row2


def _serialize_portfolio_modal_item(item):
    """Serialize a portfolio item for the category gallery modal/API payloads."""
    is_video_item = item.item_type in ('video', 'reel')
    thumbnail_url = item.video_thumbnail_url if is_video_item else (item.image.url if item.image else '')
    stream_url = item.video_stream_url if is_video_item else ''
    fallback_video_url = item.video_fallback_url if is_video_item else ''
    playback_video_url = stream_url or fallback_video_url

    entry = {
        'type': item.item_type or 'image',
        'orientation': item.orientation or 'square',
        'title': item.title or '',
    }

    if is_video_item:
        if thumbnail_url:
            entry['image'] = thumbnail_url
        if playback_video_url:
            entry['video'] = playback_video_url
        if fallback_video_url:
            entry['video_fallback'] = fallback_video_url
        if stream_url:
            entry['video_stream'] = stream_url
    elif item.image:
        entry['image'] = item.image.url

    return entry


def _sanitize_email_header_value(value, *, max_length=255):
    """Strip CRLF and collapse whitespace for email-header-safe values."""
    cleaned = str(value or '').replace('\r', ' ').replace('\n', ' ').strip()
    collapsed = ' '.join(cleaned.split())
    return collapsed[:max_length]


def _normalize_panel_next_target(raw_next, fallback_target):
    """Normalize and validate next target against panel URLConf routes."""
    fallback_parsed = urlsplit(str(fallback_target or '/auth/login/'))
    fallback_path = fallback_parsed.path if fallback_parsed.path.startswith('/') else '/auth/login/'
    if fallback_path == '/':
        fallback_path = '/auth/login/'
    fallback_params = dict(parse_qsl(fallback_parsed.query, keep_blank_values=True))

    parsed = urlsplit(str(raw_next or ''))
    next_path = parsed.path or fallback_path

    if next_path == '/panel':
        next_path = '/'
    elif next_path.startswith('/panel/'):
        next_path = next_path[len('/panel'):]

    next_path = next_path.replace('\\', '/').strip()
    while '//' in next_path:
        next_path = next_path.replace('//', '/')

    if not next_path.startswith('/'):
        return fallback_path, fallback_params

    normalized_parts = []
    for part in next_path.split('/'):
        if not part or part == '.':
            continue
        if part == '..':
            return fallback_path, fallback_params
        normalized_parts.append(part)

    normalized_path = '/' + '/'.join(normalized_parts)
    if (parsed.path or '').endswith('/') and normalized_path != '/':
        normalized_path = f'{normalized_path}/'
    if normalized_path == '/':
        normalized_path = fallback_path

    try:
        resolve(normalized_path, urlconf='config.urls_panel')
    except Resolver404:
        return fallback_path, fallback_params

    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    return normalized_path, params


@require_GET
def pwa_manifest(request):
    """Public website PWA manifest for desktop/mobile browser install."""
    host = request.get_host().split(':')[0].lower()
    panel_domain = str(getattr(_s, 'PANEL_DOMAIN', '') or '').strip().lower()
    is_panel_host = bool(getattr(request, '_is_panel_subdomain', False)) or (panel_domain and host == panel_domain)

    if is_panel_host:
        manifest = {
            'name': 'Adarsh ID Cards Panel',
            'short_name': 'Adarsh Panel',
            'id': '/',
            'start_url': '/',
            'scope': '/',
            'display': 'standalone',
            'display_override': ['standalone', 'minimal-ui', 'browser'],
            'background_color': '#f4f8ff',
            'theme_color': '#3498db',
            'description': 'Admin panel workspace for Adarsh ID Cards.',
            'icons': [
                {
                    'src': '/static/mobile/images/icon-192.png',
                    'sizes': '192x192',
                    'type': 'image/png',
                    'purpose': 'any maskable',
                },
                {
                    'src': '/static/mobile/images/icon-512.png',
                    'sizes': '512x512',
                    'type': 'image/png',
                    'purpose': 'any maskable',
                },
            ],
        }
    else:
        manifest = {
            'name': 'Adarsh ID Cards Website',
            'short_name': 'Adarsh',
            'id': '/',
            # Open panel directly from installed website PWA to avoid homepage-first flow.
            'start_url': '/panel-entry/?next=/auth/login/&src=pwa-launch',
            'scope': '/',
            'display': 'standalone',
            'display_override': ['standalone', 'minimal-ui', 'browser'],
            'background_color': '#ffffff',
            'theme_color': '#3498db',
            'description': 'Professional ID card solutions and public company website.',
            'icons': [
                {
                    'src': '/static/mobile/images/icon-192.png',
                    'sizes': '192x192',
                    'type': 'image/png',
                    'purpose': 'any maskable',
                },
                {
                    'src': '/static/mobile/images/icon-512.png',
                    'sizes': '512x512',
                    'type': 'image/png',
                    'purpose': 'any maskable',
                },
            ],
        }
    response = JsonResponse(manifest)
    response['Content-Type'] = 'application/manifest+json'
    response['Cache-Control'] = 'public, max-age=3600'
    return response


@require_GET
def pwa_service_worker(request):
    """Minimal pass-through service worker required for installability."""
    sw_script = """self.addEventListener('install', function() {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function() {
    // Network pass-through; no runtime caching here.
});
"""
    response = HttpResponse(sw_script, content_type='application/javascript')
    response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response['Service-Worker-Allowed'] = '/'
    return response


# ==========================================
# PAGE VIEWS
# ==========================================

def home(request):
    """Homepage: Displays a summary of all sections"""
    context = get_common_context()
    
    # Dynamic hero images (cached 60s with versioned key)
    hero_cache_key = _website_public_cache_key('home_hero_images')
    hero_images = cache.get(hero_cache_key)
    if hero_images is None:
        hero_images = list(HeroImage.objects.filter(is_active=True).order_by('order', 'pk'))
        cache.set(hero_cache_key, hero_images, 60)
    context['hero_images'] = hero_images
    
    # Website section data (cached 60s with versioned key)
    home_sections_cache_key = _website_public_cache_key('home_sections')
    home_sections = cache.get(home_sections_cache_key)
    if home_sections is None:
        image_products_filter = Q(item_type='image') & Q(image__isnull=False) & ~Q(image='')
        home_sections = {
            'trusted_clients': list(
                PanelClient.objects.filter(website_is_visible=True)
                .exclude(website_logo__isnull=True)
                .exclude(website_logo='')
                .only('id', 'name', 'website_logo', 'website_display_order')
                .order_by('website_display_order', 'name', 'id')
            ),
            'featured_portfolio': list(
                PortfolioItem.objects
                .select_related('category')
                .filter(is_active=True, is_featured=True)
                .filter(image_products_filter)
                .order_by('order')
            ),
            'recent_portfolio': list(
                PortfolioItem.objects
                .select_related('category')
                .filter(is_active=True)
                .filter(image_products_filter)
                .order_by('-created_at')[:HOME_RECENT_PORTFOLIO_LIMIT]
            ),
            'testimonials': list(Testimonial.objects.filter(is_active=True).order_by('-review_date')[:HOME_TESTIMONIALS_LIMIT]),
        }
        cache.set(home_sections_cache_key, home_sections, 60)
    context.update(home_sections)

    # Build a randomized, mixed-category stream for both product rows.
    featured_products = list(home_sections.get('featured_portfolio') or [])
    recent_products = list(home_sections.get('recent_portfolio') or [])

    deduped_products = []
    seen_ids = set()
    for item in featured_products + recent_products:
        item_id = getattr(item, 'id', None)
        key = item_id if item_id is not None else id(item)
        if key in seen_ids:
            continue
        seen_ids.add(key)
        deduped_products.append(item)

    all_products = _interleave_random_by_category(deduped_products)
    if all_products:
        row1_portfolio, row2_portfolio = _build_home_product_rows_by_category(all_products)
        context['row1_portfolio'] = row1_portfolio
        context['row2_portfolio'] = row2_portfolio
    else:
        context['row1_portfolio'] = []
        context['row2_portfolio'] = []

    # SEO metadata
    context.update({
        'meta_title': f"Adarsh ID Cards Bhopal | Best ID Card & Lanyard Solution in MP",
        'meta_description': f"Adarsh ID Cards is the leading ID card manufacturer in Bhopal, MP. We specialize in premium Lanyards, PVC ID Cards, and school stationery. Trusted by 1000+ institutions for quality and delivery.",
        'canonical_url': request.build_absolute_uri(),
    })

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
    items_qs = PortfolioItem.objects.filter(is_active=True).select_related('category').annotate(
        has_order=Case(
            When(order__gt=0, then=Value(0)),
            default=Value(1),
            output_field=IntegerField()
        )
    ).order_by('has_order', 'order', '-created_at')
    items = _interleave_random_by_category(list(items_qs))
    
    # Build bento media + gallery modal data.
    # For bento cards, prefer images but fall back to videos so video-only
    # categories still show rotating media.
    _cat_media_map = defaultdict(list)
    _cat_items_initial_map = defaultdict(list)
    _cat_items_total_map = defaultdict(int)
    modal_media_filter = (
        (Q(item_type='image') & Q(image__isnull=False) & ~Q(image=''))
        |
        (
            Q(item_type__in=('video', 'reel'))
            & ((Q(video_file__isnull=False) & ~Q(video_file='')) | ~Q(video_url=''))
        )
    )
    modal_items_qs = PortfolioItem.objects.filter(
        is_active=True,
        category__isnull=False,
    ).filter(
        modal_media_filter,
    ).select_related('category').annotate(
        has_order=Case(
            When(order__gt=0, then=Value(0)),
            default=Value(1),
            output_field=IntegerField()
        )
    ).order_by('category_id', 'has_order', 'order', '-created_at')

    for item in modal_items_qs:
        cat_id = str(item.category_id)
        entry = _serialize_portfolio_modal_item(item)
        has_modal_media = bool(entry.get('image') or entry.get('video'))
        if not has_modal_media:
            continue

        _cat_items_total_map[cat_id] += 1
        if len(_cat_items_initial_map[cat_id]) < CATEGORY_MODAL_INITIAL_LIMIT:
            _cat_items_initial_map[cat_id].append(entry)

        if len(_cat_media_map[cat_id]) < CATEGORY_IMAGES_LIMIT:
            if entry.get('image'):
                _cat_media_map[cat_id].append({
                    'type': 'image',
                    'src': entry['image'],
                })
            elif entry.get('video'):
                _cat_media_map[cat_id].append({
                    'type': 'video',
                    'src': entry['video'],
                    'fallback': entry.get('video_fallback') or entry['video'],
                    'poster': entry.get('image', ''),
                })

    category_images = {str(cat.id): _cat_media_map.get(str(cat.id), []) for cat in categories}
    category_items = {str(cat.id): _cat_items_initial_map.get(str(cat.id), []) for cat in categories}
    category_item_totals = {str(cat.id): _cat_items_total_map.get(str(cat.id), 0) for cat in categories}

    bento_order_case = Case(
        *[When(slug=slug, then=Value(idx)) for idx, slug in enumerate(BENTO_PREFERRED_ORDER)],
        default=Value(len(BENTO_PREFERRED_ORDER)),
        output_field=IntegerField(),
    )
    bento_categories = categories.filter(
        (Q(is_bento=True) & ~Q(slug__in=BENTO_FORCE_EXCLUDE_SLUGS))
        | Q(slug__in=BENTO_FORCE_INCLUDE_SLUGS)
    ).annotate(
        _bento_rank=bento_order_case
    ).distinct().order_by('_bento_rank', 'order', 'name')
    extra_categories = categories.exclude(id__in=bento_categories.values('id'))

    context.update({
        'portfolio_items': items,
        'portfolio_batch_size': PORTFOLIO_BATCH_SIZE,
        'categories': categories,
        'bento_categories': bento_categories,
        'extra_categories': extra_categories,
        'category_images': category_images,
        'category_items': category_items,
        'category_item_totals': category_item_totals,
        'category_modal_batch_size': CATEGORY_MODAL_INITIAL_LIMIT,
        'meta_title': f"Our Products Gallery | Premium ID Card & Lanyard Designs Bhopal",
        'meta_description': "Browse our extensive collection of professional ID cards, custom printed lanyards, and institutions stationery. High-quality samples from Adarsh ID Cards Bhopal.",
        'canonical_url': request.build_absolute_uri(),
    })
    return render(request, 'website/our-works.html', context)


@require_GET
@rate_limit(max_requests=40, window_seconds=60, key_prefix='public_category_items')
def load_more_category_items(request):
    """API endpoint to incrementally load category gallery items."""
    try:
        category_id = int(request.GET.get('category_id', 0))
        offset = max(0, int(request.GET.get('offset', 0)))
        limit = min(
            max(1, int(request.GET.get('limit', CATEGORY_MODAL_INITIAL_LIMIT))),
            CATEGORY_MODAL_MAX_LIMIT,
        )
    except (TypeError, ValueError):
        return JsonResponse({'error': 'Invalid parameters'}, status=400)

    if category_id <= 0:
        return JsonResponse({'error': 'category_id is required'}, status=400)

    if not PortfolioCategory.objects.filter(id=category_id, is_active=True).exists():
        return JsonResponse({'error': 'Category not found'}, status=404)

    modal_media_filter = (
        (Q(item_type='image') & Q(image__isnull=False) & ~Q(image=''))
        |
        (
            Q(item_type__in=('video', 'reel'))
            & ((Q(video_file__isnull=False) & ~Q(video_file='')) | ~Q(video_url=''))
        )
    )

    items_qs = PortfolioItem.objects.filter(
        is_active=True,
        category_id=category_id,
    ).filter(
        modal_media_filter,
    ).annotate(
        has_order=Case(
            When(order__gt=0, then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        )
    ).order_by('has_order', 'order', '-created_at')

    total = items_qs.count()
    page = items_qs[offset:offset + limit]

    serialized_items = []
    for item in page:
        entry = _serialize_portfolio_modal_item(item)
        if entry.get('image') or entry.get('video'):
            serialized_items.append(entry)

    return JsonResponse({
        'items': serialized_items,
        'total': total,
        'has_more': (offset + limit) < total,
        'next_offset': min(total, offset + limit),
    })


@require_GET
@rate_limit(max_requests=40, window_seconds=60, key_prefix='public_reels')
def load_more_reels(request):
    """API endpoint to load more reels for infinite scroll"""
    try:
        offset = max(0, int(request.GET.get('offset', 0)))
        limit = min(max(1, int(request.GET.get('limit', REELS_INITIAL_LIMIT))), 50)
    except (ValueError, TypeError):
        return JsonResponse({'error': 'Invalid parameters'}, status=400)

    reels_qs = Reel.objects.filter(is_active=True).order_by('order')
    total_reels = reels_qs.count()
    reels = reels_qs[offset:offset + limit]
    
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
    why_cache_key = _website_public_cache_key('why_choose_us_sections')
    why_sections = cache.get(why_cache_key)
    if why_sections is None:
        why_sections = {
            'features': list(
                Feature.objects.filter(is_active=True)
                .only('id', 'title', 'description', 'icon', 'is_featured', 'highlight', 'order')
                .order_by('order')
            ),
        }
        cache.set(why_cache_key, why_sections, WHY_CHOOSE_US_CACHE_TTL)
    context.update(why_sections)
    context.update({
        'meta_title': f"Why Choose Adarsh ID Cards | Leading Service in Bhopal, MP",
        'meta_description': "Adarsh ID Cards Bhopal offers the best quality lanyards and ID card solutions in Madhya Pradesh. 20+ years of trust in professional printing.",
        'canonical_url': request.build_absolute_uri(),
    })
    return render(request, 'website/why-choose-us.html', context)


def testimonials_page(request):
    """Reviews Page: Text testimonials"""
    context = get_common_context()
    
    all_active = Testimonial.objects.filter(is_active=True).order_by('-review_date')
    client_ip = _get_client_ip(request)
    user_email = (getattr(request.user, 'email', '') or '').strip() if getattr(request.user, 'is_authenticated', False) else ''
    review_lookup_ip = '' if user_email else client_ip
    my_feedback_items = []
    if user_email:
        my_feedback_items = list(
            Testimonial.objects.filter(reviewer_email__iexact=user_email).order_by('-created_at', '-id')[:10]
        )
    
    # Calculate stats
    avg_rating = all_active.aggregate(avg=Avg('rating'))['avg'] or 5.0
    
    context.update({
        'text_testimonials': all_active,
        'avg_rating': round(avg_rating, 1),
        'total_reviews': all_active.count(),
        'can_submit_public_review': not TestimonialService.has_public_review(
            reviewer_email=user_email,
            reviewer_ip=review_lookup_ip,
        ),
        'my_feedback_items': my_feedback_items,
        'meta_title': f"Client Reviews | Best ID Card Printing in Bhopal, MP",
        'meta_description': "Read what schools and offices in Bhopal and MP say about Adarsh ID Cards and Lanyard solutions. Quality you can trust.",
        'canonical_url': request.build_absolute_uri(),
    })
    return render(request, 'website/testimonials.html', context)


def privacy_policy(request):
    """Privacy Policy Page - Static content, only needs base context"""
    context = get_common_context()
    context.update({
        'meta_title': f"Privacy Policy | {context['site_name']}",
        'meta_description': "Read our privacy policy to understand how we handle your data and ensure your privacy.",
        'canonical_url': request.build_absolute_uri(),
    })
    return render(request, 'website/privacy-policy.html', context)


def panel_entry(request):
    """Generate a signed panel-entry token and redirect to panel login/path."""
    from django.core.signing import TimestampSigner

    ua = request.META.get('HTTP_USER_AGENT', '')
    is_mobile_ua = any(k in ua for k in ['Android', 'iPhone', 'iPad', 'iPod', 'webOS', 'BlackBerry', 'IEMobile', 'Opera Mini'])

    default_next = '/app/login/?install=1' if is_mobile_ua else '/auth/login/'
    raw_next = request.GET.get('next', '')
    next_path, params = _normalize_panel_next_target(raw_next, default_next)

    signer = TimestampSigner(salt='panel-entry-gate')
    params['panel_entry_token'] = signer.sign('website-panel-entry')
    query = urlencode(params)

    panel_base = (_s.PANEL_URL or '').rstrip('/')
    if panel_base:
        destination = f'{panel_base}{next_path}'
    else:
        destination = f'/panel{next_path}'

    if query:
        destination = f'{destination}?{query}'
    return redirect(destination)


def _get_client_ip(request):
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded_for:
        candidate = forwarded_for.split(',')[0].strip()
        if candidate:
            return candidate
    return (request.META.get('REMOTE_ADDR') or '').strip()


# ==========================================
# AJAX FORM SUBMISSIONS
# ==========================================

@require_POST
@rate_limit(max_requests=3, window_seconds=300, key_prefix='public_review')
def submit_testimonial(request):
    """Handles AJAX submission of a new review (Public)"""
    try:
        name = request.POST.get('name', '').strip()
        email = request.POST.get('email', '').strip()
        school = request.POST.get('school', '').strip()
        text = request.POST.get('text', '').strip()
        rating = request.POST.get('rating', '5')
        attachment_image = request.FILES.get('attachment_image')

        reviewer_ip = _get_client_ip(request)

        if getattr(request.user, 'is_authenticated', False):
            account_email = (getattr(request.user, 'email', '') or '').strip()
            if account_email:
                email = account_email

            if not name:
                name = (request.user.get_full_name() or request.user.username or email).strip()

            if not school:
                client_profile = getattr(request.user, 'client_profile', None)
                staff_profile = getattr(request.user, 'staff_profile', None)
                if client_profile and getattr(client_profile, 'name', ''):
                    school = str(client_profile.name).strip()
                elif staff_profile and getattr(staff_profile, 'client', None) and getattr(staff_profile.client, 'name', ''):
                    school = str(staff_profile.client.name).strip()

        if not all([name, email, school, text]):
            return JsonResponse({'success': False, 'message': 'All fields are required.'}, status=400)

        try:
            validate_email(email)
        except ValidationError:
            return JsonResponse({'success': False, 'message': 'Please enter a valid email address.'}, status=400)

        try:
            rating_val = max(1, min(5, int(rating)))
        except (ValueError, TypeError):
            rating_val = 5

        TestimonialService.create_public(
            reviewer_name=name,
            reviewer_email=email,
            reviewer_school=school,
            text=text,
            rating=rating_val,
            # Authenticated users are de-duplicated by email to avoid shared-IP false positives.
            reviewer_ip='' if (getattr(request.user, 'is_authenticated', False) and email) else reviewer_ip,
            attachment_image=attachment_image,
        )
        return JsonResponse({'success': True, 'message': 'Review submitted! It will appear once approved.'})
    except ValidationError as e:
        return JsonResponse({'success': False, 'message': e.message}, status=400)
    except Exception as e:
        logger.error("Testimonial submission failed: %s", e)
        return JsonResponse({'success': False, 'message': 'Server error. Please try again later.'}, status=500)


@require_POST
@rate_limit(max_requests=30, window_seconds=300, key_prefix='public_helpful')
def mark_testimonial_helpful(request):
    """Increment helpful_count for an active testimonial."""
    raw_id = request.POST.get('id', '').strip()
    try:
        testimonial_id = int(raw_id)
    except (TypeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid testimonial id.'}, status=400)

    updated = Testimonial.objects.filter(id=testimonial_id, is_active=True).update(
        helpful_count=F('helpful_count') + 1
    )
    if not updated:
        return JsonResponse({'success': False, 'message': 'Review not found.'}, status=404)

    new_count = Testimonial.objects.filter(id=testimonial_id).values_list('helpful_count', flat=True).first() or 0
    return JsonResponse({'success': True, 'helpful_count': int(new_count)})


@require_POST
@rate_limit(max_requests=5, window_seconds=300, key_prefix='public_contact')
def submit_contact(request):
    """Handles AJAX submission of the contact form"""
    try:
        name = request.POST.get('name', '').strip()
        email = request.POST.get('email', '').strip()
        phone = request.POST.get('phone', '').strip()
        subject = _sanitize_email_header_value(request.POST.get('subject', ''), max_length=255)
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


# --- SEO Detail Views ---

def category_detail(request, slug):
    """List all items in a category with SEO metadata."""
    category = get_object_or_404(PortfolioCategory, slug=slug, is_active=True)
    items = PortfolioItem.objects.filter(category=category, is_active=True).order_by('order', '-created_at')
    
    context = get_common_context()
    context.update({
        'category': category,
        'items': items,
        'meta_title': f"{category.name} in Bhopal, MP | Adarsh ID Card Solutions",
        'meta_description': f"High-quality {category.name} printing in Bhopal. {category.description[:150] if category.description else 'The best identity solutions in Madhya Pradesh.'} Contact Adarsh Bhopal for bulk orders.",
        'meta_keywords': f"{category.name}, {category.name} Bhopal, {category.name} printing MP, Adarsh ID Cards products",
        'canonical_url': request.build_absolute_uri(),
        'breadcrumb': [
            {'name': 'Home', 'url': reverse('website:home')},
            {'name': 'Our Products', 'url': reverse('website:our_work')},
            {'name': category.name, 'url': ''},
        ]
    })
    return render(request, 'website/category-detail.html', context)


def product_detail(request, category_slug, slug):
    """Detailed view for a specific product with rich snippets context."""
    item = get_object_or_404(PortfolioItem.objects.select_related('category'), slug=slug, category__slug=category_slug, is_active=True)
    related_items = PortfolioItem.objects.filter(category=item.category, is_active=True).exclude(pk=item.pk).order_by('?')[:4]
    
    context = get_common_context()
    context.update({
        'item': item,
        'related_items': related_items,
        'meta_title': f"{item.title} - {item.category.name} Bhopal | Adarsh ID Cards MP",
        'meta_description': f"Buy premium {item.title} ({item.category.name}) in Bhopal. Custom ID card solutions for schools and organizations across Madhya Pradesh by Adarsh Bhopal.",
        'meta_keywords': f"{item.title}, {item.category.name}, {item.title} Bhopal, ID Card printing Bhopal, Adarsh ID Cards",
        'canonical_url': request.build_absolute_uri(),
        'breadcrumb': [
            {'name': 'Home', 'url': reverse('website:home')},
            {'name': 'Our Products', 'url': reverse('website:our_work')},
            {'name': item.category.name, 'url': reverse('website:category_detail', kwargs={'slug': item.category.slug})},
            {'name': item.title, 'url': ''},
        ]
    })
    return render(request, 'website/product-detail.html', context)


# --- SEO Utility Views ---

def sitemap_view(request):
    """Dynamic XML sitemap."""
    sitemaps = {
        'static': StaticViewSitemap,
        'categories': PortfolioCategorySitemap,
        'products': PortfolioItemSitemap,
    }
    return sitemap(request, sitemaps=sitemaps)


def robots_txt(request):
    """SEO-optimized robots.txt."""
    site_url = request.build_absolute_uri('/').rstrip('/')
    lines = [
        "User-agent: *",
        "Allow: /",
        "",
        f"Sitemap: {site_url}/sitemap.xml",
    ]
    return HttpResponse("\n".join(lines), content_type="text/plain")





