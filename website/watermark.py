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
import math
import os
import random
import subprocess
import tempfile

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
    Tile the entire image with diagonal 'adarsh id card' watermarks.

    Pattern design:
    - Font size ≈ 3 % of image width (min 16 px, max 60 px)
    - Text variants alternate across the tile grid
    - White text (alpha ≈ 80) + dark shadow (alpha ≈ 55) for visibility on
      both light and dark backgrounds
    - The tile layer is rotated 28° before compositing so rows run diagonally
    - Every other tile row is offset by half a step for a staggered look

    Returns the watermarked image as a ContentFile with the original filename.
    Falls back to the original file_obj on any error.
    """
    _math = math

    if not file_obj:
        return file_obj

    try:
        file_obj.seek(0)
        img = Image.open(file_obj)
        orig_fmt  = img.format or 'JPEG'
        orig_name = getattr(file_obj, 'name', 'image.jpg')

        img = img.convert('RGBA')
        w, h = img.size

        # Font proportional to image width
        font_size = max(16, min(60, int(w * 0.030)))
        font = _load_font(font_size)

        # Measure one text cell for spacing
        _probe = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
        _ref_bbox = _probe.textbbox((0, 0), 'adarsh id cards', font=font)
        cell_w = (_ref_bbox[2] - _ref_bbox[0]) + int(font_size * 2.0)   # horizontal gap
        cell_h = font_size + int(font_size * 1.4)                        # vertical gap

        # Large canvas — must cover the full image after a 28° rotation
        # diagonal of the image + generous padding
        diag = int(_math.sqrt(w * w + h * h))
        pad  = diag // 2
        canvas_sz = diag + pad * 2          # square canvas

        tile = Image.new('RGBA', (canvas_sz, canvas_sz), (0, 0, 0, 0))
        td   = ImageDraw.Draw(tile)

        row_i = 0
        y = 0
        while y < canvas_sz + cell_h:
            x_offset = (row_i % 2) * (cell_w // 2)   # stagger alternate rows
            col_i = 0
            x = -cell_w + x_offset
            while x < canvas_sz + cell_w:
                text = _WATERMARK_TEXTS[(row_i + col_i) % len(_WATERMARK_TEXTS)]
                # Shadow
                for ox, oy in ((-1, -1), (-1, 1), (1, -1), (1, 1), (0, 2), (2, 0)):
                    td.text((x + ox, y + oy), text, font=font, fill=(0, 0, 0, 55))
                # Main text
                td.text((x, y), text, font=font, fill=(255, 255, 255, 80))
                x += cell_w
                col_i += 1
            y += cell_h
            row_i += 1

        # Rotate the tile layer 28° (PIL rotates counter-clockwise; negative = clockwise)
        tile_rot = tile.rotate(-28, resample=Image.BICUBIC, expand=False)

        # Crop the centre (w × h) from the rotated tile
        cx = (tile_rot.width  - w) // 2
        cy = (tile_rot.height - h) // 2
        overlay = tile_rot.crop((cx, cy, cx + w, cy + h))

        # Safety: ensure overlay matches image size exactly
        if overlay.size != (w, h):
            overlay = overlay.resize((w, h), Image.LANCZOS)

        result = Image.alpha_composite(img, overlay)
        return _save_image(result, orig_fmt, orig_name)

    except (OSError, ValueError, TypeError) as exc:
        logger.warning("apply_text_watermark failed", exc_info=True)
        try:
            file_obj.seek(0)
        except (OSError, AttributeError):
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

    except (OSError, ValueError, TypeError) as exc:
        logger.warning("apply_logo_watermark failed", exc_info=True)
        try:
            file_obj.seek(0)
        except (OSError, AttributeError):
            pass
        return file_obj


# ── Image compression pipeline ───────────────────────────────────────────────

def process_portfolio_image(file_obj, max_kb: int = 200) -> ContentFile:
    """
    Full processing pipeline for portfolio images:
      1. Apply text watermark (brand protection — full diagonal tile)
      2. Convert to WebP (better compression, modern format)
      3. Progressively reduce quality until file size <= max_kb KB

    Falls back to the watermarked JPEG/PNG if WebP conversion fails.
    Never raises — always returns a usable file object.
    """
    if not file_obj:
        return file_obj

    try:
        # Step 1: watermark
        watermarked = apply_text_watermark(file_obj)

        # Step 2: open watermarked image
        if hasattr(watermarked, 'seek'):
            watermarked.seek(0)
        img = Image.open(watermarked)

        # WebP supports both RGBA and RGB
        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGBA' if 'A' in img.getbands() else 'RGB')

        orig_name = (
            getattr(watermarked, 'name', None)
            or getattr(file_obj, 'name', 'image.webp')
        )
        base_name = orig_name.rsplit('.', 1)[0] if '.' in orig_name else orig_name
        webp_name = base_name + '.webp'
        max_bytes = max_kb * 1024

        # Step 3: compress — reduce quality until <= max_kb
        for quality in range(85, 15, -5):
            buf = io.BytesIO()
            img.save(buf, format='WEBP', quality=quality, method=4)
            if buf.tell() <= max_bytes:
                buf.seek(0)
                return ContentFile(buf.read(), name=webp_name)

        # Still too large → resize to 70 % and retry lower qualities
        w, h = img.size
        img_sm = img.resize((max(1, int(w * 0.70)), max(1, int(h * 0.70))), Image.LANCZOS)
        for quality in (60, 40, 20):
            buf = io.BytesIO()
            img_sm.save(buf, format='WEBP', quality=quality, method=4)
            if buf.tell() <= max_bytes:
                buf.seek(0)
                return ContentFile(buf.read(), name=webp_name)

        # Absolute last resort: return whatever quality=20 gives
        buf.seek(0)
        return ContentFile(buf.read(), name=webp_name)

    except (OSError, ValueError, TypeError) as exc:
        logger.warning("process_portfolio_image failed", exc_info=True)
        try:
            file_obj.seek(0)
        except (OSError, AttributeError):
            pass
        return file_obj


# ── Video compression pipeline ───────────────────────────────────────────────

def compress_video_file(file_obj, max_bytes: int = 10 * 1024 * 1024):
    """
    Compress a video file to at most *max_bytes* using ffmpeg.

    Strategy:
    - Calculate target bitrate based on video duration and max_bytes
    - Re-encode with H.264 + AAC, capping resolution at 1280×720
    - Returns a ContentFile (.mp4) on success
    - Falls back to the original file_obj silently if ffmpeg is not available
      or if the original is already within the size limit

    Requires: ffmpeg must be installed and on PATH.
    """
    if not file_obj:
        return file_obj

    orig_name = getattr(file_obj, 'name', 'video.mp4')
    ext = orig_name.rsplit('.', 1)[-1].lower() if '.' in orig_name else 'mp4'

    # Read original bytes
    try:
        file_obj.seek(0)
        original_bytes = file_obj.read()
    except (OSError, AttributeError):
        return file_obj

    # Already within limit → skip compression
    if len(original_bytes) <= max_bytes:
        try:
            file_obj.seek(0)
        except (OSError, AttributeError):
            pass
        return file_obj

    # Check ffmpeg availability
    try:
        subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True, timeout=10, check=True,
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        logger.info("compress_video_file: ffmpeg not available — skipping compression")
        try:
            file_obj.seek(0)
        except (OSError, AttributeError):
            pass
        return file_obj

    tmp_in = tmp_out = None
    try:
        # Write to temp input file
        with tempfile.NamedTemporaryFile(suffix=f'.{ext}', delete=False) as f:
            f.write(original_bytes)
            tmp_in = f.name

        tmp_out = tmp_in + '_compressed.mp4'

        # Probe duration for bitrate calculation
        probe = subprocess.run(
            [
                'ffprobe', '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                tmp_in,
            ],
            capture_output=True, text=True, timeout=30,
        )
        try:
            duration = float(probe.stdout.strip())
        except (ValueError, AttributeError):
            duration = 60.0  # conservative default

        # target bitrate = max_bytes * 8 bits / duration, minus 64kbps for audio
        target_video_kbps = max(200, int((max_bytes * 8 / max(duration, 1)) / 1000) - 64)

        result = subprocess.run(
            [
                'ffmpeg', '-y', '-i', tmp_in,
                '-c:v', 'libx264',
                '-b:v', f'{target_video_kbps}k',
                '-maxrate', f'{int(target_video_kbps * 1.5)}k',
                '-bufsize', f'{int(target_video_kbps * 2)}k',
                '-vf', (
                    'scale='
                    "if(gt(iw\\,1280)\\,1280\\,-2)"
                    ':if(gt(ih\\,720)\\,720\\,-2)'
                ),
                '-c:a', 'aac', '-b:a', '64k',
                '-preset', 'fast',
                '-movflags', '+faststart',
                tmp_out,
            ],
            capture_output=True,
            timeout=600,
        )

        if result.returncode == 0 and os.path.exists(tmp_out):
            with open(tmp_out, 'rb') as f:
                compressed_bytes = f.read()
            # Only use compressed if it is genuinely smaller
            if len(compressed_bytes) < len(original_bytes):
                base_name = orig_name.rsplit('.', 1)[0] if '.' in orig_name else orig_name
                return ContentFile(compressed_bytes, name=base_name + '.mp4')
        else:
            logger.warning(
                "compress_video_file: ffmpeg returned %s\nstderr: %s",
                result.returncode,
                result.stderr[-500:] if result.stderr else '',
            )

    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        logger.warning("compress_video_file failed", exc_info=True)
    finally:
        for p in (tmp_in, tmp_out):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass

    # Fallback: return original
    try:
        file_obj.seek(0)
    except (OSError, AttributeError):
        pass
    return file_obj
