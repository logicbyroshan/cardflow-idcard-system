"""
passport_engine_core/engine.py
──────────────────────────────
Standalone entry point for the passport crop engine.

Provides two public functions:

    process_zip(zip_path)      — process images from a ZIP archive
    process_folder(folder_path) — process images from a directory

Both return the same standardised summary dict.

Usage::

    from passport_engine_core.engine import process_zip, process_folder

    result = process_zip("path/to/images.zip")
    result = process_folder("path/to/photos")

Or from the command line::

    python -m passport_engine_core path/to/images.zip
"""

import logging
import sys
import os
from pathlib import Path
from typing import Dict, Any, List

# ---------------------------------------------------------------------------
# Allow this file to be executed directly (python engine.py sample.zip)
# ---------------------------------------------------------------------------
if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "passport_engine_core"

from . import config
from .extractor import ZipExtractor
from .processor import ImageProcessor

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _collect_image_paths(folder: Path) -> List[str]:
    """
    Return sorted list of absolute paths to image files inside *folder*.

    Only files whose extension is in ``config.ALLOWED_IMAGE_EXTENSIONS``
    are included.  Hidden files (starting with ``.`` or ``__``) are
    skipped.
    """
    paths: List[str] = []
    for entry in folder.iterdir():
        if not entry.is_file():
            continue
        if entry.name.startswith(".") or entry.name.startswith("__"):
            continue
        if entry.suffix.lower() in config.ALLOWED_IMAGE_EXTENSIONS:
            paths.append(str(entry))
    paths.sort()
    return paths


def _build_output_dirs(
    base_dir: Path, stem: str
) -> tuple:
    """
    Create ``<stem>_cropped`` and ``<stem>_failed`` directories next to
    *base_dir* and return them as ``(cropped_dir, failed_dir)``.
    """
    cropped_dir = base_dir / f"{stem}_cropped"
    failed_dir  = base_dir / f"{stem}_failed"
    cropped_dir.mkdir(parents=True, exist_ok=True)
    failed_dir.mkdir(parents=True, exist_ok=True)
    return cropped_dir, failed_dir


def _make_summary(
    result, cropped_dir: Path, failed_dir: Path
) -> Dict[str, Any]:
    """Build the standardised response dict from a ProcessingResult."""
    # Collect successfully cropped filenames for preview.
    cropped_files: List[str] = []
    if cropped_dir.is_dir():
        cropped_files = sorted(
            f.name for f in cropped_dir.iterdir()
            if f.is_file() and f.suffix.lower() in config.ALLOWED_IMAGE_EXTENSIONS
        )

    return {
        "total":            result.total,
        "success":          result.successful,
        "failed":           result.failed,
        "accuracy":         result.accuracy,
        "output_folder":    str(cropped_dir),
        "failed_folder":    str(failed_dir),
        "processing_time":  result.elapsed,
        "errors":           list(result.errors) if result.errors else [],
        "cropped_files":    cropped_files,
    }


def _empty_summary(cropped_dir: Path, failed_dir: Path) -> Dict[str, Any]:
    """Summary dict when zero images were found."""
    return {
        "total":           0,
        "success":         0,
        "failed":          0,
        "accuracy":        0.0,
        "output_folder":   str(cropped_dir),
        "failed_folder":   str(failed_dir),
        "processing_time": 0.0,
    }


# ──────────────────────────────────────────────────────────────────────────
# Public API — ZIP
# ──────────────────────────────────────────────────────────────────────────

def process_zip(
    zip_path: str,
    original_path: str | None = None,
    output_folder: str | None = None,
) -> Dict[str, Any]:
    """
    Process a ZIP file of portrait images through the passport crop
    pipeline.

    Output folders are created **next to the original ZIP file**::

        input:   C:/Users/Name/photos.zip
        output:  C:/Users/Name/photos_cropped/
                 C:/Users/Name/photos_failed/

    When the ZIP is a temp upload, pass *original_path* so that output
    directories are placed beside the real file rather than in the
    temp directory.

    Args:
        zip_path:      Path to, or temp copy of, the ZIP file.
        original_path:  Optional real path of the ZIP file on disk.
                        When provided, output dirs are based on this
                        path's parent and stem instead of *zip_path*.

    Returns:
        Standardised summary dict.
    """
    zip_file = Path(zip_path).resolve()
    if not zip_file.is_file():
        raise FileNotFoundError(f"ZIP file not found: {zip_path}")

    # Decide where output dirs go:
    #   1. Explicit output_folder from the UI
    #   2. Beside the original_path (when ZIP was uploaded via browser)
    #   3. User-configured DEFAULT_OUTPUT_DIR from output_config.ini
    #   4. Beside the zip_path itself (last resort)
    if output_folder:
        output_base = Path(output_folder).resolve()
        output_stem = zip_file.stem
    elif original_path:
        origin = Path(original_path).resolve()
        output_base = origin.parent
        output_stem = origin.stem
    elif config.DEFAULT_OUTPUT_DIR:
        output_base = config.DEFAULT_OUTPUT_DIR
        output_stem = zip_file.stem
    else:
        output_base = zip_file.parent
        output_stem = zip_file.stem

    cropped_dir, failed_dir = _build_output_dirs(
        output_base, output_stem,
    )

    extractor = ZipExtractor()
    temp_dir = None

    try:
        # ── Extract ──────────────────────────────────────────────
        temp_dir, image_paths, skipped = extractor.extract(str(zip_file))

        if not image_paths:
            return _empty_summary(cropped_dir, failed_dir)

        # ── Process ──────────────────────────────────────────────
        processor = ImageProcessor()
        result = processor.process_batch(
            image_paths,
            cropped_dir=str(cropped_dir),
            failed_dir=str(failed_dir),
        )

        return _make_summary(result, cropped_dir, failed_dir)

    finally:
        if temp_dir:
            extractor.cleanup(temp_dir)


# ──────────────────────────────────────────────────────────────────────────
# Public API — Folder
# ──────────────────────────────────────────────────────────────────────────

def process_folder(folder_path: str) -> Dict[str, Any]:
    """
    Process a folder of portrait images through the passport crop
    pipeline.

    Output folders are created **inside the input folder**::

        input:   C:/Users/Name/Photos
        output:  C:/Users/Name/Photos/cropped/
                 C:/Users/Name/Photos/failed/

    Args:
        folder_path: Path to a directory containing image files.

    Returns:
        Standardised summary dict.
    """
    folder = Path(folder_path).resolve()

    if not folder.exists():
        raise FileNotFoundError(f"Folder not found: {folder_path}")
    if not folder.is_dir():
        raise ValueError(f"Path is not a directory: {folder_path}")

    # Collect images (only files — skips cropped/failed subdirs automatically).
    image_paths = _collect_image_paths(folder)

    if len(image_paths) > config.MAX_IMAGES_PER_ZIP:
        raise ValueError(
            f"Folder contains {len(image_paths)} images — "
            f"maximum allowed is {config.MAX_IMAGES_PER_ZIP}."
        )

    # Output dirs: inside the input folder itself.
    cropped_dir = folder / "cropped"
    failed_dir  = folder / "failed"
    cropped_dir.mkdir(parents=True, exist_ok=True)
    failed_dir.mkdir(parents=True, exist_ok=True)

    if not image_paths:
        return _empty_summary(cropped_dir, failed_dir)

    # ── Process ──────────────────────────────────────────────────
    processor = ImageProcessor()
    result = processor.process_batch(
        image_paths,
        cropped_dir=str(cropped_dir),
        failed_dir=str(failed_dir),
    )

    return _make_summary(result, cropped_dir, failed_dir)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    )

    if len(sys.argv) < 2:
        logger.error("Usage: python -m passport_engine_core <zip_or_folder>")
        sys.exit(1)

    target = sys.argv[1]
    logger.info("Processing: %s", target)

    target_path = Path(target)
    if target_path.is_dir():
        summary = process_folder(target)
    else:
        summary = process_zip(target)

    logger.info(
        "SUMMARY — total=%d  success=%d  failed=%d  accuracy=%.1f%%  "
        "time=%.2fs  output=%s  failed_dir=%s",
        summary["total"],
        summary["success"],
        summary["failed"],
        summary["accuracy"],
        summary["processing_time"],
        summary["output_folder"],
        summary["failed_folder"],
    )
