"""
Website Watermark Service
=========================
Applies watermarks to uploaded images before they are saved.

  • Portfolio images  → 2 semi-transparent text watermarks (random position, slight angle)
  • Reel thumbnails   → Brand logo watermark centred on the image, ~55 % opacity

Both functions accept any Django-uploaded file object and return a
``django.core.files.base.ContentFile`` so the result can be assigned
directly to a model's ImageField.  If anything goes wrong the original
file is returned unchanged (never raises).
"""

import io
import logging
import os
import random

from django.conf import settings
from django.core.files.base import ContentFile
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# ── Asset paths ─────────────────────────────────────────────────────────────
BASE_DIR       = settings.BASE_DIR
_FONT_BOLD     = os.path.join(BASE_DIR, 'static', 'fonts', 'saira-semi-condensed-700.ttf')
_FONT_SEMIBOLD = os.path.join(BASE_DIR, 'static', 'fonts', 'saira-semi-condensed-600.ttf')
_FONT_ARIAL_BD = os.path.join(BASE_DIR, 'static', 'fonts', 'arialbd.ttf')
_LOGO_PATH     = os.path.join(BASE_DIR, 'static', 'assets', 'logo.png')

# ── Text variants used as portfolio watermarks ───────────────────────────────
_WATERMARK_TEXTS = [
    "adarsh id cards",
    "adarsh id card",
    "adarsh idcard",
    "Adarsh ID Cards",
    "Adarsh ID Card",
    "ADARSH ID CARDS",
]


# ── Internal helpers ─────────────────────────────────────────────────────────

def _load_font(size: int) -> ImageFont.FreeTypeFont:
    """Load the best available font at *size* pt, falling back gracefully."""
    for path in (_FONT_BOLD, _FONT_SEMIBOLD, _FONT_ARIAL_BD):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except (IOError, OSError):
                continue
    # Last-resort default (tiny bitmap font, but never crashes)
    return ImageFont.load_default()


def _save_image(img: Image.Image, fmt: str, orig_name: str) -> ContentFile:
    """Save a PIL image to a ContentFile preserving format."""
    fmt = fmt.upper()
    if fmt in ('JPG', 'JPEG'):
        save_fmt = 'JPEG'
        save_kwargs = {'quality': 92, 'optimize': True}
    elif fmt == 'PNG':
        save_fmt = 'PNG'
        save_kwargs = {'optimize': True}
    elif fmt == 'WEBP':
        save_fmt = 'WEBP'
        save_kwargs = {'quality': 92}
    else:
        # Anything else → save as JPEG
        save_fmt = 'JPEG'
        save_kwargs = {'quality': 92, 'optimize': True}

    if save_fmt == 'JPEG' and img.mode == 'RGBA':
        img = img.convert('RGB')

    buf = io.BytesIO()
    img.save(buf, format=save_fmt, **save_kwargs)
    buf.seek(0)
    return ContentFile(buf.read(), name=orig_name)


# ── Public API ────────────────────────────────────────────────────────────────

def apply_text_watermark(file_obj):
    """
    Stamp two semi-transparent text watermarks onto a portfolio image.

    Watermark design:
    - Two different brand-name variants (randomly chosen from _WATERMARK_TEXTS)
    - Randomly placed, avoiding a 10 % margin from each edge
    - Rotated ~15–22 degrees for a natural diagonal look
    - White text at alpha ≈ 95/255  +  dark shadow at alpha ≈ 70/255
      (readable on both light and dark backgrounds)
    - Font size ≈ 2.5 % of image width (min 13 px, max 55 px)

    Returns the watermarked image as a ContentFile with the original filename.
    Falls back to the original file_obj on any error.
    """
    if not file_obj:
        return file_obj

    try:
        file_obj.seek(0)
        img = Image.open(file_obj)
        orig_fmt  = img.format or 'JPEG'
        orig_name = getattr(file_obj, 'name', 'image.jpg')

        # Work in RGBA for alpha compositing
        img = img.convert('RGBA')
        w, h = img.size

        # Font size proportional to image width
        font_size = max(13, min(55, int(w * 0.025)))
        font = _load_font(font_size)

        # Pick 2 unique text variants
        texts = random.sample(_WATERMARK_TEXTS, min(2, len(_WATERMARK_TEXTS)))

        # Full-image transparent overlay
        overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
        draw_probe = ImageDraw.Draw(overlay)   # just to measure text bbox

        for text in texts:
            bbox = draw_probe.textbbox((0, 0), text, font=font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]

            # Margins: at least 10 % of each dimension from the edges
            margin_x = max(8, int(w * 0.10))
            margin_y = max(8, int(h * 0.10))

            # Safe placement range
            x_max = max(margin_x + 1, w - text_w - margin_x)
            y_max = max(margin_y + 1, h - text_h - margin_y)
            x = random.randint(margin_x, x_max)
            y = random.randint(margin_y, y_max)

            # Random slight angle (clockwise, 10–22°)
            angle = random.choice([12, 15, 17, 19, 22])

            # --- Build a small canvas for this single text stamp ---
            pad = max(20, font_size)
            stamp_w = text_w + pad * 4
            stamp_h = text_h + pad * 4
            stamp = Image.new('RGBA', (stamp_w, stamp_h), (0, 0, 0, 0))
            sd = ImageDraw.Draw(stamp)

            tx, ty = pad * 2, pad * 2

            # Dark shadow offsets (improve contrast on bright backgrounds)
            for ox, oy in [(-1, -1), (-1, 1), (1, -1), (1, 1), (0, 2), (2, 0)]:
                sd.text((tx + ox, ty + oy), text, font=font, fill=(0, 0, 0, 70))

            # Main white text
            sd.text((tx, ty), text, font=font, fill=(255, 255, 255, 95))

            # Rotate the stamp
            stamp_r = stamp.rotate(angle, resample=Image.BICUBIC, expand=True)

            # Paste into overlay: offset so the visual centre stays near (x, y)
            cx = x + text_w // 2 - stamp_r.width // 2
            cy = y + text_h // 2 - stamp_r.height // 2
            cx = max(0, min(cx, w - stamp_r.width))
            cy = max(0, min(cy, h - stamp_r.height))
            overlay.paste(stamp_r, (cx, cy), stamp_r)

        # Composite watermark onto original
        result = Image.alpha_composite(img, overlay)
        return _save_image(result, orig_fmt, orig_name)

    except Exception:
        logger.warning("apply_text_watermark failed", exc_info=True)
        try:
            file_obj.seek(0)
        except Exception:
            pass
        return file_obj


def apply_logo_watermark(file_obj):
    """
    Stamp the Adarsh ID Cards logo in the centre of a reel thumbnail.

    Watermark design:
    - Logo loaded from static/assets/logo.png
    - Resized to ~28 % of the shorter image dimension (maintains aspect ratio)
    - Centred exactly on the image
    - Opacity reduced to ~55 % (visible brand presence, not obstructive)

    Returns the watermarked image as a ContentFile with the original filename.
    Falls back to the original file_obj if no logo is found or any error occurs.
    """
    if not file_obj:
        return file_obj

    if not os.path.exists(_LOGO_PATH):
        logger.warning("apply_logo_watermark: logo not found at %s", _LOGO_PATH)
        return file_obj

    try:
        file_obj.seek(0)
        img = Image.open(file_obj)
        orig_fmt  = img.format or 'JPEG'
        orig_name = getattr(file_obj, 'name', 'thumbnail.jpg')

        img = img.convert('RGBA')
        w, h = img.size

        # Load logo
        logo = Image.open(_LOGO_PATH).convert('RGBA')

        # Resize: target ~28 % of the shorter dimension, keep aspect ratio
        target_px   = int(min(w, h) * 0.28)
        logo_ratio  = logo.width / logo.height
        logo_h_px   = target_px
        logo_w_px   = int(target_px * logo_ratio)
        if logo_w_px > int(w * 0.80):           # Safety cap: don't exceed 80 % of image width
            logo_w_px = int(w * 0.80)
            logo_h_px = int(logo_w_px / logo_ratio)
        logo = logo.resize((logo_w_px, logo_h_px), Image.LANCZOS)

        # Apply 55 % opacity to logo alpha channel
        lr, lg, lb, la = logo.split()
        la = la.point(lambda p: int(p * 0.55))
        logo = Image.merge('RGBA', (lr, lg, lb, la))

        # Centre position
        cx = (w - logo_w_px) // 2
        cy = (h - logo_h_px) // 2

        # Paste onto transparent overlay, then composite
        overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
        overlay.paste(logo, (cx, cy), logo)
        result = Image.alpha_composite(img, overlay)

        return _save_image(result, orig_fmt, orig_name)

    except Exception:
        logger.warning("apply_logo_watermark failed", exc_info=True)
        try:
            file_obj.seek(0)
        except Exception:
            pass
        return file_obj
