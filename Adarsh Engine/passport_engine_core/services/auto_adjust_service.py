"""
Auto-adjust service (auto levels + save).
"""

from __future__ import annotations

from typing import Dict

from ..adjustments import apply_adjustments, compute_auto_levels
from .common import ensure_image_file, ensure_image_output_path


def auto_levels(image_path: str) -> Dict[str, object]:
    ensure_image_file(image_path)
    params = compute_auto_levels(image_path)
    return {
        "success": True,
        **params,
    }


def auto_adjust_image(
    image_path: str,
    output_path: str,
    vibrance: int = 0,
    temperature: int = 0,
) -> Dict[str, object]:
    ensure_image_file(image_path)
    ensure_image_output_path(output_path)

    params = compute_auto_levels(image_path)
    _image, error = apply_adjustments(
        image_path=image_path,
        black_point=params["black_point"],
        gamma=params["gamma"],
        white_point=params["white_point"],
        vibrance=vibrance,
        temperature=temperature,
        output_path=output_path,
    )

    if error:
        return {"success": False, "error": error}

    return {
        "success": True,
        "output_path": str(output_path),
        **params,
    }
