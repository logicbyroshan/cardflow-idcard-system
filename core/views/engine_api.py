"""
Engine Proxy API Views — forward browser requests to the local PassportEngine.

The PassportEngine runs as a Windows service on 127.0.0.1:4765.
The installed binary's CORS list doesn't include the Django dev-server origin,
so we proxy every call through Django (same-origin → no CORS issues).
This also keeps the engine API key server-side.

Public surface:
    api_engine_status(request)          GET  → engine /status + /health
    api_engine_process_folder(request)  POST → engine /process-folder
    api_engine_preview(request)         GET  → list cropped images in a folder
    api_engine_serve_image(request)     GET  → serve a single image file
"""
import json
import logging
import mimetypes
from pathlib import Path

import requests as http_client
from django.contrib.auth.decorators import login_required
from django.http import FileResponse, JsonResponse
from django.views.decorators.http import require_GET, require_POST

from core.services.permission_service import require_any_admin

logger = logging.getLogger(__name__)

# ── Engine connection constants ──────────────────────────────────────────
ENGINE_BASE = "http://127.0.0.1:4765"
ENGINE_API_KEY = "passport-engine-local-key"
ENGINE_TIMEOUT = 600  # seconds — large batch folders need time


def _engine_headers():
    """Headers sent to the engine for authenticated endpoints."""
    return {"X-ENGINE-KEY": ENGINE_API_KEY}


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /api/engine/status/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_GET
def api_engine_status(request):
    """
    Proxy GET → engine /status + /health.
    Returns combined JSON with connection status:
        { connected: true, status: {...}, health: {...} }
    or  { connected: false, error: "..." }
    """
    try:
        status_resp = http_client.get(
            f"{ENGINE_BASE}/status", timeout=3
        )
        status_resp.raise_for_status()
        status_data = status_resp.json()

        # Health is optional — don't fail if it errors
        health_data = {}
        try:
            health_resp = http_client.get(
                f"{ENGINE_BASE}/health", timeout=3
            )
            health_resp.raise_for_status()
            health_data = health_resp.json()
        except Exception:
            pass

        return JsonResponse({
            "connected": True,
            "status": status_data,
            "health": health_data,
        })

    except http_client.ConnectionError:
        return JsonResponse({
            "connected": False,
            "error": "Engine not reachable. Is the PassportEngine service running?",
        })
    except http_client.Timeout:
        return JsonResponse({
            "connected": False,
            "error": "Engine timed out.",
        })
    except Exception as exc:
        logger.warning("Engine status check failed: %s", exc)
        return JsonResponse({
            "connected": False,
            "error": str(exc),
        })


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /api/engine/process-folder/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_POST
def api_engine_process_folder(request):
    """
    Proxy POST → engine /process-folder.
    Expects JSON body: { "folder_path": "C:\\..." }
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON body."}, status=400)

    folder_path = body.get("folder_path", "").strip()
    if not folder_path:
        return JsonResponse({"success": False, "message": "folder_path is required."}, status=400)

    try:
        resp = http_client.post(
            f"{ENGINE_BASE}/process-folder",
            headers={**_engine_headers(), "Content-Type": "application/json"},
            json={"folder_path": folder_path},
            timeout=ENGINE_TIMEOUT,
        )
        resp.raise_for_status()
        return JsonResponse({"success": True, **resp.json()})

    except http_client.ConnectionError:
        return JsonResponse({
            "success": False,
            "message": "Cannot connect to PassportEngine. Is the service running?",
        }, status=502)
    except http_client.Timeout:
        return JsonResponse({
            "success": False,
            "message": "Engine processing timed out.",
        }, status=504)
    except http_client.HTTPError as exc:
        body_data = {}
        try:
            body_data = exc.response.json()
        except Exception:
            pass
        msg = body_data.get("message") or body_data.get("detail") or f"Engine error {exc.response.status_code}"
        return JsonResponse({"success": False, "message": msg}, status=exc.response.status_code)
    except Exception as exc:
        logger.exception("process-folder proxy error")
        return JsonResponse({"success": False, "message": str(exc)}, status=500)


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /api/engine/preview/
# ═══════════════════════════════════════════════════════════════════════════
_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}


@login_required
@require_any_admin
@require_GET
def api_engine_preview(request):
    """
    Return a JSON list of image filenames inside a local folder.
    Query param: ?folder=C:\\path\\to\\folder
    Used to populate the preview grid after processing.
    Security: folder must be under MEDIA_ROOT.
    """
    from django.conf import settings

    folder = request.GET.get("folder", "").strip()
    if not folder:
        return JsonResponse({"files": []})

    folder_path = Path(folder).resolve()
    media_root = Path(settings.MEDIA_ROOT).resolve()

    # Path-traversal guard: only allow listing inside MEDIA_ROOT
    try:
        folder_path.relative_to(media_root)
    except ValueError:
        logger.warning("Path traversal attempt blocked (preview): %s", folder)
        return JsonResponse({"files": [], "error": "Invalid folder path"}, status=403)

    if not folder_path.is_dir():
        return JsonResponse({"files": []})

    files = sorted(
        f.name for f in folder_path.iterdir()
        if f.is_file() and f.suffix.lower() in _ALLOWED_EXTS
    )
    return JsonResponse({"files": files, "folder": str(folder_path)})


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /api/engine/serve-image/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_GET
def api_engine_serve_image(request):
    """
    Serve a single image file from the local filesystem.
    Query param: ?path=C:\\path\\to\\image.jpg
    Security: only serves files with image extensions and under MEDIA_ROOT.
    """
    from django.conf import settings

    file_path = request.GET.get("path", "").strip()
    if not file_path:
        return JsonResponse({"error": "path parameter required"}, status=400)

    path = Path(file_path).resolve()
    media_root = Path(settings.MEDIA_ROOT).resolve()

    # Path-traversal guard: only serve files under MEDIA_ROOT
    try:
        path.relative_to(media_root)
    except ValueError:
        logger.warning("Path traversal attempt blocked (serve-image): %s", file_path)
        return JsonResponse({"error": "Access denied"}, status=403)

    if not path.is_file():
        return JsonResponse({"error": "File not found"}, status=404)

    if path.suffix.lower() not in _ALLOWED_EXTS:
        return JsonResponse({"error": "Not an image file"}, status=400)

    content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    # FileResponse manages the file handle lifecycle properly
    return FileResponse(open(path, "rb"), content_type=content_type)
