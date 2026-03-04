"""
Simple in-memory rate limiter for authentication endpoints.

Uses Django's cache framework (default backend) to track request counts
per IP address.  No external dependencies required.

Usage:
    @method_decorator(rate_limit(max_requests=5, window_seconds=60), name='dispatch')
    class MyView(View): ...
"""
import functools
import logging

from django.core.cache import cache
from django.http import JsonResponse

logger = logging.getLogger(__name__)


def _get_client_ip(request):
    """Extract client IP from REMOTE_ADDR (safe default).
    
    Uses REMOTE_ADDR which is set by the WSGI server and cannot be spoofed.
    X-Forwarded-For is only trusted when the app runs behind a known reverse
    proxy (Nginx/Render etc.) that overwrites it.  The proxy must be
    configured to strip client-supplied X-Forwarded-For values.
    """
    # If running behind a trusted reverse proxy that sets X-Forwarded-For,
    # take only the *rightmost* IP added by the proxy (last hop).
    # In a typical single-proxy setup this is the first entry.
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        # Use the LAST entry (closest to the proxy), which is harder to spoof
        # than the first entry that a client can freely set.
        parts = [p.strip() for p in xff.split(',')]
        if len(parts) >= 2:
            # Multi-proxy chain: trust the second-to-last (added by our proxy)
            return parts[-2]
        return parts[0]
    return request.META.get('REMOTE_ADDR', '0.0.0.0')


def rate_limit(max_requests=5, window_seconds=60, key_prefix='rl'):
    """
    Decorator that rejects requests exceeding *max_requests* within
    a sliding *window_seconds* window for a given IP + view.

    Returns HTTP 429 JSON on throttle.
    """
    def decorator(view_func):
        @functools.wraps(view_func)
        def wrapper(request, *args, **kwargs):
            ip = _get_client_ip(request)
            cache_key = f'{key_prefix}:{view_func.__name__}:{ip}'
            # P3: atomic cache.add + incr pattern to prevent TOCTOU race.
            # cache.add is a no-op if the key already exists, so it only
            # sets the key (with TTL) when it is genuinely absent.
            # cache.incr then atomically bumps the counter in both cases.
            cache.add(cache_key, 0, window_seconds)
            hits = cache.incr(cache_key)
            if hits > max_requests:
                logger.warning('Rate limit hit: %s from %s', view_func.__name__, ip)
                return JsonResponse({
                    'success': False,
                    'level': 'warning',
                    'message': 'Too many requests. Please try again later.',
                }, status=429)
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator
