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
    """Extract client IP, respecting X-Forwarded-For behind a proxy."""
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
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
            hits = cache.get(cache_key, 0)
            if hits >= max_requests:
                logger.warning('Rate limit hit: %s from %s', view_func.__name__, ip)
                return JsonResponse({
                    'success': False,
                    'message': 'Too many requests. Please try again later.',
                }, status=429)
            cache.set(cache_key, hits + 1, window_seconds)
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator
