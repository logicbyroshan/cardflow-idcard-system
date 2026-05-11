"""
passport_engine_core/adjustments.py
-----------------------------------
Image adjustment helpers used by Adarsh Engine edit/save endpoints.
"""

from __future__ import annotations

from pathlib import Path
from typing import Tuple
import math

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


def compute_auto_levels(image_path: str) -> dict:
    """
    Compute auto levels parameters from an image on disk.

    Returns:
        {"black_point": int, "white_point": int, "gamma": float}
    """
    source = Path(image_path)
    if not source.exists() or not source.is_file():
        raise ValueError(f"Image not found: {image_path}")

    img = Image.open(source).convert("RGB")
    w, h = img.size

    max_dim = max(w, h)
    if max_dim > 8000:
        scale = 8000.0 / float(max_dim)
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        img = img.resize((new_w, new_h), Image.LANCZOS)

    arr = np.asarray(img, dtype=np.uint16)
    if arr.size == 0:
        return {"black_point": 0, "white_point": 255, "gamma": 1.0}

    lum = (arr[..., 0] * 299 + arr[..., 1] * 587 + arr[..., 2] * 114 + 500) // 1000
    lum = lum.astype(np.uint16)

    hist = np.bincount(lum.reshape(-1), minlength=256)
    total = int(lum.size)
    lum_sum = int(lum.sum())

    if total < 1:
        return {"black_point": 0, "white_point": 255, "gamma": 1.0}

    clip_percent = 0.01
    clip_low = int(total * clip_percent)
    clip_high = int(total * (1 - clip_percent))

    cumulative = 0
    black_point = 0
    for i in range(256):
        cumulative += int(hist[i])
        if cumulative >= clip_low:
            black_point = i
            break

    cumulative = 0
    white_point = 255
    for i in range(256):
        cumulative += int(hist[i])
        if cumulative >= clip_high:
            white_point = i
            break

    if (white_point - black_point) < 30:
        mid = int((black_point + white_point) / 2)
        black_point = max(0, mid - 15)
        white_point = min(255, mid + 15)

    if black_point > 60:
        black_point = 60
    if white_point < 200:
        white_point = 200

    avg_lum = lum_sum / float(total)
    range_val = white_point - black_point
    if range_val < 1:
        range_val = 1

    norm_avg = (avg_lum - black_point) / float(range_val)
    if norm_avg < 0.02:
        norm_avg = 0.02
    if norm_avg > 0.98:
        norm_avg = 0.98

    raw_gamma = -math.log(2) / math.log(norm_avg)
    if not math.isfinite(raw_gamma):
        raw_gamma = 1.0

    gamma = raw_gamma * 0.5 + 0.5
    if gamma < 0.5:
        gamma = 0.5
    if gamma > 2.0:
        gamma = 2.0

    gamma = round(gamma, 2)

    return {
        "black_point": int(black_point),
        "white_point": int(white_point),
        "gamma": gamma,
    }
