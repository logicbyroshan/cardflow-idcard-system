"""
Cropper Auto-Update API Views
──────────────────────────────
Two endpoints that power the auto-update flow:

1.  POST /api/cropper/release-webhook/
    Called by the GitHub Actions CI/CD workflow after a successful build.
    Registers a new CropperRelease in the database.
    Authenticated via ``CROPPER_WEBHOOK_SECRET`` env-var (shared secret).

2.  GET  /api/cropper/latest-version/
    Called by the admin panel JS to check if an update is available.
    Returns the latest CropperRelease version + download URL.
    Requires login (same as all admin-panel APIs).
"""
import hmac
import json
import logging
import os
import time
from pathlib import Path

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from core.models import CropperRelease
from core.services.permission_service import require_any_admin

logger = logging.getLogger(__name__)

# Shared secret used to authenticate the GitHub Actions webhook.
# Set this as an environment variable on the production server AND in
# the GitHub repo secrets (CROPPER_WEBHOOK_SECRET).
WEBHOOK_SECRET = os.getenv("CROPPER_WEBHOOK_SECRET", "")
WEBHOOK_MAX_BODY_BYTES = int(os.getenv("CROPPER_WEBHOOK_MAX_BODY_BYTES", "65536"))
WEBHOOK_MAX_AGE_SECONDS = int(os.getenv("CROPPER_WEBHOOK_MAX_AGE_SECONDS", "300"))
WEBHOOK_RATE_LIMIT_PER_MIN = int(os.getenv("CROPPER_WEBHOOK_RATE_LIMIT_PER_MIN", "30"))
WEBHOOK_ALLOW_LEGACY_AUTH = os.getenv("CROPPER_WEBHOOK_ALLOW_LEGACY_AUTH", "false").strip().lower() in ('1', 'true', 'yes')


def _verify_webhook(request) -> bool:
    """
    Verify the request is from a trusted source.

    Preferred (replay-safe) auth:
    1. ``X-Hub-Signature-256`` with HMAC over ``"{timestamp}.{body}"``
       (or raw body for compatibility), plus
    2. ``X-Webhook-Timestamp`` and optional ``X-Webhook-Nonce``.

    Legacy auth (optional, compatibility):
    - ``X-Webhook-Secret`` header only.

    Returns True if the request is authenticated, False otherwise.
    """
    if not WEBHOOK_SECRET:
        logger.warning("CROPPER_WEBHOOK_SECRET is not configured — rejecting webhook.")
        return False

    timestamp_raw = (request.headers.get("X-Webhook-Timestamp") or "").strip()
    nonce = (request.headers.get("X-Webhook-Nonce") or "").strip()

    timestamp_value = None
    if timestamp_raw:
        try:
            timestamp_value = int(timestamp_raw)
        except (TypeError, ValueError):
            return False

        now = int(time.time())
        if abs(now - timestamp_value) > WEBHOOK_MAX_AGE_SECONDS:
            logger.warning("Webhook rejected: stale timestamp (age > %ss).", WEBHOOK_MAX_AGE_SECONDS)
            return False

        if nonce:
            nonce_key = f"cropper:webhook:nonce:{timestamp_raw}:{nonce}"
            if not cache.add(nonce_key, 1, WEBHOOK_MAX_AGE_SECONDS):
                logger.warning("Webhook rejected: replay nonce detected.")
                return False

    # Method 1: HMAC-SHA256 (preferred)
    sig_header = request.headers.get("X-Hub-Signature-256", "")
    if sig_header:
        expected_raw = "sha256=" + hmac.digest(
            WEBHOOK_SECRET.encode(),
            request.body,
            'sha256',
        ).hex()
        expected_timestamped = None
        if timestamp_raw:
            signed_payload = timestamp_raw.encode('utf-8') + b'.' + request.body
            expected_timestamped = "sha256=" + hmac.digest(
                WEBHOOK_SECRET.encode(),
                signed_payload,
                'sha256',
            ).hex()

        if (
            (expected_timestamped and hmac.compare_digest(sig_header, expected_timestamped))
            or hmac.compare_digest(sig_header, expected_raw)
        ):
            return True

    # Method 2: simple shared secret header (legacy compatibility)
    if WEBHOOK_ALLOW_LEGACY_AUTH:
        header_secret = request.headers.get("X-Webhook-Secret", "")
        if header_secret and hmac.compare_digest(header_secret, WEBHOOK_SECRET):
            return True

    return False


def _allow_webhook_rate(request) -> bool:
    """Best-effort per-IP rate limit to reduce brute-force/noise traffic."""
    ip = (
        request.META.get("HTTP_X_FORWARDED_FOR", "").split(',')[0].strip()
        or request.META.get("REMOTE_ADDR", "")
        or "unknown"
    )
    minute_bucket = int(time.time() // 60)
    key = f"cropper:webhook:rl:{ip}:{minute_bucket}"

    try:
        created = cache.add(key, 1, 70)
        if created:
            return True
        hits = int(cache.incr(key) or 0)
        return hits <= WEBHOOK_RATE_LIMIT_PER_MIN
    except Exception:
        # If cache is unavailable, avoid hard-failing valid releases.
        return True


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /api/cropper/release-webhook/
# ═══════════════════════════════════════════════════════════════════════════
@csrf_exempt
@require_POST
def api_cropper_release_webhook(request):
    """
    Register a new Adarsh Cropper release.

    Called by GitHub Actions after a successful build.  Payload::

        {
            "version":      "3.0.1",
            "download_url": "https://github.com/…/releases/download/…/AdarshCropperSetup.exe",
            "changelog":    "Bug fixes and performance improvements."
        }

    Auth: ``X-Webhook-Secret`` header must match ``CROPPER_WEBHOOK_SECRET``.
    """
    if len(request.body) > WEBHOOK_MAX_BODY_BYTES:
        return JsonResponse({"ok": False, "error": "Payload too large."}, status=413)

    if not _allow_webhook_rate(request):
        return JsonResponse({"ok": False, "error": "Too many requests."}, status=429)

    if not _verify_webhook(request):
        return JsonResponse(
            {"ok": False, "error": "Unauthorized"},
            status=401,
        )

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse(
            {"ok": False, "error": "Invalid JSON body."},
            status=400,
        )

    version = (body.get("version") or "").strip()
    download_url = (body.get("download_url") or "").strip()

    if not version or not download_url:
        return JsonResponse(
            {"ok": False, "error": "version and download_url are required."},
            status=400,
        )

    changelog = (body.get("changelog") or "").strip()

    # Upsert: update if version exists, create if not.
    release, created = CropperRelease.objects.update_or_create(
        version=version,
        defaults={
            "download_url": download_url,
            "changelog": changelog,
            "is_latest": True,
        },
    )

    action = "created" if created else "updated"
    logger.info("Cropper release v%s %s — %s", version, action, download_url)

    return JsonResponse({
        "ok": True,
        "action": action,
        "version": release.version,
        "download_url": release.download_url,
    })


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /api/cropper/latest-version/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_GET
def api_cropper_latest_version(request):
    """
    Return the latest published Cropper version.

    Response::

        {
            "available": true,
            "version":   "3.0.1",
            "download_url": "https://…/AdarshCropperSetup.exe",
            "changelog": "…"
        }

    or ``{ "available": false }`` if no release has been published yet.
    """
    from django.urls import reverse
    fallback_url = request.build_absolute_uri(reverse('engine_download'))

    release = CropperRelease.objects.filter(is_latest=True).first()
    if release:
        # Use stored external URL if present, otherwise fall back to the local
        # Django download endpoint so the update banner always has a working link.
        download_url = release.download_url.strip() if release.download_url else ''
        if not download_url:
            download_url = fallback_url

        return JsonResponse({
            "available": True,
            "version": release.version,
            "download_url": download_url,
            "changelog": release.changelog,
            "released_at": release.released_at.isoformat() if release.released_at else None,
        })

    # No release row exists (e.g., local/manual build) -> fall back to the
    # bundled engine VERSION.txt so download buttons still show a concrete version.
    base_dir = Path(getattr(settings, 'BASE_DIR', Path(__file__).resolve().parents[2]))
    version_candidates = [
        base_dir / 'Face Cropper' / 'VERSION.txt',
        base_dir / 'VERSION.txt',
    ]
    local_version = ''
    for candidate in version_candidates:
        try:
            if candidate.exists() and candidate.is_file():
                local_version = candidate.read_text(encoding='utf-8').strip()
        except Exception:
            continue
        if local_version:
            break

    if not local_version:
        return JsonResponse({"available": False, "download_url": fallback_url})

    return JsonResponse({
        "available": True,
        "version": local_version,
        "download_url": fallback_url,
        "changelog": "Local installer build available.",
        "released_at": None,
    })
