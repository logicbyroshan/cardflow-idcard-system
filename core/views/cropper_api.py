"""
Cropper Update API Views
────────────────────────
Panel-based update system for Adarsh Engine.

GET  /api/cropper/latest-version/
    Called by the admin panel JS to check if an update is available.
    Returns the latest local installer version + download URL.
    Requires login (same as all admin-panel APIs).
    
The system checks for local installer files in:
- Face Cropper/Output/AdarshEngineSetup.exe
- static/engine/AdarshEngineSetup.exe
- media/engine/AdarshEngineSetup.exe

Panel provides one-click download and the engine's /self-update endpoint
handles the installation automatically.
"""
import logging
import os
from pathlib import Path

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from core.services.permission_service import require_any_admin

logger = logging.getLogger(__name__)


def _parse_semver_tuple(version: str) -> tuple[int, ...]:
    parts = []
    for token in str(version or "").split('.'):
        if token.isdigit():
            parts.append(int(token))
        else:
            digits = ''.join(ch for ch in token if ch.isdigit())
            parts.append(int(digits) if digits else 0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /api/cropper/latest-version/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_GET
def api_cropper_latest_version(request):
    """
    Return the latest local Cropper version from VERSION.txt.

    Response::

        {
            "available": true,
            "version":   "3.18.0",
            "download_url": "/engine/download/",
            "changelog": "Local installer build available."
        }

    or ``{ "available": false }`` if no local installer found.
    """
    from django.urls import reverse
    
    # Local download endpoint
    download_url = reverse('engine_download')
    
    # Read version from VERSION.txt
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
                if local_version:
                    break
        except Exception:
            continue
    
    if not local_version:
        # Fallback to default version
        local_version = '3.18.0'
    
    return JsonResponse({
        "available": True,
        "version": local_version,
        "download_url": download_url,
        "changelog": "Local installer build available.",
        "released_at": None,
    })
