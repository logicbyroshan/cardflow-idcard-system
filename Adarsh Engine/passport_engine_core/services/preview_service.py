"""
Preview/listing service.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict

from .common import list_image_files, ensure_image_file


def preview_folder(folder_path: str) -> Dict[str, object]:
    raw = (folder_path or "").strip()
    if not raw:
        return {"files": []}

    folder = Path(raw)
    if not folder.is_dir():
        return {"files": []}

    return {"files": list_image_files(folder), "folder": str(folder)}


def resolve_image_file(path_value: str) -> Path:
    return ensure_image_file((path_value or "").strip())
