"""
passport_engine_core/adjustments.py
-----------------------------------
Image adjustment helpers used by Adarsh Engine edit/save endpoints.
"""

from __future__ import annotations

from pathlib import Path
from typing import Tuple

import numpy as np
from PIL import Image, ImageEnhance


def _clamp_int(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def _levels_transform(
    rgb: np.ndarray,
    black_point: int,
    gamma: float,
    white_point: int,
) -> np.ndarray:
    black = _clamp_int(black_point, 0, 254)
    white = _clamp_int(white_point, 1, 255)
    if white <= black:
        white = min(255, black + 1)

    g = float(gamma) if gamma else 1.0
    if g <= 0:
        g = 1.0

    normalized = (rgb.astype(np.float32) - float(black)) / float(white - black)
    normalized = np.clip(normalized, 0.0, 1.0)

    # Gamma curve (inverse style) keeps UI semantics intuitive:
    # higher gamma brightens midtones less aggressively.
    corrected = np.power(normalized, 1.0 / g)
    return np.clip(corrected * 255.0, 0.0, 255.0).astype(np.uint8)


def _temperature_shift(rgb: np.ndarray, temperature: int) -> np.ndarray:
    temp = _clamp_int(temperature, -100, 100)
    if temp == 0:
        return rgb

    scale = temp / 100.0
    out = rgb.astype(np.float32)
    out[..., 0] += scale * 28.0   # red channel
    out[..., 2] -= scale * 28.0   # blue channel
    return np.clip(out, 0.0, 255.0).astype(np.uint8)


def _apply_vibrance(image: Image.Image, vibrance: int) -> Image.Image:
    vib = _clamp_int(vibrance, -100, 100)
    if vib == 0:
        return image

    # Pillow color enhancement is a practical proxy for vibrance controls.
    factor = 1.0 + (vib / 100.0)
    factor = max(0.0, factor)
    return ImageEnhance.Color(image).enhance(factor)


def apply_adjustments(
    image_path: str,
    black_point: int = 0,
    gamma: float = 1.0,
    white_point: int = 255,
    vibrance: int = 0,
    temperature: int = 0,
    output_path: str | None = None,
) -> Tuple[Image.Image | None, str | None]:
    """
    Apply levels/vibrance/temperature and optionally save to disk.

    Returns:
        (result_image, error_message)
    """
    try:
        source = Path(image_path)
        if not source.exists() or not source.is_file():
            return None, f"Image not found: {image_path}"

        img = Image.open(source).convert("RGB")
        arr = np.array(img)

        arr = _levels_transform(arr, black_point, gamma, white_point)
        arr = _temperature_shift(arr, temperature)

        out_img = Image.fromarray(arr)
        out_img = _apply_vibrance(out_img, vibrance)

        if output_path:
            out_file = Path(output_path)
            out_file.parent.mkdir(parents=True, exist_ok=True)

            ext = out_file.suffix.lower()
            save_kwargs = {}
            if ext in {".jpg", ".jpeg"}:
                save_kwargs = {"quality": 95, "optimize": True}
            elif ext == ".png":
                save_kwargs = {"optimize": True}

            out_img.save(out_file, **save_kwargs)

        return out_img, None

    except Exception as exc:
        return None, str(exc)
