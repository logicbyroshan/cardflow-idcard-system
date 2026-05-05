"""
Editor/adjustments service.
"""

from __future__ import annotations

from typing import Dict

from ..adjustments import apply_adjustments
from .common import ensure_image_file, ensure_image_output_path


def adjust_image(
    image_path: str,
    output_path: str,
    black_point: int = 0,
    gamma: float = 1.0,
    white_point: int = 255,
    vibrance: int = 0,
    temperature: int = 0,
) -> Dict[str, str | bool]:
    ensure_image_file(image_path)
    ensure_image_output_path(output_path)

    _image, error = apply_adjustments(
        image_path=image_path,
        black_point=black_point,
        gamma=gamma,
        white_point=white_point,
        vibrance=vibrance,
        temperature=temperature,
        output_path=output_path,
    )

    if error:
        return {"success": False, "error": error}

    return {
        "success": True,
        "output_path": str(output_path),
        "message": "Image adjusted and saved successfully",
    }
