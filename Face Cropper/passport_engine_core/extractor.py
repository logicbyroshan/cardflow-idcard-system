"""
core/services/extractor.py
──────────────────────────
Responsible for extracting image files from the uploaded ZIP archive into
a temporary working directory.

Design Notes
─────────────
• Only files with recognised image extensions are extracted.
• Non-image files (READMEs, Thumbs.db, __MACOSX, etc.) are silently skipped.
• The extractor enforces the per-image file-size limit.
• A maximum of ``MAX_IMAGES_PER_ZIP`` images are accepted.
"""

import os
import zipfile
import tempfile
import logging
from pathlib import Path
from typing import List, Tuple

from . import config

logger = logging.getLogger(__name__)


class ZipExtractor:
    """
    Extracts valid image files from a ZIP archive into a temporary directory.

    Usage::

        extractor = ZipExtractor()
        temp_dir, image_paths, skipped = extractor.extract(uploaded_file)
        # …process image_paths…
        extractor.cleanup(temp_dir)
    """

    def __init__(self):
        # Recognised image extensions (lowercase, with leading dot).
        self.allowed_extensions: set = config.ALLOWED_IMAGE_EXTENSIONS
        self.max_images: int = config.MAX_IMAGES_PER_ZIP
        self.max_image_size: int = config.MAX_IMAGE_FILE_SIZE

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def extract(self, uploaded_file) -> Tuple[str, List[str], List[str]]:
        """
        Extract images from *uploaded_file* (a file path string or file-like object).

        Returns:
            tuple of (temp_dir, image_paths, skipped_names)
            • temp_dir      — path to the temporary directory holding extracted files
            • image_paths   — sorted list of absolute paths to valid image files
            • skipped_names — list of filenames that were skipped (non-image, too large, etc.)
        """
        # Create a temporary directory that persists until we explicitly clean up.
        temp_dir = tempfile.mkdtemp(prefix="passport_proc_")

        image_paths: List[str] = []
        skipped_names: List[str] = []

        # ── ZIP file size guard ──────────────────────────────────────
        try:
            zip_size = os.path.getsize(uploaded_file) if isinstance(uploaded_file, str) else None
        except OSError:
            zip_size = None

        if zip_size is not None and zip_size > config.MAX_ZIP_FILE_SIZE:
            max_mb = config.MAX_ZIP_FILE_SIZE // (1024 * 1024)
            raise ValueError(
                f"ZIP file exceeds the {max_mb} MB size limit "
                f"({zip_size / (1024 * 1024):.1f} MB)."
            )

        try:
            with zipfile.ZipFile(uploaded_file, "r") as zf:
                for info in zf.infolist():
                    # ---------------------------------------------------------
                    # Skip directories and hidden / system files
                    # ---------------------------------------------------------
                    if info.is_dir():
                        continue
                    basename = os.path.basename(info.filename)
                    if basename.startswith(".") or basename.startswith("__"):
                        skipped_names.append(info.filename)
                        continue

                    # ---------------------------------------------------------
                    # Extension filter — only extract recognised image types
                    # ---------------------------------------------------------
                    ext = Path(basename).suffix.lower()
                    if ext not in self.allowed_extensions:
                        skipped_names.append(info.filename)
                        logger.debug("Skipped non-image: %s", info.filename)
                        continue

                    # ---------------------------------------------------------
                    # Size guard — skip images that exceed the per-file limit
                    # ---------------------------------------------------------
                    if info.file_size > self.max_image_size:
                        skipped_names.append(info.filename)
                        logger.warning(
                            "Skipped oversized image (%d bytes): %s",
                            info.file_size,
                            info.filename,
                        )
                        continue

                    # ---------------------------------------------------------
                    # Enforce max image count
                    # ---------------------------------------------------------
                    if len(image_paths) >= self.max_images:
                        skipped_names.append(info.filename)
                        logger.warning(
                            "Max image limit (%d) reached — skipping: %s",
                            self.max_images,
                            info.filename,
                        )
                        continue

                    # ---------------------------------------------------------
                    # Extract the file into a flat directory (avoid nested dirs)
                    # ---------------------------------------------------------
                    # Use only the basename so all images end up directly in temp_dir.
                    # Handle duplicate basenames by appending a counter.
                    dest_path = self._unique_path(temp_dir, basename)
                    with zf.open(info) as src, open(dest_path, "wb") as dst:
                        dst.write(src.read())

                    image_paths.append(dest_path)

        except zipfile.BadZipFile:
            logger.error("Uploaded file is not a valid ZIP archive.")
            raise ValueError("The uploaded file is not a valid ZIP archive.")

        # Sort for deterministic processing order.
        image_paths.sort()
        logger.info(
            "Extracted %d images (%d skipped) into %s",
            len(image_paths),
            len(skipped_names),
            temp_dir,
        )
        return temp_dir, image_paths, skipped_names

    @staticmethod
    def cleanup(temp_dir: str) -> None:
        """
        Remove the temporary directory and all its contents.

        Called after processing is complete (success or failure).
        """
        import shutil

        if temp_dir and os.path.isdir(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
            logger.debug("Cleaned up temp dir: %s", temp_dir)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _unique_path(directory: str, filename: str) -> str:
        """
        Return a file path inside *directory* that does not already exist.

        If ``photo.jpg`` already exists, tries ``photo_1.jpg``, ``photo_2.jpg``, etc.
        """
        base, ext = os.path.splitext(filename)
        candidate = os.path.join(directory, filename)
        counter = 1
        while os.path.exists(candidate):
            candidate = os.path.join(directory, f"{base}_{counter}{ext}")
            counter += 1
        return candidate
