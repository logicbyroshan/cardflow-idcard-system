"""
File operations for Adarsh Engine.
"""

from __future__ import annotations

import base64
import re
import time
import zipfile
from pathlib import Path
from typing import List, Tuple

from .. import config
from .common import ensure_folder, ensure_image_file

_MAX_EDITED_PAYLOAD_BYTES = 15 * 1024 * 1024
_WIN_UNSAFE_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _sanitize_filename(name: str) -> str:
    name = Path(name).name
    name = _WIN_UNSAFE_RE.sub('_', name)
    name = name.strip('. ')
    return name or 'edited'


def _resolve_base_folder(path_obj: Path) -> Path:
    parent = path_obj.parent
    parent_name = parent.name.lower()
    if parent_name in {"cropped", "failed", "deleted", "edited"}:
        return parent.parent
    return parent


def _build_edited_output(original_path: str, filename: str | None) -> Tuple[Path, Path, str]:
    orig = Path(original_path).resolve()
    if not orig.is_absolute():
        raise ValueError("Absolute path required.")

    base_folder = _resolve_base_folder(orig)
    edited_folder = base_folder / "edited"
    edited_folder.mkdir(parents=True, exist_ok=True)

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

    return edited_folder, output_path, output_name


def save_edited_image(image_data: str, original_path: str, filename: str | None = None) -> dict:
    if not image_data or not original_path:
        raise ValueError("image_data and original_path are required.")

    if len(image_data) > _MAX_EDITED_PAYLOAD_BYTES:
        raise ValueError("Image data too large.")

    if not image_data.startswith("data:image/"):
        raise ValueError("Invalid image data format.")

    edited_folder, output_path, output_name = _build_edited_output(original_path, filename)

    try:
        _header, base64_data = image_data.split(",", 1)
        image_bytes = base64.b64decode(base64_data)
    except Exception as exc:
        raise ValueError("Failed to decode image data.") from exc

    if len(image_bytes) < 100:
        raise ValueError("Decoded image is too small — likely corrupt.")

    with open(output_path, "wb") as fh:
        fh.write(image_bytes)

    return {
        "success": True,
        "saved_path": str(output_path),
        "edited_folder": str(edited_folder),
        "filename": output_name,
    }


def delete_image(path_value: str) -> dict:
    src = ensure_image_file(path_value)

    base_folder = _resolve_base_folder(src)
    deleted_folder = base_folder / "deleted"
    deleted_folder.mkdir(parents=True, exist_ok=True)

    dest = deleted_folder / src.name
    counter = 1
    while dest.exists() and counter < 1000:
        dest = deleted_folder / f"{src.stem}_{counter}{src.suffix}"
        counter += 1

    src.rename(dest)

    return {
        "success": True,
        "deleted_path": str(dest),
        "deleted_folder": str(deleted_folder),
        "filename": src.name,
    }


def build_download_zip(folder_path: str, file_list: List[str] | None) -> Tuple[Path, str]:
    folder = ensure_folder(folder_path)

    requested_names: List[str] = []
    seen = set()
    if isinstance(file_list, list):
        for raw_name in file_list:
            normalized = Path(str(raw_name or "")).name.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            requested_names.append(normalized)

    if not requested_names:
        raise ValueError("No files selected.")

    selected_paths: List[Path] = []
    for name in requested_names:
        candidate = (folder / name).resolve()
        if not candidate.is_file():
            continue
        if candidate.suffix.lower() not in config.ALLOWED_IMAGE_EXTENSIONS:
            continue
        selected_paths.append(candidate)

    if not selected_paths:
        raise ValueError("No valid image files found.")

    ts = time.strftime('%Y%m%d_%H%M%S')
    folder_label = folder.name or 'images'
    output_name = f"{folder_label}_{ts}.zip"

    import tempfile

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_path = Path(temp_file.name)
    temp_file.close()

    with zipfile.ZipFile(temp_path, mode='w', compression=zipfile.ZIP_DEFLATED) as archive:
        for image_path in selected_paths:
            archive.write(str(image_path), arcname=image_path.name)

    return temp_path, output_name
