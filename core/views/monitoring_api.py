"""
Monitoring API — receives client-side error reports from error-monitor.js

Endpoint: POST /panel/api/client-errors/
- Accepts JSON: { "errors": [ { type, message, source, line, ... }, ... ] }
- Logs each error via Python logging to error.log
- Rate-limited: max 10 reports per minute per session
"""
import json
import logging
import re
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_protect

logger = logging.getLogger('core.views')

# Rate limit: max reports per minute per session key
_MAX_REPORTS_PER_MIN = 10

# Max length for any single logged field to prevent log flooding
_MAX_LOG_FIELD_LEN = 500


def _sanitize_log_value(val, max_len=_MAX_LOG_FIELD_LEN):
    """Strip control chars / newlines from user input before logging to prevent log injection."""
    if not isinstance(val, str):
        val = str(val) if val is not None else ''
    # Remove newlines, carriage returns, and other control characters
    val = re.sub(r'[\r\n\x00-\x1f\x7f]', ' ', val)
    return val[:max_len]


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
        err_type = _sanitize_log_value(err.get('type', 'unknown'), 30)
        message = _sanitize_log_value(err.get('message', ''))
        source = _sanitize_log_value(err.get('source', ''), 200)
        line = err.get('line', 0)
        if not isinstance(line, (int, float)):
            line = 0
        page_url = _sanitize_log_value(err.get('url', ''), 200)
        status_code = _sanitize_log_value(err.get('status', ''), 10)

        if err_type in ('error', 'rejection'):
            logger.warning(
                "CLIENT_JS_ERROR type=%s user=%s page=%s message=%s source=%s line=%s",
                err_type, username, page_url, message, source, line
            )
        elif err_type in ('htmx', 'htmx-network'):
            logger.warning(
                "CLIENT_HTMX_ERROR type=%s user=%s page=%s status=%s path=%s",
                err_type, username, page_url, status_code,
                _sanitize_log_value(err.get('path', ''), 200)
            )
        elif err_type == 'resource':
            logger.info(
                "CLIENT_RESOURCE_ERROR user=%s page=%s tag=%s src=%s",
                username, page_url,
                _sanitize_log_value(err.get('tag', ''), 30),
                _sanitize_log_value(err.get('src', ''), 200)
            )

    return JsonResponse({'status': 'ok', 'received': len(errors)})
