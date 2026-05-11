"""
passport_engine_core/compressor.py
─────────────────────────────────
Image compression helpers for Adarsh Engine.
"""

from __future__ import annotations

import logging
import os
import io
import time
from pathlib import Path
from typing import Dict, Any, List

from PIL import Image
from . import config

logger = logging.getLogger(__name__)

def compress_folder(folder_path: str, target_kb: float) -> Dict[str, Any]:
    """
    Compress all images in a folder to be <= target_kb.
    
    This function performs a binary search for the best JPEG quality 
    level (5-95) for each image to maximize quality while staying 
    under the size limit.
    
    Args:
        folder_path: Absolute path to the folder containing images.
        target_kb: Target maximum file size in Kilobytes.
        
    Returns:
        Summary dict with counts and error list.
    """
    start_time = time.perf_counter()
    folder = Path(folder_path).resolve()
    
    if not folder.is_dir():
        raise ValueError(f"Target folder not found: {folder_path}")

    # Collect valid images
    images = [
        f for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in config.ALLOWED_IMAGE_EXTENSIONS
    ]

    total = len(images)
    success = 0
    failed = 0
    errors = []

    logger.info("Starting folder compression: %d images, target %s KB", total, target_kb)

    for img_path in images:
        try:
            res = _compress_single_image(img_path, target_kb)
            if res:
                success += 1
            else:
                failed += 1
                errors.append(f"{img_path.name}: Target size unreachable even at minimum quality.")
        except Exception as exc:
            failed += 1
            errors.append(f"{img_path.name}: {str(exc)}")
            logger.error("Compression error for %s: %s", img_path.name, exc)

    elapsed = round(time.perf_counter() - start_time, 2)
    logger.info("Compression complete: %d ok, %d failed in %.2fs", success, failed, elapsed)

    return {
        "total": total,
        "success": success,
        "failed": failed,
        "errors": errors,
        "processing_time": elapsed,
    }


def _compress_single_image(path: Path, target_kb: float) -> bool:
    """
    Find best JPEG quality to fit target_kb using binary search.
    Saves the result in-place if successful.
    """
    target_bytes = target_kb * 1024
    
    # Load original
    with Image.open(path) as img:
        # Convert to RGB (JPEG requirement)
        if img.mode != "RGB":
            img = img.convert("RGB")
            
        # Binary search for quality [5, 95]
        low = 5
        high = 95
        best_quality = None
        
        while low <= high:
            mid = (low + high) // 2
            
            # Test mid quality in memory
            buf = io.BytesIO()
            img.save(
                buf, 
                format="JPEG", 
                quality=mid, 
                optimize=True, 
                progressive=True
            )
            size = buf.tell()
            
            if size <= target_bytes:
                best_quality = mid
                low = mid + 1  # Try higher quality
            else:
                high = mid - 1 # Too big, try lower quality
                
        if best_quality is not None:
            # Save final result to disk
            img.save(
                path, 
                format="JPEG", 
                quality=best_quality, 
                optimize=True, 
                progressive=True
            )
            return True
            
    return False
