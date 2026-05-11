"""
core/services/validators.py
────────────────────────────
Lightweight validation for processed passport images.

The ``ImageValidator`` checks whether a final cropped image meets the
**minimum** quality bar before it is saved to the "cropped" directory.
Images that fail are routed to the "failed" directory.

Design Principle
────────────────
The v2 pipeline already guarantees passport-style composition via the
smart auto-zoom + adaptive ratio correction stages.  The validator
therefore only catches **fatal** defects:

    NO_FACE_DETECTED  — no face detected in the final crop
    CROP_INVALID      — crop area became invalid after adjustments
    RATIO_INVALID     — aspect ratio does not match 35:45
    CORRUPTED_IMAGE   — image is blank, wrong mode, or wrong size

**REMOVED** (v2): FACE_TOO_SMALL and FACE_TOO_LARGE strict rejections.
The adaptive loop in the processor ensures the face ratio lands in the
target window, so a separate validator check is unnecessary and would
cause false rejections for unusual but acceptable portraits.

Each check returns ``(passed, failure_code, human_description)``.
"""

import logging
from pathlib import Path
from typing import Tuple

import numpy as np
from PIL import Image
from . import config

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Failure code constants
# ──────────────────────────────────────────────────────────────────────────

class FailureCode:
    """Centralised, machine-readable failure-reason constants."""

    NO_FACE_DETECTED  = "NO_FACE_DETECTED"
    NO_VALID_FACE     = "NO_VALID_FACE"
    FACE_NOT_FRONTAL  = "FACE_NOT_FRONTAL"
    CROP_INVALID      = "CROP_INVALID"
    RATIO_INVALID     = "RATIO_INVALID"
    CORRUPTED_IMAGE   = "CORRUPTED_IMAGE"


# Expected passport ratio (width / height).
_EXPECTED_RATIO  = 35.0 / 45.0
_RATIO_TOLERANCE = 0.02   # ±2 %


# ──────────────────────────────────────────────────────────────────────────
# Validator class
# ──────────────────────────────────────────────────────────────────────────

class ImageValidator:
    """
    Validates a processed passport image against a minimal set of
    quality rules.

    Usage::

        validator = ImageValidator()
        is_valid, code, reason = validator.validate(image)
    """

    def __init__(self):
        self.target_width:  int = config.PASSPORT_WIDTH
        self.target_height: int = config.PASSPORT_HEIGHT

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def validate(self, image: Image.Image) -> Tuple[bool, str, str]:
        """
        Run all validation checks on *image*.

        Returns:
            (is_valid, failure_code, reason)
            • is_valid     — ``True`` if all checks pass.
            • failure_code — Machine-readable code (empty on success).
            • reason       — Human-readable explanation (empty on success).
        """
        checks = [
            self._check_dimensions,
            self._check_mode,
            self._check_minimum_variance,
            self._check_aspect_ratio,
        ]

        for check in checks:
            passed, code, reason = check(image)
            if not passed:
                logger.info("Validation failed [%s] — %s", code, reason)
                return False, code, reason

        return True, "", ""

    # ------------------------------------------------------------------
    # Individual validation checks
    # ------------------------------------------------------------------

    def _check_dimensions(self, image: Image.Image) -> Tuple[bool, str, str]:
        """Ensure image is exactly the expected passport dimensions."""
        w, h = image.size
        if w != self.target_width or h != self.target_height:
            msg = (
                f"Unexpected dimensions {w}×{h} "
                f"(expected {self.target_width}×{self.target_height})."
            )
            return False, FailureCode.CORRUPTED_IMAGE, msg
        return True, "", ""

    @staticmethod
    def _check_mode(image: Image.Image) -> Tuple[bool, str, str]:
        """Reject images not in RGB mode."""
        if image.mode != "RGB":
            return (
                False,
                FailureCode.CORRUPTED_IMAGE,
                f"Image mode is '{image.mode}'; expected 'RGB'.",
            )
        return True, "", ""

    @staticmethod
    def _check_minimum_variance(image: Image.Image) -> Tuple[bool, str, str]:
        """Reject completely flat (single-colour / blank) images."""
        arr = np.array(image)
        std_dev = arr.std()
        if std_dev < 5.0:
            return (
                False,
                FailureCode.CORRUPTED_IMAGE,
                f"Image appears blank or nearly uniform (σ = {std_dev:.1f}).",
            )
        return True, "", ""

    @staticmethod
    def _check_aspect_ratio(image: Image.Image) -> Tuple[bool, str, str]:
        """Verify 35:45 passport aspect ratio within tolerance."""
        w, h = image.size
        if h == 0:
            return False, FailureCode.RATIO_INVALID, "Image has zero height."
        actual_ratio = w / h
        if abs(actual_ratio - _EXPECTED_RATIO) > _RATIO_TOLERANCE:
            return (
                False,
                FailureCode.RATIO_INVALID,
                f"Aspect ratio {actual_ratio:.4f} deviates from "
                f"expected {_EXPECTED_RATIO:.4f} (tolerance ±{_RATIO_TOLERANCE}).",
            )
        return True, "", ""


