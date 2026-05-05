"""
Compression service.
"""

from __future__ import annotations

from typing import Any, Dict

from ..compressor import compress_folder as _compress_folder
from .common import ensure_folder


def compress_folder(folder_path: str, target_kb: float) -> Dict[str, Any]:
    folder = ensure_folder(folder_path)
    if target_kb <= 0:
        raise ValueError("target_kb must be greater than 0.")
    return _compress_folder(str(folder), target_kb)
