"""
core/services/processor.py
──────────────────────────
Orchestrates the full image-processing pipeline for a batch of portrait
images extracted from a ZIP file.

Pipeline — Hybrid Segmentation + FaceMesh Cropping (v6)
───────────────────────────────────────────────────────
Every image goes through a **single-pass hybrid pipeline**:

    STAGE 0 — Frontal Face Validation
              MediaPipe FaceMesh landmark checks: eyes, nose, mouth
              must exist and pass geometric frontal-alignment tests.
              Rejects back-of-head, side profiles, heavy rotation.

    STAGE 1 — Selfie Segmentation (hair crown)
              MediaPipe ImageSegmenter → binary mask → hair_top
              (minimum Y of person pixels).

    STAGE 2 — Face Detection
              MediaPipe FaceMesh (478 landmarks) with FaceDetector fallback.
              Extracts: chin_y, face_height, face_center_x.

    STAGE 3 — Build Passport Crop Box
              shoulder_extension = face_height × 0.75
              bottom_edge  = chin_y + shoulder_extension
              top_margin   = face_height × 0.08
              crop_top     = hair_top − top_margin
              crop_bottom  = bottom_edge
              crop_height  = crop_bottom − crop_top
              crop_width   = crop_height × (35 / 45)
              Horizontally centred on face_center_x.
              Shift-don't-shrink boundary clamping.

    STAGE 4 — Final Resize
              413 × 531 px, LANCZOS.

    STAGE 5 — Validation
              Lightweight — only fatal conditions fail.

Parallel Processing
───────────────────
``ProcessPoolExecutor`` with up to 4 workers.  Each worker is a
standalone function with no shared mutable state.

Result Structure
────────────────
Per-image::

    {
        "filename": str,
        "status": "success" | "failed",
        "reason": str | None,
        "failure_code": str | None,
        "strategy": str | None,
        "time": float,
    }
"""

import gc
import logging
import os
import shutil
import time
import traceback
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image
from . import config

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────

# Worker count — bounded by 4 to avoid overwhelming a desktop machine.
_MAX_WORKERS = min(4, os.cpu_count() or 2)

# Passport aspect ratio: width / height = 35 mm / 45 mm ≈ 0.7778.
_TARGET_RATIO = 35.0 / 45.0

# Confidence threshold for binarising the segmentation mask.
# Pixels with confidence ≥ this value are considered "person".
_SEGMENTATION_THRESHOLD = 0.5

# Shoulder extension factor.
#
# After locating the chin via FaceMesh, we extend downward by
# face_height × 0.75 to include the neck and upper shoulders.
# This replaces the mask bottom_edge which captured the full body.
_SHOULDER_EXTENSION = 0.75

# Top margin factor.
#
# Small proportional gap above the real hair crown so that the
# topmost row of the passport photo is not pressed directly against
# hair.  Computed as face_height × 0.08 — roughly 8 % of the face.
_TOP_MARGIN_FACTOR = 0.08

# ── Frontal-face validation constants ────────────────────────────────
#
# MediaPipe FaceMesh 478-point canonical landmark indices.
# Reference: https://github.com/google/mediapipe/blob/master/mediapipe
#            /modules/face_geometry/data/canonical_face_model_uv_visualization.png
#
# We only need a small subset to verify the face is frontal.
_LM_LEFT_EYE_OUTER   = 33    # outer corner of left eye
_LM_LEFT_EYE_INNER   = 133   # inner corner of left eye
_LM_RIGHT_EYE_INNER  = 362   # inner corner of right eye
_LM_RIGHT_EYE_OUTER  = 263   # outer corner of right eye
_LM_NOSE_TIP         = 1     # tip of the nose
_LM_MOUTH_LEFT       = 61    # left corner of the mouth
_LM_MOUTH_RIGHT      = 291   # right corner of the mouth

# Maximum allowed vertical difference between the two eye centres,
# expressed as a fraction of the inter-eye distance.  Values above
# this indicate a head tilt that is too large for a passport photo.
_MAX_EYE_TILT_RATIO = 0.25

# Minimum inter-eye distance as a fraction of image width.  Faces
# whose eyes are closer than this are likely too rotated (profile)
# or too far away to produce a usable crop.
_MIN_EYE_DISTANCE_RATIO = 0.04


# ──────────────────────────────────────────────────────────────────────────
# Result data class
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class ProcessingResult:
    """Structured summary of a batch processing run."""

    total: int = 0
    successful: int = 0
    failed: int = 0
    errors: List[str] = field(default_factory=list)
    failure_breakdown: Dict[str, int] = field(default_factory=dict)
    elapsed: float = 0.0
    avg_time: float = 0.0

    @property
    def accuracy(self) -> float:
        """Return success rate as a percentage (0-100)."""
        if self.total == 0:
            return 0.0
        return round((self.successful / self.total) * 100, 2)


# ══════════════════════════════════════════════════════════════════════════
# STAGE 0 — Frontal Face Validation
# ══════════════════════════════════════════════════════════════════════════

def _validate_frontal_face(
    image: Image.Image,
) -> Tuple[bool, str, str]:
    """
    Verify the image contains a **single, frontal face** before any
    cropping is attempted.

    Uses MediaPipe FaceLandmarker to extract key landmark positions and
    then applies geometric checks:

        1. **Landmark existence** — left eye, right eye, nose tip, and
           mouth corners must all be present.  If any are missing the
           detection is considered incomplete (back of head, occluded,
           or non-face).

        2. **Inter-eye distance** — if the horizontal distance between
           the eye centres is below a minimum fraction of the image
           width, the face is likely a side profile or too far away.

        3. **Nose between eyes** — for a frontal face the nose tip X
           coordinate must lie between the left-eye and right-eye X.
           Violations indicate a heavily rotated face.

        4. **Eye-level tilt** — the vertical difference between the
           two eye centres must be small relative to the inter-eye
           distance.  Large values mean the head is tilted.

    Returns:
        ``(passed, failure_code, reason)``
        On success ``failure_code`` and ``reason`` are empty strings.
    """
    try:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import (
            FaceLandmarker,
            FaceLandmarkerOptions,
        )
    except ImportError:
        # MediaPipe unavailable — skip validation (pass through).
        logger.debug("mediapipe unavailable — skipping frontal check.")
        return True, "", ""

    model_path = str(config.FACE_LANDMARKER_MODEL)
    if not Path(model_path).is_file():
        logger.debug("FaceLandmarker model missing — skipping frontal check.")
        return True, "", ""

    img_w, img_h = image.size
    rgb = np.ascontiguousarray(np.array(image), dtype=np.uint8)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    try:
        options = FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            num_faces=1,
            min_face_detection_confidence=0.3,
            min_face_presence_confidence=0.3,
        )
        landmarker = FaceLandmarker.create_from_options(options)
        results = landmarker.detect(mp_image)
        landmarker.close()
    except Exception as exc:
        logger.warning("FaceLandmarker error during frontal check: %s", exc)
        return True, "", ""   # fail-open on detector errors

    # ── 1. Landmark existence ────────────────────────────────────────
    if not results.face_landmarks or len(results.face_landmarks) == 0:
        return False, "NO_VALID_FACE", "No face landmarks detected"

    lm = results.face_landmarks[0]
    total_landmarks = len(lm)

    # Verify all required indices are within bounds.
    required = [
        _LM_LEFT_EYE_OUTER, _LM_LEFT_EYE_INNER,
        _LM_RIGHT_EYE_INNER, _LM_RIGHT_EYE_OUTER,
        _LM_NOSE_TIP,
        _LM_MOUTH_LEFT, _LM_MOUTH_RIGHT,
    ]
    if any(idx >= total_landmarks for idx in required):
        return (
            False, "NO_VALID_FACE",
            "Face landmarks incomplete — required features missing",
        )

    # Extract pixel coordinates for the key landmarks.
    left_eye_x  = (lm[_LM_LEFT_EYE_OUTER].x + lm[_LM_LEFT_EYE_INNER].x) / 2.0 * img_w
    left_eye_y  = (lm[_LM_LEFT_EYE_OUTER].y + lm[_LM_LEFT_EYE_INNER].y) / 2.0 * img_h
    right_eye_x = (lm[_LM_RIGHT_EYE_INNER].x + lm[_LM_RIGHT_EYE_OUTER].x) / 2.0 * img_w
    right_eye_y = (lm[_LM_RIGHT_EYE_INNER].y + lm[_LM_RIGHT_EYE_OUTER].y) / 2.0 * img_h
    nose_x      = lm[_LM_NOSE_TIP].x * img_w
    mouth_l_x   = lm[_LM_MOUTH_LEFT].x * img_w
    mouth_r_x   = lm[_LM_MOUTH_RIGHT].x * img_w

    # ── 2. Inter-eye distance ────────────────────────────────────────
    #
    # If the eyes are too close together the face is likely in profile
    # or too far from the camera.
    eye_dx = abs(right_eye_x - left_eye_x)
    eye_dy = abs(right_eye_y - left_eye_y)
    eye_dist = (eye_dx**2 + eye_dy**2) ** 0.5

    min_eye_dist = img_w * _MIN_EYE_DISTANCE_RATIO
    if eye_dist < min_eye_dist:
        msg = (
            f"Inter-eye distance too small ({eye_dist:.1f} px, "
            f"min {min_eye_dist:.1f} px) — face may be side-profile"
        )
        logger.info("Frontal check failed: %s", msg)
        return False, "FACE_NOT_FRONTAL", msg

    # ── 3. Nose between eyes (horizontal) ────────────────────────────
    #
    # For a frontal face the nose tip must be horizontally between the
    # two eye centres.  A small tolerance (10 % of eye distance) is
    # added to handle slight natural asymmetry.
    tolerance = eye_dx * 0.10
    eye_left_x  = min(left_eye_x, right_eye_x)
    eye_right_x = max(left_eye_x, right_eye_x)

    if nose_x < (eye_left_x - tolerance) or nose_x > (eye_right_x + tolerance):
        msg = (
            f"Nose tip (x={nose_x:.0f}) is outside eye range "
            f"[{eye_left_x:.0f}..{eye_right_x:.0f}] — face is rotated"
        )
        logger.info("Frontal check failed: %s", msg)
        return False, "FACE_NOT_FRONTAL", msg

    # ── 4. Eye-level tilt ────────────────────────────────────────────
    #
    # The vertical difference between the two eye centres should be
    # small relative to the inter-eye distance.  Large tilt means the
    # head is rotated around the camera axis.
    if eye_dist > 0:
        tilt_ratio = eye_dy / eye_dist
        if tilt_ratio > _MAX_EYE_TILT_RATIO:
            msg = (
                f"Eyes too tilted (tilt ratio {tilt_ratio:.2f}, "
                f"max {_MAX_EYE_TILT_RATIO}) — head is tilted"
            )
            logger.info("Frontal check failed: %s", msg)
            return False, "FACE_NOT_FRONTAL", msg

    # ── 5. Mouth existence (simple sanity) ───────────────────────────
    #
    # Verify the mouth corners are roughly below the nose.  This
    # guards against degenerate landmark placements.
    mouth_cx = (mouth_l_x + mouth_r_x) / 2.0
    if abs(mouth_cx - nose_x) > eye_dx * 0.6:
        msg = "Mouth position inconsistent with nose — possible non-frontal face"
        logger.info("Frontal check failed: %s", msg)
        return False, "FACE_NOT_FRONTAL", msg

    logger.debug(
        "Frontal check passed: eye_dist=%.0f  tilt=%.2f  "
        "nose_x=%.0f  eyes=[%.0f..%.0f]",
        eye_dist, eye_dy / eye_dist if eye_dist > 0 else 0,
        nose_x, eye_left_x, eye_right_x,
    )
    return True, "", ""


# ══════════════════════════════════════════════════════════════════════════
# STAGE 1 — Selfie Segmentation (hair crown only)
# ══════════════════════════════════════════════════════════════════════════

def _segment_hair_top(image: Image.Image) -> Optional[int]:
    """
    Run MediaPipe SelfieSegmentation and return the **topmost Y pixel**
    of the person mask — i.e. the real hair crown.

    We intentionally ignore the bottom edge of the mask because it
    captures the full body (waist, legs, feet) which produces crops
    that are far too tall for a passport photo.  The bottom boundary
    is instead derived from the face chin + a shoulder extension.

    Process:
        1. Feed image into ImageSegmenter with selfie_segmenter.tflite.
        2. Extract confidence mask (float32, H×W×1 or H×W).
        3. Binarise at threshold 0.5 → person vs. background.
        4. Return minimum Y of all person pixels (hair_top).

    Returns:
        ``hair_top`` (int, pixel Y coordinate), or ``None`` if no
        person pixels are detected or on error.
    """
    try:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import (
            ImageSegmenter,
            ImageSegmenterOptions,
        )
    except ImportError:
        logger.warning("mediapipe not installed — segmentation disabled.")
        return None

    model_path = str(config.SELFIE_SEGMENTER_MODEL)
    if not Path(model_path).is_file():
        logger.warning("Selfie segmenter model not found at %s", model_path)
        return None

    # Convert PIL image to MediaPipe Image (RGB, contiguous uint8).
    rgb = np.ascontiguousarray(np.array(image), dtype=np.uint8)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    try:
        options = ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            output_confidence_masks=True,
            output_category_mask=False,
        )
        segmenter = ImageSegmenter.create_from_options(options)
        result = segmenter.segment(mp_image)
        segmenter.close()
    except Exception as exc:
        logger.warning("ImageSegmenter error: %s", exc)
        return None

    # ── Extract confidence mask ──────────────────────────────────────
    if not result.confidence_masks:
        logger.info("Segmenter returned no confidence masks.")
        return None

    mask_arr = result.confidence_masks[0].numpy_view()

    # Squeeze trailing dimension if present (shape H×W×1 → H×W).
    if mask_arr.ndim == 3:
        mask_arr = mask_arr.squeeze(axis=-1)

    # ── Binarise: pixels ≥ threshold are "person" ────────────────────
    binary = (mask_arr >= _SEGMENTATION_THRESHOLD).astype(np.uint8)

    # Find all person-pixel Y coordinates.
    ys = np.where(binary > 0)[0]

    if len(ys) == 0:
        logger.info("Segmentation mask has no person pixels.")
        return None

    hair_top = int(ys.min())

    logger.debug("Segmentation: hair_top=%d", hair_top)

    return hair_top


# ══════════════════════════════════════════════════════════════════════════
# STAGE 2 — Face Detection (chin_y, face_height, face_center_x)
# ══════════════════════════════════════════════════════════════════════════

def _detect_face(image: Image.Image) -> Optional[Dict[str, float]]:
    """
    Detect the face and return the values needed for crop computation.

    Tries MediaPipe FaceLandmarker (478 landmarks) first for precision,
    then falls back to FaceDetector (bounding box only).

    Returns:
        Dict with ``chin_y``, ``face_height``, ``face_center_x``
        (all in pixel coordinates), or ``None`` if no face is detected.
    """
    # ── Try FaceLandmarker first (precise 478-point mesh) ────────────
    face = _face_via_mesh(image)
    if face is not None:
        return face

    # ── Fallback: FaceDetector bounding box ──────────────────────────
    face = _face_via_detector(image)
    return face


def _face_via_mesh(image: Image.Image) -> Optional[Dict[str, float]]:
    """
    Extract chin_y, face_height, face_center_x using MediaPipe
    FaceLandmarker (478 landmarks).

    Returns dict or ``None``.
    """
    try:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import (
            FaceLandmarker,
            FaceLandmarkerOptions,
        )
    except ImportError:
        logger.warning("mediapipe not installed — FaceMesh disabled.")
        return None

    model_path = str(config.FACE_LANDMARKER_MODEL)
    if not Path(model_path).is_file():
        logger.warning("FaceLandmarker model not found at %s", model_path)
        return None

    img_w, img_h = image.size
    rgb = np.ascontiguousarray(np.array(image), dtype=np.uint8)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    try:
        options = FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            num_faces=1,
            min_face_detection_confidence=0.3,
            min_face_presence_confidence=0.3,
        )
        landmarker = FaceLandmarker.create_from_options(options)
        results = landmarker.detect(mp_image)
        landmarker.close()
    except Exception as exc:
        logger.warning("FaceLandmarker error: %s", exc)
        return None

    if not results.face_landmarks or len(results.face_landmarks) == 0:
        return None

    # FaceMesh returns 478 landmarks normalised to [0, 1].
    landmarks = results.face_landmarks[0]
    xs = [lm.x * img_w for lm in landmarks]
    ys = [lm.y * img_h for lm in landmarks]

    forehead_y    = min(ys)
    chin_y        = max(ys)
    left_face     = min(xs)
    right_face    = max(xs)
    face_height   = chin_y - forehead_y
    face_center_x = (left_face + right_face) / 2.0

    if face_height < 10:
        logger.info("FaceMesh face too small (h=%.0f px).", face_height)
        return None

    logger.debug(
        "FaceMesh: chin=%.0f  fh=%.0f  cx=%.0f",
        chin_y, face_height, face_center_x,
    )

    return {
        "chin_y":        chin_y,
        "face_height":   face_height,
        "face_center_x": face_center_x,
    }


def _face_via_detector(image: Image.Image) -> Optional[Dict[str, float]]:
    """
    Fallback: extract chin_y, face_height, face_center_x using
    MediaPipe FaceDetector (bounding box only, no landmarks).

    Returns dict or ``None``.
    """
    try:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import (
            FaceDetector,
            FaceDetectorOptions,
        )
    except ImportError:
        return None

    model_path = str(config.FACE_DETECTOR_MODEL)
    if not Path(model_path).is_file():
        return None

    rgb = np.ascontiguousarray(np.array(image), dtype=np.uint8)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    try:
        options = FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            min_detection_confidence=0.3,
        )
        detector = FaceDetector.create_from_options(options)
        results = detector.detect(mp_image)
        detector.close()
    except Exception:
        return None

    if not results.detections:
        return None

    bb = results.detections[0].bounding_box
    fx, fy, fw, fh = bb.origin_x, bb.origin_y, bb.width, bb.height

    if fh < 10:
        return None

    face_center_x = float(fx + fw / 2.0)
    chin_y        = float(fy + fh)
    face_height   = float(fh)

    logger.debug(
        "FaceDetector fallback: chin=%.0f  fh=%.0f  cx=%.0f",
        chin_y, face_height, face_center_x,
    )

    return {
        "chin_y":        chin_y,
        "face_height":   face_height,
        "face_center_x": face_center_x,
    }


# ══════════════════════════════════════════════════════════════════════════
# STAGE 3 — Build Passport Crop Box
# ══════════════════════════════════════════════════════════════════════════

def _build_crop_box(
    hair_top: int,
    face: Dict[str, float],
    img_w: int,
    img_h: int,
) -> Optional[Tuple[int, int, int, int]]:
    """
    Build a passport-ratio crop box from the segmentation hair crown and
    the FaceMesh chin + face_height + face_center_x.

    The algorithm:

        1.  shoulder_extension = face_height × 0.75
            bottom_edge = chin_y + shoulder_extension
            ────────────────────────────────────────────
            Extend below the chin by 75 % of face height to capture
            the neck and upper shoulders.  This replaces the mask
            bottom_edge which captured the full body.

        2.  crop_top    = hair_top  (real hair crown from segmentation)
            crop_bottom = bottom_edge
            crop_height = crop_bottom − crop_top
            ────────────────────────────────────

        3.  crop_width = crop_height × (35 / 45)
            ──────────────────────────────────────
            Enforces the ICAO passport aspect ratio.

        4.  Horizontally centred on face_center_x.

        5.  Boundary handling: SHIFT the box inward — never shrink it.
            If the required crop is larger than the image in either
            axis, return None.

    Args:
        hair_top:  Top-most Y pixel from the segmentation mask.
        face:      Dict with ``chin_y``, ``face_height``, ``face_center_x``.
        img_w:     Source image width in pixels.
        img_h:     Source image height in pixels.

    Returns:
        ``(left, top, right, bottom)`` integer pixel coords, or ``None``
        if the crop cannot fit inside the image.
    """
    chin_y        = face["chin_y"]
    face_height   = face["face_height"]
    face_center_x = face["face_center_x"]

    # ── Step 1: Compute shoulder boundary ────────────────────────────
    #
    # Extend below the chin by face_height × 0.75 to include the neck
    # and upper shoulders.  This avoids using the mask bottom_edge
    # which would capture the full torso / legs.
    shoulder_extension = face_height * _SHOULDER_EXTENSION
    bottom_edge = chin_y + shoulder_extension

    # ── Step 2: Crop region — hair crown (with margin) to shoulders ──
    #
    # Add a small proportional margin above hair_top so the passport
    # photo has breathing room above the hair.  The margin is 8 % of
    # face_height — small enough to be invisible on good photos but
    # large enough to prevent hair touching the frame edge.
    top_margin = face_height * _TOP_MARGIN_FACTOR
    crop_top    = float(hair_top) - top_margin
    crop_bottom = float(bottom_edge)
    crop_height = crop_bottom - crop_top

    # Guard: crop height must be positive and at least 30 px.
    if crop_height < 30:
        logger.warning(
            "Crop height too small (%.0f px) — hair_top=%d bottom=%.0f",
            crop_height, hair_top, bottom_edge,
        )
        return None

    # ── Step 3: Derive crop width from passport aspect ratio ─────────
    #
    #   crop_width = crop_height × (35 / 45)
    crop_width = crop_height * _TARGET_RATIO

    # ── Step 4: Horizontal centring on the face ──────────────────────
    #
    #   crop_left  = face_center_x − crop_width / 2
    #   crop_right = face_center_x + crop_width / 2
    crop_left  = face_center_x - (crop_width / 2.0)
    crop_right = face_center_x + (crop_width / 2.0)

    # ── Step 5: Boundary handling — shift inward, never shrink ───────
    #
    # If the crop box overflows one edge, slide the entire box inward
    # by the overflow amount.  This preserves the crop dimensions
    # (and therefore the aspect ratio) exactly.

    # Vertical shift.
    if crop_top < 0:
        crop_bottom -= crop_top
        crop_top = 0.0

    if crop_bottom > img_h:
        overshoot = crop_bottom - img_h
        crop_top -= overshoot
        crop_bottom = float(img_h)

    # Horizontal shift.
    if crop_left < 0:
        crop_right -= crop_left
        crop_left = 0.0

    if crop_right > img_w:
        overshoot = crop_right - img_w
        crop_left -= overshoot
        crop_right = float(img_w)

    # ── Step 6: Final feasibility check ──────────────────────────────
    if crop_top < -0.5 or crop_left < -0.5:
        logger.warning(
            "Crop (%.0f×%.0f) cannot fit in image (%d×%d) — aborting.",
            crop_width, crop_height, img_w, img_h,
        )
        return None

    # Snap to integer pixel coordinates.
    left   = max(int(round(crop_left)),   0)
    top    = max(int(round(crop_top)),    0)
    right  = min(int(round(crop_right)),  img_w)
    bottom = min(int(round(crop_bottom)), img_h)

    # Sanity: final box must be at least 30 px in each axis.
    if (right - left) < 30 or (bottom - top) < 30:
        logger.warning(
            "Final crop box too small (%d×%d) — aborting.",
            right - left, bottom - top,
        )
        return None

    logger.info(
        "Hybrid crop: bbox=(%d, %d, %d, %d)  crop=%d×%d  "
        "hair_top=%d  chin=%.0f  shoulder_ext=%.0f  bottom=%.0f",
        left, top, right, bottom,
        right - left, bottom - top,
        hair_top, chin_y, shoulder_extension, bottom_edge,
    )

    return (left, top, right, bottom)


# ══════════════════════════════════════════════════════════════════════════
# Standalone worker function  (top-level for ProcessPoolExecutor)
# ══════════════════════════════════════════════════════════════════════════

def process_single_image(
    image_path: str,
    cropped_dir: Optional[str] = None,
    failed_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Process one image through the segmentation-based pipeline:

        1. Selfie segmentation  (person mask → bounding edges)
        2. Face detection       (FaceMesh → FaceDetector fallback → face_center_x)
        3. Build crop box       (person_height, passport ratio, face-centred)
        4. Final resize         (413×531 px, LANCZOS)
        5. Validation           (lightweight — fatal conditions only)

    Designed for ``ThreadPoolExecutor`` — creates all its own resources,
    no shared state.

    Args:
        image_path:  Absolute path to an image file.
        cropped_dir: Directory for successfully cropped images.
                     Defaults to ``config.CROPPED_DIR``.
        failed_dir:  Directory for failed images.
                     Defaults to ``config.FAILED_DIR``.

    Returns:
        Result dict with keys: filename, status, reason, failure_code,
        strategy, time.
    """
    from .validators import ImageValidator, FailureCode

    start    = time.perf_counter()
    filename = Path(image_path).name

    target_w:    int  = config.PASSPORT_WIDTH
    target_h:    int  = config.PASSPORT_HEIGHT
    cropped_dir: Path = Path(cropped_dir) if cropped_dir else config.CROPPED_DIR
    failed_dir:  Path = Path(failed_dir) if failed_dir else config.FAILED_DIR

    result: Dict[str, Any] = {
        "filename":     filename,
        "status":       "failed",
        "reason":       None,
        "failure_code": None,
        "strategy":     None,
        "time":         0.0,
    }

    image:   Optional[Image.Image] = None
    cropped: Optional[Image.Image] = None
    resized: Optional[Image.Image] = None

    try:
        # ── Open & normalise ─────────────────────────────────────────
        try:
            img = Image.open(image_path)
            img.verify()
            img = Image.open(image_path)
            image = img.convert("RGB")
        except Exception as exc:
            result["reason"]       = f"Corrupted or unreadable: {exc}"
            result["failure_code"] = FailureCode.CORRUPTED_IMAGE
            _copy_failed(image_path, failed_dir / filename)
            return result

        img_w, img_h = image.size

        # ═════════════════════════════════════════════════════════════
        # STAGE 0 — Frontal Face Validation
        # ═════════════════════════════════════════════════════════════
        #
        # Reject images that show the back of the head, a side
        # profile, or a heavily rotated face BEFORE running the
        # more expensive segmentation + crop pipeline.

        frontal_ok, frontal_code, frontal_reason = _validate_frontal_face(image)

        if not frontal_ok:
            result["reason"]       = frontal_reason
            result["failure_code"] = frontal_code
            _copy_failed(image_path, failed_dir / filename)
            return result

        # ═════════════════════════════════════════════════════════════
        # STAGE 1 — Selfie Segmentation (hair crown)
        # ═════════════════════════════════════════════════════════════
        #
        # Get the real hair-top from the segmentation mask.  We
        # intentionally ignore the mask bottom_edge because it
        # captures the full body / legs.

        hair_top = _segment_hair_top(image)

        if hair_top is None:
            result["reason"]       = "No person segmentation detected"
            result["failure_code"] = FailureCode.NO_FACE_DETECTED
            _copy_failed(image_path, failed_dir / filename)
            return result

        # ═════════════════════════════════════════════════════════════
        # STAGE 2 — Face Detection (chin, face_height, centre_x)
        # ═════════════════════════════════════════════════════════════
        #
        # FaceMesh gives us chin_y and face_height for computing the
        # shoulder boundary, plus face_center_x for horizontal centre.

        face = _detect_face(image)
        strategy_name = "Segmentation+FaceMesh"

        if face is None:
            result["reason"]       = "No face detected in image"
            result["failure_code"] = FailureCode.NO_FACE_DETECTED
            _copy_failed(image_path, failed_dir / filename)
            return result

        logger.info(
            "%s: hair_top=%d  chin=%.0f  face_h=%.0f  cx=%.0f",
            filename, hair_top,
            face["chin_y"], face["face_height"], face["face_center_x"],
        )

        # ═════════════════════════════════════════════════════════════
        # STAGE 3 — Build Passport Crop Box
        # ═════════════════════════════════════════════════════════════

        bbox = _build_crop_box(hair_top, face, img_w, img_h)

        if bbox is None:
            result["reason"]       = "Crop box cannot fit inside image"
            result["failure_code"] = FailureCode.CROP_INVALID
            _copy_failed(image_path, failed_dir / filename)
            return result

        result["strategy"] = strategy_name

        # ═════════════════════════════════════════════════════════════
        # STAGE 4 — Final Resize
        # ═════════════════════════════════════════════════════════════
        #
        # Crop → resize to 413×531 using LANCZOS.
        # NO stretching, NO padding, NO white borders.

        cropped = image.crop(bbox)
        resized = cropped.resize((target_w, target_h), Image.LANCZOS)

        # Release large objects early.
        image.close();   image   = None
        cropped.close(); cropped = None

        # ═════════════════════════════════════════════════════════════
        # STAGE 5 — Validation
        # ═════════════════════════════════════════════════════════════
        #
        # Lightweight — only fatal conditions cause failure.

        validator = ImageValidator()
        is_valid, code, reason = validator.validate(resized)

        if is_valid:
            resized.save(cropped_dir / filename, quality=95)
            result["status"] = "success"
        else:
            resized.save(failed_dir / filename, quality=95)
            result["reason"]       = reason
            result["failure_code"] = code

    except Exception as exc:
        result["reason"]       = str(exc)
        result["failure_code"] = FailureCode.CORRUPTED_IMAGE

    finally:
        for obj in (image, cropped, resized):
            if obj is not None:
                try:
                    obj.close()
                except Exception:
                    pass
        # Explicitly delete references before gc to help free memory.
        del image, cropped, resized
        result["time"] = round(time.perf_counter() - start, 4)
        gc.collect()

    return result


# ──────────────────────────────────────────────────────────────────────────
# Utility
# ──────────────────────────────────────────────────────────────────────────

def _copy_failed(src: str, dest: Path) -> None:
    """Copy an unprocessable original into the failed folder."""
    try:
        shutil.copy2(src, dest)
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════════
# Main processor service  (called by the view)
# ══════════════════════════════════════════════════════════════════════════

class ImageProcessor:
    """
    Processes a list of image file paths in parallel and returns a
    ``ProcessingResult`` summary with failure breakdown.

    Usage::

        processor = ImageProcessor()
        result = processor.process_batch(image_paths)
    """

    def __init__(self):
        self.workers = _MAX_WORKERS

    def process_batch(
        self,
        image_paths: List[str],
        cropped_dir: Optional[str] = None,
        failed_dir: Optional[str] = None,
    ) -> ProcessingResult:
        """
        Submit every image to a process pool, collect results, and
        build the final summary.

        Args:
            image_paths: List of absolute paths to image files.
            cropped_dir: Output directory for successful crops.
            failed_dir:  Output directory for failed images.
        """
        total = len(image_paths)
        result = ProcessingResult(total=total)
        batch_start = time.perf_counter()
        image_results: List[Dict[str, Any]] = []

        logger.info(
            "Starting batch: %d images, %d workers", total, self.workers,
        )

        # Build a worker callable with the output dirs baked in.
        worker_fn = partial(
            process_single_image,
            cropped_dir=cropped_dir,
            failed_dir=failed_dir,
        )

        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            future_to_path = {
                executor.submit(worker_fn, p): p
                for p in image_paths
            }
            for idx, future in enumerate(as_completed(future_to_path), start=1):
                path_str = future_to_path[future]
                filename = Path(path_str).name
                try:
                    img_result = future.result()
                except Exception as exc:
                    img_result = {
                        "filename":     filename,
                        "status":       "failed",
                        "reason":       str(exc),
                        "failure_code": "CORRUPTED_IMAGE",
                        "strategy":     None,
                        "time":         0.0,
                    }
                    logger.error(
                        "[%d/%d] ERROR — %s:\n%s",
                        idx, total, path_str, traceback.format_exc(),
                    )

                image_results.append(img_result)

                # Live progress logging.
                if img_result["status"] == "success":
                    logger.info(
                        "[%d/%d] OK   — %s (%.2fs, %s)",
                        idx, total, img_result["filename"],
                        img_result["time"],
                        img_result.get("strategy", "?"),
                    )
                else:
                    logger.info(
                        "[%d/%d] FAIL — %s — %s (%.2fs)",
                        idx, total, img_result["filename"],
                        img_result.get("failure_code", "UNKNOWN"),
                        img_result["time"],
                    )

        # ── Aggregate statistics ─────────────────────────────────────
        result.elapsed = round(time.perf_counter() - batch_start, 2)
        failure_codes: List[str] = []

        for ir in image_results:
            if ir["status"] == "success":
                result.successful += 1
            else:
                result.failed += 1
                code = ir.get("failure_code") or "UNKNOWN"
                failure_codes.append(code)
                if len(result.errors) < 50:
                    result.errors.append(
                        f"{ir['filename']}: [{code}] {ir.get('reason', '')}"
                    )

        result.failure_breakdown = dict(Counter(failure_codes))

        total_img_time = sum(ir["time"] for ir in image_results)
        result.avg_time = round(total_img_time / total, 4) if total else 0.0

        logger.info(
            "Batch complete — %d total, %d ok, %d failed (%.1f%% accuracy) "
            "in %.2fs (avg %.3fs/image, %d workers)",
            result.total, result.successful, result.failed,
            result.accuracy, result.elapsed, result.avg_time, self.workers,
        )
        if result.failure_breakdown:
            logger.info("Failure breakdown: %s", result.failure_breakdown)

        return result
