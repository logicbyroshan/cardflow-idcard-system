"""
Monitoring API — receives client-side error reports from error-monitor.js

Endpoint: POST /panel/api/client-errors/
- Accepts JSON: { "errors": [ { type, message, source, line, ... }, ... ] }
- Logs each error via Python logging to error.log
- Rate-limited: max 10 reports per minute per session
"""
import json
import logging
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_protect

logger = logging.getLogger('core.views')

# Rate limit: max reports per minute per session key
_MAX_REPORTS_PER_MIN = 10


@require_POST
@csrf_protect
def api_client_errors(request):
    """
    Receive client-side JS errors and log them server-side.
    Only authenticated users can report (prevents abuse).
    """
    if not request.user.is_authenticated:
        return JsonResponse({'status': 'ignored'}, status=200)

    # Simple per-session rate limiting
    session = request.session
    import time
    now = time.time()
    window_key = '_err_report_window'
    count_key = '_err_report_count'

    window_start = session.get(window_key, 0)
    report_count = session.get(count_key, 0)

    if now - window_start > 60:
        # Reset window
        session[window_key] = now
        session[count_key] = 0
        report_count = 0

    if report_count >= _MAX_REPORTS_PER_MIN:
        return JsonResponse({'status': 'rate_limited'}, status=429)

    session[count_key] = report_count + 1

    # Parse body
    try:
        body = json.loads(request.body)
        errors = body.get('errors', [])
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'status': 'bad_request'}, status=400)

    if not isinstance(errors, list) or len(errors) == 0:
        return JsonResponse({'status': 'empty'}, status=200)

    # Cap at 50 per request to prevent abuse
    errors = errors[:50]

    username = getattr(request.user, 'username', 'unknown')

    for err in errors:
        err_type = err.get('type', 'unknown')
        message = err.get('message', '')
        source = err.get('source', '')
        line = err.get('line', 0)
        page_url = err.get('url', '')
        status_code = err.get('status', '')

        if err_type in ('error', 'rejection'):
            logger.warning(
                "CLIENT_JS_ERROR type=%s user=%s page=%s message=%s source=%s line=%s",
                err_type, username, page_url, message, source, line
            )
        elif err_type in ('htmx', 'htmx-network'):
            logger.warning(
                "CLIENT_HTMX_ERROR type=%s user=%s page=%s status=%s path=%s",
                err_type, username, page_url, status_code, err.get('path', '')
            )
        elif err_type == 'resource':
            logger.info(
                "CLIENT_RESOURCE_ERROR user=%s page=%s tag=%s src=%s",
                username, page_url, err.get('tag', ''), err.get('src', '')
            )

    return JsonResponse({'status': 'ok', 'received': len(errors)})
