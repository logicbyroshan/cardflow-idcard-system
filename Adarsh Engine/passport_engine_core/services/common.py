"""
Common helpers for Adarsh Engine services.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

from .. import config

IMAGE_EXTENSIONS = config.ALLOWED_IMAGE_EXTENSIONS
OUTPUT_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def ensure_folder(path_value: str) -> Path:
    folder = Path(path_value)
    if not folder.exists():
        raise ValueError(f"Path does not exist: {path_value}")
    if not folder.is_dir():
        raise ValueError(f"Path is not a directory: {path_value}")
    return folder


def ensure_file(path_value: str) -> Path:
    file_path = Path(path_value)
    if not file_path.exists():
        raise ValueError(f"File not found: {path_value}")
    if not file_path.is_file():
        raise ValueError(f"Path is not a file: {path_value}")
    return file_path


def ensure_image_file(path_value: str) -> Path:
    file_path = ensure_file(path_value)
    if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError("Not an image file.")
    return file_path


def ensure_image_output_path(path_value: str) -> Path:
    output_path = Path(path_value)
    if output_path.suffix.lower() not in OUTPUT_IMAGE_EXTENSIONS:
        raise ValueError("Output must be .jpg, .jpeg, or .png")
    return output_path


def list_image_files(folder: Path) -> List[str]:
    return sorted(
        f.name
        for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
    )
