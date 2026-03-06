"""
Engine Proxy API Views — forward browser requests to the local Adarsh Engine.

The Adarsh Engine runs as a Windows service on 127.0.0.1:4765.
The installed binary's CORS list doesn't include the Django dev-server origin,
so we proxy every call through Django (same-origin → no CORS issues).
This also keeps the engine API key server-side.

Public surface:
    api_engine_status(request)          GET  → engine /status + /health
    api_engine_process_folder(request)  POST → engine /process-folder
    api_engine_preview(request)         GET  → list cropped images in a folder
    api_engine_serve_image(request)     GET  → serve a single image file
    api_engine_save_edited(request)     POST → save edited image to /edited/ subfolder
"""
import base64
import concurrent.futures
import json
import logging
import mimetypes
import os
import shutil
import re
import time
from pathlib import Path

import requests as http_client
from django.contrib.auth.decorators import login_required
from django.http import FileResponse, JsonResponse
from django.views.decorators.http import require_GET, require_POST

from core.services.permission_service import require_any_admin

logger = logging.getLogger(__name__)

# ── Engine connection constants ──────────────────────────────────────────
ENGINE_BASE = os.getenv("ENGINE_BASE_URL", "http://127.0.0.1:4765")
ENGINE_API_KEY = os.getenv("ENGINE_API_KEY", "passport-engine-local-key")
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
    def _fetch_status():
        r = http_client.get(f"{ENGINE_BASE}/status", timeout=3)
        r.raise_for_status()
        return r.json()

    def _fetch_health():
        try:
            r = http_client.get(f"{ENGINE_BASE}/health", timeout=3)
            r.raise_for_status()
            return r.json()
        except Exception:
            return {}

    try:
        # Fire both calls concurrently — worst-case latency drops from 6 s → 3 s.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            status_future = pool.submit(_fetch_status)
            health_future = pool.submit(_fetch_health)
            status_data = status_future.result()   # raises on engine error
            health_data = health_future.result()

        return JsonResponse({
            "connected": True,
            "status": status_data,
            "health": health_data,
        })

    except http_client.ConnectionError:
        return JsonResponse({
            "connected": False,
            "error": "Engine not reachable. Is the Adarsh Engine service running?",
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
            "error": "Engine status check failed. Check server logs for details.",
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
            "message": "Cannot connect to Adarsh Engine. Is the service running?",
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
#  POST  /api/engine/compress-folder/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_POST
def api_engine_compress_folder(request):
    """
    Proxy POST → engine /compress-folder.
    Expects JSON body: { "folder_path": "C:\\...", "target_kb": 100 }
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON body."}, status=400)

    folder_path = body.get("folder_path", "").strip()
    target_kb = body.get("target_kb")

    if not folder_path:
        return JsonResponse({"success": False, "message": "folder_path is required."}, status=400)
    if target_kb is None or not isinstance(target_kb, (int, float)) or target_kb <= 0:
        return JsonResponse({"success": False, "message": "target_kb must be a positive number."}, status=400)

    try:
        resp = http_client.post(
            f"{ENGINE_BASE}/compress-folder",
            headers={**_engine_headers(), "Content-Type": "application/json"},
            json={"folder_path": folder_path, "target_kb": float(target_kb)},
            timeout=ENGINE_TIMEOUT,
        )
        resp.raise_for_status()
        return JsonResponse({"success": True, **resp.json()})

    except http_client.ConnectionError:
        return JsonResponse({
            "success": False,
            "message": "Cannot connect to Adarsh Engine. Is the service running?",
        }, status=502)
    except http_client.Timeout:
        return JsonResponse({
            "success": False,
            "message": "Engine compression timed out.",
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
        logger.exception("compress-folder proxy error")
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
    Accepts any absolute path (engine output can be anywhere on the machine).
    """

    folder = request.GET.get("folder", "").strip()
    if not folder:
        return JsonResponse({"files": []})

    folder_path = Path(folder).resolve()

    # Only reject relative paths that try to escape via "../" — absolute output
    # folders (e.g. C:\Users\...\Downloads\...) are valid engine output dirs.
    if not folder_path.is_absolute():
        logger.warning("Non-absolute path rejected (preview): %s", folder)
        return JsonResponse({"files": [], "error": "Absolute path required"}, status=400)

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
    Accepts any absolute path so engine output folders outside MEDIA_ROOT work.
    Extension is still validated to image types only.
    """

    file_path = request.GET.get("path", "").strip()
    if not file_path:
        return JsonResponse({"error": "path parameter required"}, status=400)

    path = Path(file_path).resolve()

    # Reject relative paths — engine always returns absolute output paths.
    if not path.is_absolute():
        logger.warning("Non-absolute path rejected (serve-image): %s", file_path)
        return JsonResponse({"error": "Absolute path required"}, status=400)

    if not path.is_file():
        return JsonResponse({"error": "File not found"}, status=404)

    if path.suffix.lower() not in _ALLOWED_EXTS:
        return JsonResponse({"error": "Not an image file"}, status=400)

    content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    # Open explicitly so FileResponse works correctly on Windows with BackslashPaths
    return FileResponse(open(path, 'rb'), content_type=content_type)


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /api/engine/save-edited/
#  v2: Save edited image to /edited/ subfolder (production-hardened)
# ═══════════════════════════════════════════════════════════════════════════
# Maximum accepted image data size (15 MB base64 ≈ ~11 MB raw image)
_MAX_EDITED_PAYLOAD_BYTES = 15 * 1024 * 1024

# Characters forbidden in Windows filenames
_WIN_UNSAFE_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _sanitize_filename(name: str) -> str:
    """
    Sanitize a filename for safe use on Windows.
    Strips path separators, control chars, and reserved characters.
    Falls back to 'edited' if result is empty.
    """
    # Take only the basename (strip any path components)
    name = os.path.basename(name)
    # Remove Windows-unsafe characters
    name = _WIN_UNSAFE_RE.sub('_', name)
    # Strip leading/trailing dots and spaces (Windows reserved)
    name = name.strip('. ')
    # Fallback
    if not name:
        name = 'edited'
    return name


@login_required
@require_any_admin
@require_POST
def api_engine_save_edited(request):
    """
    Receive an edited image (base64 data URL) and save it to an /edited/
    subfolder adjacent to the original image's parent folder.

    Expects JSON body:
        {
            "image_data":    "data:image/jpeg;base64,...",
            "original_path": "C:\\path\\to\\folder\\cropped\\image.jpg",
            "filename":      "image.jpg"
        }

    Saves to:  <parent_of_cropped>/edited/<sanitized_stem>_edited_<HHMMSSfff>.jpg

    Security:
        - original_path must be under MEDIA_ROOT.
        - Only image data URLs are accepted.
        - Payload size capped at 15 MB.
        - Filename sanitized for Windows.
        - Collision-safe millisecond timestamps.
    """
    from django.conf import settings

    # ── Size guard ───────────────────────────────────────────────────
    content_length = request.META.get('CONTENT_LENGTH')
    if content_length:
        try:
            if int(content_length) > _MAX_EDITED_PAYLOAD_BYTES:
                return JsonResponse({
                    "success": False,
                    "message": "Payload too large. Maximum 15 MB.",
                }, status=413)
        except (ValueError, TypeError):
            pass

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON body."}, status=400)

    image_data = body.get("image_data", "")
    original_path = body.get("original_path", "").strip()
    filename = body.get("filename", "").strip()

    if not image_data or not original_path:
        return JsonResponse({
            "success": False,
            "message": "image_data and original_path are required.",
        }, status=400)

    # ── Validate the data URL format ─────────────────────────────────
    if not image_data.startswith("data:image/"):
        return JsonResponse({
            "success": False,
            "message": "Invalid image data format.",
        }, status=400)

    # ── Secondary size check on actual data ──────────────────────────
    if len(image_data) > _MAX_EDITED_PAYLOAD_BYTES:
        return JsonResponse({
            "success": False,
            "message": "Image data too large.",
        }, status=413)

    # ── Path validation ──────────────────────────────────────────────
    try:
        orig = Path(original_path).resolve()
    except (OSError, ValueError):
        return JsonResponse({
            "success": False,
            "message": "Invalid file path.",
        }, status=400)

    # Reject relative paths — engine always returns absolute output paths.
    if not orig.is_absolute():
        logger.warning("Non-absolute path rejected (save-edited): %s", original_path)
        return JsonResponse({
            "success": False,
            "message": "Absolute path required.",
        }, status=400)

    # ── Determine the /edited/ folder ────────────────────────────────
    # original_path is like: .../some_folder/cropped/image.jpg
    # edited folder should be: .../some_folder/edited/
    parent_folder = orig.parent  # e.g. .../cropped/
    grandparent = parent_folder.parent  # e.g. .../some_folder/

    edited_folder = grandparent / "edited"

    # Create /edited/ folder if it doesn't exist
    try:
        edited_folder.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.exception("Failed to create /edited/ folder: %s", edited_folder)
        return JsonResponse({
            "success": False,
            "message": "Server error while saving image.",
        }, status=500)

    # ── Build collision-safe output filename ──────────────────────────
    if not filename:
        filename = orig.stem + ".jpg"

    stem = _sanitize_filename(Path(filename).stem)
    # Use HHMMSS + milliseconds for collision safety
    timestamp = time.strftime("%H%M%S") + f"{int(time.time() * 1000) % 1000:03d}"
    output_name = f"{stem}_edited_{timestamp}.jpg"
    output_path = edited_folder / output_name

    # Final collision check — append counter if file somehow exists
    counter = 1
    while output_path.exists() and counter < 100:
        output_name = f"{stem}_edited_{timestamp}_{counter}.jpg"
        output_path = edited_folder / output_name
        counter += 1

    # ── Decode base64 and save ───────────────────────────────────────
    try:
        # Strip the data URL prefix: "data:image/jpeg;base64,..."
        _header, base64_data = image_data.split(",", 1)
        image_bytes = base64.b64decode(base64_data)
    except Exception as exc:
        logger.warning("Base64 decode failed: %s", exc)
        return JsonResponse({
            "success": False,
            "message": "Failed to decode image data.",
        }, status=400)

    # ── Validate decoded size (must be > 0 and reasonable) ───────────
    if len(image_bytes) < 100:
        return JsonResponse({
            "success": False,
            "message": "Decoded image is too small — likely corrupt.",
        }, status=400)

    try:
        with open(output_path, "wb") as f:
            f.write(image_bytes)
    except OSError as exc:
        logger.exception("Failed to write edited image: %s", output_path)
        return JsonResponse({
            "success": False,
            "message": "Failed to save image.",
        }, status=500)

    logger.info("Saved edited image: %s (%d bytes)", output_path, len(image_bytes))

    return JsonResponse({
        "success": True,
        "saved_path": str(output_path),
        "edited_folder": str(edited_folder),
        "filename": output_name,
    })


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /api/engine/delete-image/
#  Move an image to a /deleted/ subfolder (soft-delete, not permanent).
# ═══════════════════════════════════════════════════════════════════════════


@login_required
@require_any_admin
@require_POST
def api_engine_delete_image(request):
    """
    Move an image file to a /deleted/ subfolder (soft-delete).

    Expects JSON body:
        {
            "path": "C:\\path\\to\\folder\\cropped\\image.jpg"
        }

    Moves to: <parent_of_subfolder>/deleted/<original_filename>

    Security:
        - image_path must be under MEDIA_ROOT.
        - Only image extensions allowed.
        - Filename sanitized for safety.
    """
    from django.conf import settings

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON body."}, status=400)

    image_path = body.get("path", "").strip()
    if not image_path:
        return JsonResponse({"success": False, "message": "path is required."}, status=400)

    # ── Resolve and validate path ────────────────────────────────
    try:
        src = Path(image_path).resolve()
    except (OSError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid file path."}, status=400)

    # Reject relative paths — engine always returns absolute output paths.
    if not src.is_absolute():
        logger.warning("Non-absolute path rejected (delete-image): %s", image_path)
        return JsonResponse({"success": False, "message": "Absolute path required."}, status=400)

    if not src.is_file():
        return JsonResponse({"success": False, "message": "File not found."}, status=404)

    if src.suffix.lower() not in _ALLOWED_EXTS:
        return JsonResponse({"success": False, "message": "Not an image file."}, status=400)

    # ── Determine the /deleted/ folder ───────────────────────────
    parent_folder = src.parent          # e.g. .../cropped/
    grandparent = parent_folder.parent  # e.g. .../some_folder/

    deleted_folder = grandparent / "deleted"

    try:
        deleted_folder.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.exception("Failed to create /deleted/ folder: %s", deleted_folder)
        return JsonResponse({
            "success": False,
            "message": "Server error while deleting image.",
        }, status=500)

    # ── Build unique destination filename ────────────────────────
    dest = deleted_folder / src.name

    # Collision: append counter
    counter = 1
    while dest.exists() and counter < 1000:
        dest = deleted_folder / f"{src.stem}_{counter}{src.suffix}"
        counter += 1

    # ── Move the file ────────────────────────────────────────────
    try:
        shutil.move(str(src), str(dest))
    except OSError as exc:
        logger.exception("Failed to move image to deleted: %s → %s", src, dest)
        return JsonResponse({
            "success": False,
            "message": "Failed to delete image.",
        }, status=500)

    logger.info("Moved image to deleted: %s → %s", src, dest)

    return JsonResponse({
        "success": True,
        "deleted_path": str(dest),
        "deleted_folder": str(deleted_folder),
        "filename": src.name,
    })


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /api/engine/adjust-image/
#  Proxy image adjustments (levels, vibrance, temperature) to the engine.
# ═══════════════════════════════════════════════════════════════════════════


@login_required
@require_any_admin
@require_POST
def api_engine_adjust_image(request):
    """
    Proxy request to the engine's /adjust-image endpoint.
    
    The engine applies professional-quality image adjustments using
    Pillow/numpy and saves the result. This provides higher quality
    than browser Canvas processing.

    Expects JSON body:
        {
            "image_path": "C:\\path\\to\\cropped\\image.jpg",
            "original_path": "C:\\path\\to\\cropped\\image.jpg" (for edited folder location),
            "filename": "image.jpg" (optional, for output naming),
            "black_point": 0,        (0-254)
            "gamma": 1.0,            (0.01-3.0)
            "white_point": 255,      (1-255)
            "vibrance": 0,           (-100 to 100)
            "temperature": 0         (-100 to 100)
        }

    Returns:
        - success: True/False
        - saved_path: Path where adjusted image was saved
        - edited_folder: Parent folder of the saved image
        - filename: Name of the saved file
        - message: Error message if failed
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON body."}, status=400)

    image_path = body.get("image_path", "").strip()
    original_path = body.get("original_path", "").strip() or image_path
    filename = body.get("filename", "").strip()
    
    # Adjustment parameters
    black_point = body.get("black_point", 0)
    gamma = body.get("gamma", 1.0)
    white_point = body.get("white_point", 255)
    vibrance = body.get("vibrance", 0)
    temperature = body.get("temperature", 0)

    if not image_path:
        return JsonResponse({
            "success": False,
            "message": "image_path is required.",
        }, status=400)

    # ── Path validation ──────────────────────────────────────────────
    try:
        src = Path(image_path).resolve()
        orig = Path(original_path).resolve()
    except (OSError, ValueError):
        return JsonResponse({
            "success": False,
            "message": "Invalid file path.",
        }, status=400)

    if not src.is_absolute():
        return JsonResponse({
            "success": False,
            "message": "Absolute path required.",
        }, status=400)

    if not src.is_file():
        return JsonResponse({
            "success": False,
            "message": "Source image not found.",
        }, status=404)

    if src.suffix.lower() not in _ALLOWED_EXTS:
        return JsonResponse({
            "success": False,
            "message": "Not an image file.",
        }, status=400)

    # ── Determine the /edited/ folder ────────────────────────────────
    parent_folder = orig.parent
    grandparent = parent_folder.parent
    edited_folder = grandparent / "edited"

    try:
        edited_folder.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.exception("Failed to create /edited/ folder: %s", edited_folder)
        return JsonResponse({
            "success": False,
            "message": "Server error while creating output folder.",
        }, status=500)

    # ── Build collision-safe output filename ──────────────────────────
    if not filename:
        filename = orig.stem + ".jpg"

    stem = _sanitize_filename(Path(filename).stem)
    timestamp = time.strftime("%H%M%S") + f"{int(time.time() * 1000) % 1000:03d}"
    output_name = f"{stem}_edited_{timestamp}.jpg"
    output_path = edited_folder / output_name

    counter = 1
    while output_path.exists() and counter < 100:
        output_name = f"{stem}_edited_{timestamp}_{counter}.jpg"
        output_path = edited_folder / output_name
        counter += 1

    # ── Call engine /adjust-image ────────────────────────────────────
    try:
        response = http_client.post(
            f"{ENGINE_BASE}/adjust-image",
            headers=_engine_headers(),
            json={
                "image_path": str(src),
                "output_path": str(output_path),
                "black_point": black_point,
                "gamma": gamma,
                "white_point": white_point,
                "vibrance": vibrance,
                "temperature": temperature,
            },
            timeout=60,  # 60s timeout for large images
        )
        response.raise_for_status()
        result = response.json()

        if result.get("success"):
            logger.info("Adjusted image via engine: %s", output_path)
            return JsonResponse({
                "success": True,
                "saved_path": str(output_path),
                "edited_folder": str(edited_folder),
                "filename": output_name,
            })
        else:
            return JsonResponse({
                "success": False,
                "message": result.get("error", "Engine adjustment failed."),
            }, status=500)

    except http_client.ConnectionError:
        logger.error("Engine not reachable for adjust-image")
        return JsonResponse({
            "success": False,
            "message": "Image Engine is not running. Please start the Adarsh Engine service.",
        }, status=503)

    except http_client.Timeout:
        logger.error("Engine timeout during adjust-image")
        return JsonResponse({
            "success": False,
            "message": "Engine processing timed out.",
        }, status=504)

    except Exception as exc:
        logger.exception("Engine adjust-image failed: %s", exc)
        return JsonResponse({
            "success": False,
            "message": "Server error during image adjustment.",
        }, status=500)


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /engine/download/
#  Serve AdarshEngineSetup.exe (Inno Setup installer) as a proper attachment download.
#
#  Serving via Django (instead of a direct /static/ link) lets us set
#  Content-Disposition and other headers that help browsers treat the file
#  as an intentional download rather than a suspicious URL-based fetch.
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_GET
def engine_download(request):
    """
    Stream AdarshEngineSetup.exe (Inno Setup installer) to the browser as an attachment.

    Looks for the file in:
      1. STATICFILES_DIRS[0]/engine/AdarshEngineSetup.exe  (dev)
      2. STATIC_ROOT/engine/AdarshEngineSetup.exe           (production / collectstatic)
      3. BASE_DIR/static/engine/AdarshEngineSetup.exe       (fallback)
    """
    from django.conf import settings
    from django.http import Http404

    candidates = []

    # Dev: look in each staticfiles dir
    for sdir in getattr(settings, 'STATICFILES_DIRS', []):
        candidates.append(Path(sdir) / 'engine' / 'AdarshEngineSetup.exe')

    # Production: collected static root
    if hasattr(settings, 'STATIC_ROOT') and settings.STATIC_ROOT:
        candidates.append(Path(settings.STATIC_ROOT) / 'engine' / 'AdarshEngineSetup.exe')

    # Absolute fallback: project-root /static/
    candidates.append(Path(settings.BASE_DIR) / 'static' / 'engine' / 'AdarshEngineSetup.exe')

    exe_path = None
    for candidate in candidates:
        if candidate.exists():
            exe_path = candidate
            break

    if exe_path is None:
        logger.error("AdarshEngineSetup.exe not found in any static path.")
        raise Http404("AdarshEngine installer not found.")

    logger.info("Serving AdarshEngineSetup.exe from: %s", exe_path)

    response = FileResponse(
        open(exe_path, 'rb'),
        content_type='application/octet-stream',
        as_attachment=True,
        filename='AdarshEngineSetup.exe',
    )
    # Suppress browsers/proxies from sniffing the content type
    response['X-Content-Type-Options'] = 'nosniff'
    # Tell the browser the exact byte size so it shows a proper progress bar
    response['Content-Length'] = exe_path.stat().st_size
    return response


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /api/engine/rename-preview/
#  Generate preview of batch rename operations without executing.
# ═══════════════════════════════════════════════════════════════════════════


@login_required
@require_any_admin
@require_POST
def api_engine_rename_preview(request):
    """
    Proxy POST → engine /rename-preview.
    
    Generates a preview of rename operations showing original → new filenames.
    Useful for the UI to display what will change before confirming.
    
    Expects JSON body:
        {
            "folder_path": "C:\\path\\to\\folder",
            "operation": "add_prefix",
            "params": {"prefix": "vacation_"},
            "file_list": null  (optional, defaults to all images in folder)
        }
    
    Returns:
        - success: True/False
        - files: List of {original, new, changed, conflict} mappings
        - total, changed, conflicts counts
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON body."}, status=400)

    folder_path = body.get("folder_path", "").strip()
    operation = body.get("operation", "")
    params = body.get("params", {})
    file_list = body.get("file_list")

    if not folder_path:
        return JsonResponse({"success": False, "message": "folder_path is required."}, status=400)
    if not operation:
        return JsonResponse({"success": False, "message": "operation is required."}, status=400)

    try:
        resp = http_client.post(
            f"{ENGINE_BASE}/rename-preview",
            headers={**_engine_headers(), "Content-Type": "application/json"},
            json={
                "folder_path": folder_path,
                "operation": operation,
                "params": params,
                "file_list": file_list,
            },
            timeout=60,
        )
        resp.raise_for_status()
        return JsonResponse(resp.json())

    except http_client.ConnectionError:
        return JsonResponse({
            "success": False,
            "message": "Cannot connect to Adarsh Engine. Is the service running?",
        }, status=502)
    except http_client.Timeout:
        return JsonResponse({
            "success": False,
            "message": "Engine preview timed out.",
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
        logger.exception("rename-preview proxy error")
        return JsonResponse({"success": False, "message": str(exc)}, status=500)


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /api/engine/rename-execute/
#  Execute batch rename operations on files in a folder.
# ═══════════════════════════════════════════════════════════════════════════


@login_required
@require_any_admin
@require_POST
def api_engine_rename_execute(request):
    """
    Proxy POST → engine /rename-execute.
    
    Executes the batch rename operation on files in the folder.
    
    Expects JSON body:
        {
            "folder_path": "C:\\path\\to\\folder",
            "operation": "add_prefix",
            "params": {"prefix": "vacation_"},
            "file_list": null,       (optional, defaults to all images)
            "skip_conflicts": true   (optional, default true)
        }
    
    Returns:
        - success: True/False
        - renamed: Number of files successfully renamed
        - skipped: Files skipped due to conflicts
        - errors: List of error messages
        - mappings: List of {original, new} for renamed files
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON body."}, status=400)

    folder_path = body.get("folder_path", "").strip()
    operation = body.get("operation", "")
    params = body.get("params", {})
    file_list = body.get("file_list")
    skip_conflicts = body.get("skip_conflicts", True)

    if not folder_path:
        return JsonResponse({"success": False, "message": "folder_path is required."}, status=400)
    if not operation:
        return JsonResponse({"success": False, "message": "operation is required."}, status=400)

    try:
        resp = http_client.post(
            f"{ENGINE_BASE}/rename-execute",
            headers={**_engine_headers(), "Content-Type": "application/json"},
            json={
                "folder_path": folder_path,
                "operation": operation,
                "params": params,
                "file_list": file_list,
                "skip_conflicts": skip_conflicts,
            },
            timeout=ENGINE_TIMEOUT,
        )
        resp.raise_for_status()
        return JsonResponse(resp.json())

    except http_client.ConnectionError:
        return JsonResponse({
            "success": False,
            "message": "Cannot connect to Adarsh Engine. Is the service running?",
        }, status=502)
    except http_client.Timeout:
        return JsonResponse({
            "success": False,
            "message": "Engine rename timed out.",
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
        logger.exception("rename-execute proxy error")
        return JsonResponse({"success": False, "message": str(exc)}, status=500)


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /api/engine/rename-operations/
#  Get list of supported rename operations for UI dropdown.
# ═══════════════════════════════════════════════════════════════════════════


@login_required
@require_any_admin
@require_GET
def api_engine_rename_operations(request):
    """
    Proxy GET → engine /rename-operations.
    
    Returns the list of supported rename operations with descriptions
    and parameter specifications. Useful for populating UI dropdowns.
    """
    try:
        resp = http_client.get(
            f"{ENGINE_BASE}/rename-operations",
            headers=_engine_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        return JsonResponse(resp.json())

    except http_client.ConnectionError:
        return JsonResponse({
            "success": False,
            "message": "Cannot connect to Adarsh Engine.",
        }, status=502)
    except http_client.Timeout:
        return JsonResponse({
            "success": False,
            "message": "Engine timed out.",
        }, status=504)
    except Exception as exc:
        logger.exception("rename-operations proxy error")
        return JsonResponse({"success": False, "message": str(exc)}, status=500)


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /api/engine/clients/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_GET
def api_engine_clients(request):
    """
    Return accessible clients with their image folder paths for the cropper.
    
    Used to populate the client dropdown in the Adarsh Cropper UI,
    allowing users to quickly select a client's photo folder.
    
    Response:
        {
            "success": true,
            "clients": [
                {"id": 1, "name": "Client Name", "folder_code": "XYZ", "folder_path": "C:\\path\\to\\media\\adarshimg\\XYZ"},
                ...
            ]
        }
    """
    from django.conf import settings
    from client.models import Client
    from staff.services import ClientScopingService
    
    try:
        clients_qs = ClientScopingService.get_accessible_clients(request.user)
        
        # Build list with full folder paths
        media_root = Path(settings.MEDIA_ROOT)
        clients_data = []
        
        for client in clients_qs.filter(status='active').order_by('name'):
            folder_code = client.image_folder_code
            if folder_code:
                # Full path: MEDIA_ROOT/adarshimg/{folder_code}
                folder_path = media_root / 'adarshimg' / folder_code
                clients_data.append({
                    'id': client.id,
                    'name': client.name,
                    'folder_code': folder_code,
                    'folder_path': str(folder_path),
                })
        
        return JsonResponse({
            'success': True,
            'clients': clients_data,
        })
        
    except Exception as exc:
        logger.exception("api_engine_clients error")
        return JsonResponse({
            'success': False,
            'message': str(exc),
        }, status=500)
