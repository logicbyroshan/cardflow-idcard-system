"""
Crop API Views — endpoints for the "Crop Selected Images" feature.

Endpoints:
    POST /panel/api/table/<table_id>/cards/prepare-crop/
        Copies selected card images to a temp batch folder.

    POST /panel/api/table/<table_id>/cards/process-crop/
        Sends the batch folder to the Face Cropper engine.

    GET  /panel/api/crop-batch/<batch_id>/preview/
        Lists original, cropped, failed, and edited images.

    GET  /panel/api/crop-batch/<batch_id>/serve-image/
        Serves a single image from a batch subfolder.

    POST /panel/api/table/<table_id>/cards/reupload-cropped/
        Replaces card images with the cropped results.

    POST /panel/api/crop-batch/<batch_id>/cleanup/
        Removes temp files for a batch.
"""
import json
import logging
import mimetypes
import os
from pathlib import Path

import requests as http_client
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import FileResponse, JsonResponse
from django.views.decorators.http import require_GET, require_POST

from core.services.permission_service import require_any_admin

logger = logging.getLogger(__name__)

# Engine constants (reuse from engine_api)
ENGINE_BASE = os.getenv("ENGINE_BASE_URL", "http://127.0.0.1:4765")
ENGINE_API_KEY = os.getenv("ENGINE_API_KEY", "passport-engine-local-key")
ENGINE_TIMEOUT = 600

_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}


def _engine_headers():
    return {"X-ENGINE-KEY": ENGINE_API_KEY}


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /panel/api/table/<table_id>/cards/prepare-crop/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_POST
def api_prepare_crop(request, table_id):
    """
    Copy images from selected cards into a temp batch folder.
    Expects JSON: { "card_ids": [1, 2, 3, ...] }
    """
    from core.services.crop_service import CropService

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON"}, status=400)

    card_ids = body.get("card_ids", [])
    if not card_ids or not isinstance(card_ids, list):
        return JsonResponse(
            {"success": False, "message": "card_ids array is required"}, status=400
        )

    # Cap at 500 to avoid abuse
    if len(card_ids) > 500:
        return JsonResponse(
            {"success": False, "message": "Maximum 500 cards per crop batch"},
            status=400,
        )

    # Optional user-specified output folder path
    output_path = body.get("output_path", "")
    if not isinstance(output_path, str):
        output_path = ""
    output_path = output_path.strip()

    result = CropService.prepare_images(table_id, card_ids, output_path=output_path or None)
    status_code = 200 if result.get("success") else 400
    return JsonResponse(result, status=status_code)


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /panel/api/table/<table_id>/cards/process-crop/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_POST
def api_process_crop(request, table_id):
    """
    Send a batch folder to the Face Cropper engine for processing.
    Expects JSON: { "batch_id": "..." }
    """
    from core.services.crop_service import CropService

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON"}, status=400)

    batch_id = body.get("batch_id", "").strip()
    if not batch_id:
        return JsonResponse(
            {"success": False, "message": "batch_id is required"}, status=400
        )

    batch_dir = CropService._batch_dir(batch_id)
    if not batch_dir.is_dir():
        return JsonResponse(
            {"success": False, "message": "Batch folder not found"}, status=404
        )

    # Proxy to engine /process-folder
    try:
        resp = http_client.post(
            f"{ENGINE_BASE}/process-folder",
            headers={**_engine_headers(), "Content-Type": "application/json"},
            json={"folder_path": str(batch_dir)},
            timeout=ENGINE_TIMEOUT,
        )
        resp.raise_for_status()
        engine_data = resp.json()

        return JsonResponse({
            "success": True,
            "batch_id": batch_id,
            **engine_data,
        })

    except http_client.ConnectionError:
        return JsonResponse({
            "success": False,
            "message": "Cannot connect to Face Cropper engine. Is the service running?",
        }, status=502)
    except http_client.Timeout:
        return JsonResponse({
            "success": False,
            "message": "Engine timed out processing the images.",
        }, status=504)
    except http_client.HTTPError as exc:
        detail = ""
        try:
            detail = exc.response.json().get("detail", "")
        except Exception:
            pass
        return JsonResponse({
            "success": False,
            "message": detail or f"Engine error {exc.response.status_code}",
        }, status=exc.response.status_code)
    except Exception as exc:
        logger.exception("process-crop proxy error")
        return JsonResponse({"success": False, "message": str(exc)}, status=500)


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /panel/api/crop-batch/<batch_id>/preview/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_GET
def api_crop_batch_preview(request, batch_id):
    """Return lists of original / cropped / failed / edited images."""
    from core.services.crop_service import CropService

    result = CropService.list_batch_images(batch_id)
    status_code = 200 if result.get("success") else 404
    return JsonResponse(result, status=status_code)


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /panel/api/crop-batch/<batch_id>/serve-image/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_GET
def api_crop_batch_serve_image(request, batch_id):
    """
    Serve a single image from a batch subfolder.
    Query params:
        ?type=original|cropped|failed|edited
        &name=filename.jpg
    """
    from core.services.crop_service import CropService

    img_type = request.GET.get("type", "cropped").strip()
    img_name = request.GET.get("name", "").strip()

    if not img_name:
        return JsonResponse({"error": "name parameter required"}, status=400)

    batch_dir = CropService._batch_dir(batch_id)
    if not batch_dir.is_dir():
        return JsonResponse({"error": "Batch not found"}, status=404)

    # Determine folder
    type_map = {
        "original": batch_dir,
        "cropped": CropService._cropped_dir(batch_dir),
        "failed": CropService._failed_dir(batch_dir),
        "edited": CropService._edited_dir(batch_dir),
    }
    folder = type_map.get(img_type)
    if folder is None:
        return JsonResponse({"error": "Invalid type"}, status=400)

    # Sanitize filename (no path traversal)
    safe_name = Path(img_name).name
    file_path = folder / safe_name

    if not file_path.is_file():
        return JsonResponse({"error": "File not found"}, status=404)

    if file_path.suffix.lower() not in _ALLOWED_EXTS:
        return JsonResponse({"error": "Not an image file"}, status=400)

    content_type = mimetypes.guess_type(str(file_path))[0] or "image/jpeg"
    return FileResponse(file_path, content_type=content_type)


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /panel/api/table/<table_id>/cards/reupload-cropped/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_POST
def api_reupload_cropped(request, table_id):
    """
    Replace card images with cropped results from a batch.
    Expects JSON: { "batch_id": "...", "use_edited": false }
    """
    from core.services.crop_service import CropService

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON"}, status=400)

    batch_id = body.get("batch_id", "").strip()
    if not batch_id:
        return JsonResponse(
            {"success": False, "message": "batch_id is required"}, status=400
        )

    use_edited = bool(body.get("use_edited", False))

    result = CropService.reupload_cropped(table_id, batch_id, use_edited=use_edited)
    status_code = 200 if result.get("success") else 400
    return JsonResponse(result, status=status_code)


# ═══════════════════════════════════════════════════════════════════════════
#  POST  /panel/api/crop-batch/<batch_id>/cleanup/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_POST
def api_crop_batch_cleanup(request, batch_id):
    """Discard a batch without re-uploading."""
    from core.services.crop_service import CropService

    result = CropService.cleanup_batch(batch_id)
    return JsonResponse(result)
