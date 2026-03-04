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


# ── Image compression pipeline ───────────────────────────────────────────────

def process_portfolio_image(file_obj, max_kb: int = 500) -> ContentFile:
    """
    Full processing pipeline for portfolio images:
      1. Apply text watermark (brand protection)
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

    except Exception:
        logger.warning("process_portfolio_image failed", exc_info=True)
        try:
            file_obj.seek(0)
        except Exception:
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

    import os
    import subprocess
    import tempfile

    orig_name = getattr(file_obj, 'name', 'video.mp4')
    ext = orig_name.rsplit('.', 1)[-1].lower() if '.' in orig_name else 'mp4'

    # Read original bytes
    try:
        file_obj.seek(0)
        original_bytes = file_obj.read()
    except Exception:
        return file_obj

    # Already within limit → skip compression
    if len(original_bytes) <= max_bytes:
        try:
            file_obj.seek(0)
        except Exception:
            pass
        return file_obj

    # Check ffmpeg availability
    try:
        subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True, timeout=10, check=True,
        )
    except Exception:
        logger.info("compress_video_file: ffmpeg not available — skipping compression")
        try:
            file_obj.seek(0)
        except Exception:
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

    except Exception:
        logger.warning("compress_video_file failed", exc_info=True)
    finally:
        for p in (tmp_in, tmp_out):
            if p:
                try:
                    os.unlink(p)
                except Exception:
                    pass

    # Fallback: return original
    try:
        file_obj.seek(0)
    except Exception:
        pass
    return file_obj
