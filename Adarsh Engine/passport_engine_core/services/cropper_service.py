"""
Cropper service: wraps passport crop engine entry points.
"""

from __future__ import annotations

from typing import Any, Dict

from ..engine import process_folder as _process_folder
from ..engine import process_zip as _process_zip


def process_zip(
    zip_path: str,
    original_path: str | None = None,
    output_folder: str | None = None,
) -> Dict[str, Any]:
    return _process_zip(zip_path, original_path=original_path, output_folder=output_folder)


def process_folder(folder_path: str) -> Dict[str, Any]:
    return _process_folder(folder_path)
