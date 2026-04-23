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

from core.services.permission_service import PermissionService, require_any_admin
from core.services.super_mode_service import SuperModeService

logger = logging.getLogger(__name__)

# Engine constants (reuse from engine_api)
ENGINE_BASE = os.getenv("ENGINE_BASE_URL", "http://127.0.0.1:4765")
ENGINE_API_KEY = os.getenv("ENGINE_API_KEY", "passport-engine-local-key")
ENGINE_TIMEOUT = 600

_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}


def _engine_headers():
    return {"X-ENGINE-KEY": ENGINE_API_KEY}


def _internal_error_response():
    """Return a generic server error payload without exposing exception text."""
    return JsonResponse(
        {"success": False, "message": "An unexpected error occurred. Please try again."},
        status=500,
    )


def _normalize_positive_int_ids(raw_ids, *, max_items=500):
    """Normalize arbitrary payload values into unique positive integer IDs."""
    if not isinstance(raw_ids, (list, tuple)):
        return []
    normalized = []
    seen = set()
    for item in raw_ids:
        if isinstance(item, bool):
            continue
        try:
            value = int(str(item).strip())
        except (TypeError, ValueError):
            continue
        if value <= 0 or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
        if len(normalized) >= max_items:
            break
    return normalized


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
    from core.views.idcard_api import _check_client_scope_by_table

    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err:
        return err

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"success": False, "message": "Invalid JSON"}, status=400)

    card_ids = _normalize_positive_int_ids(body.get("card_ids", []), max_items=500)
    if not card_ids:
        return JsonResponse(
            {"success": False, "message": "card_ids array is required"}, status=400
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
    from core.views.idcard_api import _check_client_scope_by_table

    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err:
        return err

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

    batch_table_id = CropService.get_batch_table_id(batch_id)
    if batch_table_id and int(batch_table_id) != int(table_id):
        return JsonResponse({"success": False, "message": "Batch does not belong to this table"}, status=400)

    batch_client_id = CropService.get_batch_client_id(batch_id)
    if batch_client_id and not PermissionService.can_access_client(request.user, int(batch_client_id)):
        return JsonResponse({"success": False, "message": "Access denied"}, status=403)

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
        return _internal_error_response()


# ═══════════════════════════════════════════════════════════════════════════
#  GET  /panel/api/crop-batch/<batch_id>/preview/
# ═══════════════════════════════════════════════════════════════════════════
@login_required
@require_any_admin
@require_GET
def api_crop_batch_preview(request, batch_id):
    """Return lists of original / cropped / failed / edited images."""
    from core.services.crop_service import CropService

    batch_client_id = CropService.get_batch_client_id(batch_id)
    if batch_client_id and not PermissionService.can_access_client(request.user, int(batch_client_id)):
        return JsonResponse({"success": False, "message": "Access denied"}, status=403)

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

    batch_client_id = CropService.get_batch_client_id(batch_id)
    if batch_client_id and not PermissionService.can_access_client(request.user, int(batch_client_id)):
        return JsonResponse({"error": "Access denied"}, status=403)

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
    response = FileResponse(open(file_path, "rb"), content_type=content_type)
    response.block_size = SuperModeService.download_block_size_bytes(request.user)
    return response


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
    from core.views.idcard_api import _check_client_scope_by_table

    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err:
        return err

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

    batch_table_id = CropService.get_batch_table_id(batch_id)
    if batch_table_id and int(batch_table_id) != int(table_id):
        return JsonResponse({"success": False, "message": "Batch does not belong to this table"}, status=400)

    batch_client_id = CropService.get_batch_client_id(batch_id)
    if batch_client_id and not PermissionService.can_access_client(request.user, int(batch_client_id)):
        return JsonResponse({"success": False, "message": "Access denied"}, status=403)

    result = CropService.reupload_cropped(
        table_id, 
        batch_id, 
        use_edited=use_edited, 
        user=request.user if request.user.is_authenticated else None,
        request=request
    )
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

    batch_client_id = CropService.get_batch_client_id(batch_id)
    if batch_client_id and not PermissionService.can_access_client(request.user, int(batch_client_id)):
        return JsonResponse({"success": False, "message": "Access denied"}, status=403)

    result = CropService.cleanup_batch(batch_id)
    return JsonResponse(result)
