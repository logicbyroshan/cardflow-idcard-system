"""
Page photo picker service.
"""

from __future__ import annotations

from typing import Any, Dict

from ..page_photo_picker import pick_page_photos_in_folder
from .common import ensure_folder


def pick_page_photos(folder_path: str, photos_per_page: int = 3) -> Dict[str, Any]:
    folder = ensure_folder(folder_path)
    if photos_per_page < 1 or photos_per_page > 3:
        raise ValueError("photos_per_page must be between 1 and 3.")
    return pick_page_photos_in_folder(str(folder), photos_per_page=photos_per_page)
