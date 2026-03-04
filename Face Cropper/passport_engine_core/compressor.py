"""
compressor.py
─────────────
Image compression module for the Adarsh Engine.

Compresses images in a folder to a target file-size (in KB) while
maintaining visual quality as high as possible.

Strategy:
    1. Open the image with Pillow.
    2. Binary-search the JPEG quality parameter (1–95) to find the
       highest quality that stays at or below the target size.
    3. Save progressive JPEG with optimized Huffman tables.
    4. If the original file is already ≤ target KB, copy it unchanged.

Output:
    Creates a ``compressed/`` sub-directory inside the source folder for
    successes and a ``compressed_failed/`` sub-directory for failures.
"""

import logging
import os
import shutil
import time
from io import BytesIO
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image

logger = logging.getLogger(__name__)

# Supported image extensions
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}

# Quality range for binary search
_MIN_QUALITY = 5
_MAX_QUALITY = 95

# Maximum concurrent workers
_MAX_WORKERS = 4


def compress_folder(folder_path: str, target_kb: float) -> dict:
    """
    Compress every image in *folder_path* to ≤ *target_kb* kilobytes.

    Returns a summary dict matching the process-folder response shape::

        {
            "total": int,
            "success": int,
            "failed": int,
            "processing_time": float,
            "output_folder": str,
            "failed_folder": str,
            "errors": [str],
        }
    """
    t0 = time.perf_counter()
    src = Path(folder_path)

    if not src.is_dir():
        raise ValueError(f"Source folder does not exist: {folder_path}")

    if target_kb <= 0:
        raise ValueError("target_kb must be > 0")

    # Collect image files
    images = sorted(
        f for f in src.iterdir()
        if f.is_file() and f.suffix.lower() in _IMAGE_EXTS
    )

    if not images:
        raise ValueError(f"No images found in: {folder_path}")

    # Output directories — inside the source folder
    out_dir  = src / "compressed"
    fail_dir = src / "compressed_failed"
    out_dir.mkdir(parents=True, exist_ok=True)
    fail_dir.mkdir(parents=True, exist_ok=True)

    target_bytes = int(target_kb * 1024)

    success = 0
    failed = 0
    errors: list[str] = []

    def _process_one(img_path: Path) -> tuple[bool, str]:
        """Compress a single image. Returns (ok, error_message)."""
        try:
            result = _compress_image(img_path, target_bytes, out_dir)
            if result:
                return True, ""
            else:
                # Compression couldn't meet target — move to failed
                shutil.copy2(str(img_path), str(fail_dir / img_path.name))
                return False, f"{img_path.name}: could not reach target {target_kb} KB"
        except Exception as exc:
            try:
                shutil.copy2(str(img_path), str(fail_dir / img_path.name))
            except Exception:
                pass
            return False, f"{img_path.name}: {exc}"

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = {pool.submit(_process_one, img): img for img in images}
        for future in as_completed(futures):
            ok, err = future.result()
            if ok:
                success += 1
            else:
                failed += 1
                if err:
                    errors.append(err)

    elapsed = round(time.perf_counter() - t0, 2)

    logger.info(
        "Compression done: %d/%d success in %.1fs  (target=%d KB, folder=%s)",
        success, len(images), elapsed, target_kb, folder_path,
    )

    return {
        "total": len(images),
        "success": success,
        "failed": failed,
        "processing_time": elapsed,
        "output_folder": str(out_dir),
        "failed_folder": str(fail_dir),
        "errors": errors,
    }


def _compress_image(
    img_path: Path,
    target_bytes: int,
    out_dir: Path,
) -> bool:
    """
    Compress a single image to ≤ *target_bytes*.

    - If the original file is already small enough, copy it as-is.
    - Otherwise do a binary search on JPEG quality.

    Returns True on success, False if the minimum quality still exceeds target.
    """
    # Check if already under target
    original_size = img_path.stat().st_size
    if original_size <= target_bytes:
        shutil.copy2(str(img_path), str(out_dir / img_path.name))
        return True

    # Open and convert to RGB (handles PNG with alpha, etc.)
    with Image.open(img_path) as im:
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGB")
        elif im.mode != "RGB":
            im = im.convert("RGB")

        # Preserve EXIF if available
        exif_data = None
        try:
            exif_data = im.info.get("exif")
        except Exception:
            pass

        # Binary search for the best quality
        lo = _MIN_QUALITY
        hi = _MAX_QUALITY
        best_quality = None
        best_buf = None

        while lo <= hi:
            mid = (lo + hi) // 2
            buf = _encode_jpeg(im, mid, exif_data)
            size = len(buf)

            if size <= target_bytes:
                # This quality works — try higher quality
                best_quality = mid
                best_buf = buf
                lo = mid + 1
            else:
                # Too big — try lower quality
                hi = mid - 1

        if best_buf is None:
            # Even minimum quality exceeds target — save at min quality anyway
            # and let the caller decide (mark as failed if still over target)
            best_buf = _encode_jpeg(im, _MIN_QUALITY, exif_data)
            if len(best_buf) > target_bytes:
                # Try resizing down progressively
                best_buf = _compress_with_resize(im, target_bytes, exif_data)
                if best_buf is None:
                    return False

        # Write output
        out_path = out_dir / (img_path.stem + ".jpg")
        out_path.write_bytes(best_buf)
        return True


def _encode_jpeg(im: Image.Image, quality: int, exif: bytes | None) -> bytes:
    """Encode *im* as a progressive JPEG at the given *quality* and return bytes."""
    buf = BytesIO()
    save_kwargs = {
        "format": "JPEG",
        "quality": quality,
        "optimize": True,
        "progressive": True,
    }
    if exif:
        save_kwargs["exif"] = exif
    im.save(buf, **save_kwargs)
    return buf.getvalue()


def _compress_with_resize(
    im: Image.Image,
    target_bytes: int,
    exif: bytes | None,
) -> bytes | None:
    """
    Last-resort: progressively shrink the image dimensions until
    it fits in *target_bytes* at minimum JPEG quality.

    Returns the JPEG bytes or None if even 25% dimensions can't fit.
    """
    w, h = im.size
    for scale in (0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25):
        new_w = max(int(w * scale), 1)
        new_h = max(int(h * scale), 1)
        resized = im.resize((new_w, new_h), Image.LANCZOS)
        buf = _encode_jpeg(resized, _MIN_QUALITY, exif)
        if len(buf) <= target_bytes:
            # Found a size that fits — now binary-search for best quality at this dimension
            lo = _MIN_QUALITY
            hi = _MAX_QUALITY
            best_buf = buf
            while lo <= hi:
                mid = (lo + hi) // 2
                trial = _encode_jpeg(resized, mid, exif)
                if len(trial) <= target_bytes:
                    best_buf = trial
                    lo = mid + 1
                else:
                    hi = mid - 1
            return best_buf
    return None
