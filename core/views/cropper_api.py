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
import hashlib
import hmac
import json
import logging
import os

from django.contrib.auth.decorators import login_required
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


def _verify_webhook(request) -> bool:
    """
    Verify the request is from a trusted source.

    Accepts two auth methods:
    1.  ``X-Webhook-Secret`` header — simple shared secret comparison.
    2.  ``X-Hub-Signature-256`` header — GitHub-style HMAC-SHA256 of the
        body (used when the webhook is triggered by a GitHub Action).

    Returns True if the request is authenticated, False otherwise.
    """
    if not WEBHOOK_SECRET:
        logger.warning("CROPPER_WEBHOOK_SECRET is not configured — rejecting webhook.")
        return False

    # Method 1: simple shared secret header
    header_secret = request.headers.get("X-Webhook-Secret", "")
    if header_secret and hmac.compare_digest(header_secret, WEBHOOK_SECRET):
        return True

    # Method 2: HMAC-SHA256 (GitHub style)
    sig_header = request.headers.get("X-Hub-Signature-256", "")
    if sig_header:
        expected = "sha256=" + hmac.new(
            WEBHOOK_SECRET.encode(),
            request.body,
            hashlib.sha256,
        ).hexdigest()
        if hmac.compare_digest(sig_header, expected):
            return True

    return False


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
    release = CropperRelease.objects.filter(is_latest=True).first()

    if not release:
        return JsonResponse({"available": False})

    # Use stored external URL if present, otherwise fall back to the local
    # Django download endpoint so the update banner always has a working link.
    from django.urls import reverse
    fallback_url = request.build_absolute_uri(reverse('engine_download'))
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
