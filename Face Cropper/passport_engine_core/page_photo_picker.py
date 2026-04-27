"""
passport_engine_core/page_photo_picker.py
────────────────────────────────────────
Extract person-photo patches from scanned pages.

This module is intentionally independent from the existing passport face-crop
pipeline so the original behavior remains untouched.

Workflow
────────
1. Detect likely rectangular photo regions on a scanned page.
2. Rectify each region with perspective transform (handles tilt/rotation).
3. Trim surrounding white paper borders.
4. Keep only regions that still contain a detectable face (best effort).
5. Save extracted photos to <input_folder>/picked.

If no valid photo region is found for a page, the original page is copied to
<input_folder>/pick_failed.
"""

from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
from PIL import Image

from . import config

try:
    from .processor import _detect_face as _processor_detect_face, _segment_hair_top as _processor_segment_hair_top
except Exception:  # pragma: no cover - processor may be packaged separately
    _processor_detect_face = None
    _processor_segment_hair_top = None

try:
    import cv2
except ImportError:  # pragma: no cover - optional runtime dependency guard
    cv2 = None

try:
    import mediapipe as mp
except ImportError:  # pragma: no cover - optional runtime dependency guard
    mp = None

logger = logging.getLogger(__name__)


_MIN_REGION_AREA_RATIO = 0.012
_MAX_REGION_AREA_RATIO = 0.80
_MAX_CANDIDATES_PER_PAGE = 24
_MAX_PHOTOS_PER_PAGE = 3
_DEFAULT_PHOTOS_PER_PAGE = 3
_WHITE_TRIM_THRESHOLD = 245
_MIN_OUTPUT_SIDE = 120
_MIN_FACE_COVERAGE_RATIO = 0.022
_PASSPORT_BOX_WIDTH = 350
_PASSPORT_BOX_HEIGHT = 450
_TARGET_PORTRAIT_RATIO = 35.0 / 45.0
_SEGMENTATION_THRESHOLD = 0.18
_SEGMENTATION_MIN_AREA_RATIO = 0.09
_SEGMENTATION_MAX_AREA_RATIO = 0.95
_SEGMENTATION_BORDER_TOUCH_RATIO = 0.90

_SELFIE_SEGMENTER = None
_SELFIE_SEGMENTER_READY = False
_FACE_CASCADE = None


def _read_image_bgr(path: Path):
    """Read image with Windows-safe path handling."""
    if cv2 is None:
        return None

    try:
        data = np.fromfile(str(path), dtype=np.uint8)
        if data.size == 0:
            return None
        return cv2.imdecode(data, cv2.IMREAD_COLOR)
    except Exception:
        return None


def _get_selfie_segmenter():
    """Lazily initialize MediaPipe selfie-segmentation when available."""
    global _SELFIE_SEGMENTER, _SELFIE_SEGMENTER_READY
    if _SELFIE_SEGMENTER_READY:
        return _SELFIE_SEGMENTER

    _SELFIE_SEGMENTER_READY = True
    if mp is None:
        _SELFIE_SEGMENTER = None
        return None

    try:
        _SELFIE_SEGMENTER = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1)
    except Exception:
        _SELFIE_SEGMENTER = None

    return _SELFIE_SEGMENTER


def _get_face_cascade():
    """Load OpenCV Haar cascade once as fallback face detector."""
    global _FACE_CASCADE
    if _FACE_CASCADE is not None:
        return _FACE_CASCADE

    if cv2 is None:
        return None

    try:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        cascade = cv2.CascadeClassifier(cascade_path)
        if cascade.empty():
            _FACE_CASCADE = None
        else:
            _FACE_CASCADE = cascade
    except Exception:
        _FACE_CASCADE = None

    return _FACE_CASCADE


def _detect_face(image: Image.Image):
    """Detect face using processor helper first, then OpenCV cascade fallback."""
    if _processor_detect_face is not None:
        try:
            face = _processor_detect_face(image)
            if face:
                return face
        except Exception:
            pass

    if cv2 is None:
        return None

    try:
        rgb = np.array(image.convert("RGB"))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        cascade = _get_face_cascade()
        if cascade is None:
            return None

        faces = cascade.detectMultiScale(
            gray,
            scaleFactor=1.08,
            minNeighbors=4,
            minSize=(24, 24),
        )
        if len(faces) == 0:
            return None

        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        return {
            "face_height": float(h),
            "face_center_x": float(x + w / 2.0),
            "chin_y": float(y + h),
        }
    except Exception:
        return None


def _segment_hair_top(image: Image.Image):
    """Return estimated top y of person mask; fallback for missing processor helper."""
    if _processor_segment_hair_top is not None:
        try:
            return _processor_segment_hair_top(image)
        except Exception:
            pass

    if cv2 is None:
        return None

    try:
        rgb = np.array(image.convert("RGB"))
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        mask = _person_mask_from_segmentation(bgr)
        if mask is None:
            return None
        ys, _ = np.where(mask > 0)
        if ys.size == 0:
            return None
        return int(ys.min())
    except Exception:
        return None


def _order_quad_points(pts: np.ndarray) -> np.ndarray:
    """Return points ordered as top-left, top-right, bottom-right, bottom-left."""
    pts = pts.astype(np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).reshape(-1)

    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = pts[np.argmin(s)]
    ordered[2] = pts[np.argmax(s)]
    ordered[1] = pts[np.argmin(d)]
    ordered[3] = pts[np.argmax(d)]
    return ordered


def _expand_quad(quad: np.ndarray, img_w: int, img_h: int, factor: float = 1.03) -> np.ndarray:
    """Slightly expand a detected quad to avoid clipping edges of the printed photo."""
    c = quad.mean(axis=0)
    expanded = c + (quad - c) * factor
    expanded[:, 0] = np.clip(expanded[:, 0], 0, img_w - 1)
    expanded[:, 1] = np.clip(expanded[:, 1], 0, img_h - 1)
    return expanded.astype(np.float32)


def _warp_quad(bgr: np.ndarray, quad: np.ndarray):
    """Perspective-warp a 4-point region into a rectified image."""
    if cv2 is None:
        return None

    q = _order_quad_points(quad)
    (tl, tr, br, bl) = q

    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_w = int(round(max(width_a, width_b)))

    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_h = int(round(max(height_a, height_b)))

    if max_w < _MIN_OUTPUT_SIDE or max_h < _MIN_OUTPUT_SIDE:
        return None

    dst = np.array(
        [[0, 0], [max_w - 1, 0], [max_w - 1, max_h - 1], [0, max_h - 1]],
        dtype=np.float32,
    )

    mat = cv2.getPerspectiveTransform(q, dst)
    return cv2.warpPerspective(bgr, mat, (max_w, max_h), flags=cv2.INTER_CUBIC)


def _trim_white_border(bgr: np.ndarray) -> np.ndarray:
    """Trim near-white border around a rectified photo."""
    if cv2 is None:
        return bgr

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    mask = gray < _WHITE_TRIM_THRESHOLD
    ys, xs = np.where(mask)

    if ys.size == 0 or xs.size == 0:
        return bgr

    y0 = max(int(ys.min()) - 2, 0)
    y1 = min(int(ys.max()) + 3, bgr.shape[0])
    x0 = max(int(xs.min()) - 2, 0)
    x1 = min(int(xs.max()) + 3, bgr.shape[1])

    if (x1 - x0) < _MIN_OUTPUT_SIDE or (y1 - y0) < _MIN_OUTPUT_SIDE:
        return bgr

    return bgr[y0:y1, x0:x1]


def _trim_blank_bottom_rows(bgr: np.ndarray) -> np.ndarray:
    """Trim a trailing paper-like bottom strip while preserving content."""
    if cv2 is None:
        return bgr

    h, w = bgr.shape[:2]
    if h < _MIN_OUTPUT_SIDE:
        return bgr

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    s = hsv[:, :, 1]
    v = hsv[:, :, 2]

    max_scan = min(h // 3, 140)
    cut = h

    for y in range(h - 1, h - max_scan - 1, -1):
        sat_low = float(np.mean(s[y, :] < 28))
        bright = float(np.mean(v[y, :] > 208))

        if sat_low > 0.88 and bright > 0.82:
            cut = y
            continue
        break

    if cut < h and cut >= _MIN_OUTPUT_SIDE:
        trimmed = bgr[:cut, :]
        if trimmed.shape[0] >= _MIN_OUTPUT_SIDE:
            return trimmed

    return bgr


def _largest_component_mask(mask: np.ndarray) -> np.ndarray:
    """Keep only the largest connected component in a binary mask."""
    if cv2 is None:
        return mask

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if num_labels <= 1:
        return mask

    largest_label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    out = np.zeros_like(mask, dtype=np.uint8)
    out[labels == largest_label] = 255
    return out


def _person_mask_from_segmentation(bgr: np.ndarray):
    """Return binary person mask via MediaPipe selfie segmentation (when available)."""
    if cv2 is None:
        return None

    segmenter = _get_selfie_segmenter()
    if segmenter is None:
        return None

    try:
        h, w = bgr.shape[:2]
        scale = min(1.0, 960.0 / float(max(h, w)))
        if scale < 1.0:
            resized = cv2.resize(
                bgr,
                (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
                interpolation=cv2.INTER_AREA,
            )
        else:
            resized = bgr

        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        result = segmenter.process(rgb)
        if result is None or getattr(result, "segmentation_mask", None) is None:
            return None

        mask = (result.segmentation_mask >= _SEGMENTATION_THRESHOLD).astype(np.uint8) * 255
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = _largest_component_mask(mask)

        if scale < 1.0:
            mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)

        return mask
    except Exception:
        return None


def _mask_bbox(mask: np.ndarray):
    ys, xs = np.where(mask > 0)
    if ys.size == 0 or xs.size == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _fit_portrait_bbox(
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    img_w: int,
    img_h: int,
    pad: float = 1.08,
) -> Tuple[int, int, int, int]:
    """Expand and normalize bbox to portrait aspect while clamping to image bounds."""
    ex0, ey0, ex1, ey1 = _expand_bbox(x0, y0, x1, y1, img_w, img_h, factor=pad)

    bw = max(1, ex1 - ex0)
    bh = max(1, ey1 - ey0)
    cx = (ex0 + ex1) / 2.0
    cy = (ey0 + ey1) / 2.0

    ratio = bw / float(max(1, bh))
    if ratio < _TARGET_PORTRAIT_RATIO:
        bw = int(round(bh * _TARGET_PORTRAIT_RATIO))
    else:
        bh = int(round(bw / _TARGET_PORTRAIT_RATIO))

    nx0 = int(round(cx - bw / 2.0))
    ny0 = int(round(cy - bh / 2.0))
    nx1 = nx0 + bw
    ny1 = ny0 + bh

    if nx0 < 0:
        nx1 -= nx0
        nx0 = 0
    if ny0 < 0:
        ny1 -= ny0
        ny0 = 0
    if nx1 > img_w:
        shift = nx1 - img_w
        nx0 = max(0, nx0 - shift)
        nx1 = img_w
    if ny1 > img_h:
        shift = ny1 - img_h
        ny0 = max(0, ny0 - shift)
        ny1 = img_h

    return nx0, ny0, nx1, ny1


def _trim_sparse_edges(bgr: np.ndarray) -> np.ndarray:
    """Trim sparse empty paper edges left after warping and perspective fixes."""
    if cv2 is None:
        return bgr

    h, w = bgr.shape[:2]
    if h < _MIN_OUTPUT_SIDE or w < _MIN_OUTPUT_SIDE:
        return bgr

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    content = (gray < 242) | (hsv[:, :, 1] > 28)

    row_ratio = content.mean(axis=1)
    col_ratio = content.mean(axis=0)

    y0 = 0
    y1 = h
    x0 = 0
    x1 = w

    min_row_content = 0.035
    min_col_content = 0.03

    max_trim_y = min(h // 4, 120)
    max_trim_x = min(w // 5, 120)

    while y0 < max_trim_y and y0 < (h - _MIN_OUTPUT_SIDE) and row_ratio[y0] < min_row_content:
        y0 += 1
    while (h - y1) < max_trim_y and y1 > (_MIN_OUTPUT_SIDE) and row_ratio[y1 - 1] < min_row_content:
        y1 -= 1
    while x0 < max_trim_x and x0 < (w - _MIN_OUTPUT_SIDE) and col_ratio[x0] < min_col_content:
        x0 += 1
    while (w - x1) < max_trim_x and x1 > (_MIN_OUTPUT_SIDE) and col_ratio[x1 - 1] < min_col_content:
        x1 -= 1

    if (x1 - x0) >= _MIN_OUTPUT_SIDE and (y1 - y0) >= _MIN_OUTPUT_SIDE:
        return bgr[y0:y1, x0:x1]
    return bgr


def _crop_to_person_segmentation_box(bgr: np.ndarray):
    """Crop candidate around segmented person region when segmentation is available."""
    if cv2 is None:
        return None

    mask = _person_mask_from_segmentation(bgr)
    if mask is None:
        return None

    area_ratio = float(np.mean(mask > 0))
    if area_ratio < _SEGMENTATION_MIN_AREA_RATIO or area_ratio > _SEGMENTATION_MAX_AREA_RATIO:
        return None

    bbox = _mask_bbox(mask)
    if bbox is None:
        return None

    h, w = bgr.shape[:2]
    x0, y0, x1, y1 = _fit_portrait_bbox(*bbox, w, h, pad=1.10)
    if (x1 - x0) < _MIN_OUTPUT_SIDE or (y1 - y0) < _MIN_OUTPUT_SIDE:
        return None

    return bgr[y0:y1, x0:x1]


def _passes_person_quality_gate(bgr: np.ndarray) -> bool:
    """Validate that the crop is person-focused and not mostly borders/page."""
    if bgr is None or bgr.size == 0:
        return False

    h, w = bgr.shape[:2]
    if h < _MIN_OUTPUT_SIDE or w < _MIN_OUTPUT_SIDE:
        return False

    mask = _person_mask_from_segmentation(bgr)
    face_ratio = _face_coverage_ratio(bgr)
    if face_ratio < _MIN_FACE_COVERAGE_RATIO and mask is None:
        return False
    if mask is None:
        return True

    area_ratio = float(np.mean(mask > 0))
    if area_ratio < _SEGMENTATION_MIN_AREA_RATIO or area_ratio > _SEGMENTATION_MAX_AREA_RATIO:
        return False

    # If face detector was weak, accept only when segmentation strongly supports a person crop.
    if face_ratio < _MIN_FACE_COVERAGE_RATIO:
        if area_ratio < 0.16 or area_ratio > 0.80:
            return False

    t = max(2, min(14, min(h, w) // 22))
    border = np.concatenate(
        [
            mask[:t, :].reshape(-1),
            mask[-t:, :].reshape(-1),
            mask[:, :t].reshape(-1),
            mask[:, -t:].reshape(-1),
        ]
    )
    border_touch = float(np.mean(border > 0)) if border.size else 0.0
    if border_touch > _SEGMENTATION_BORDER_TOUCH_RATIO and area_ratio > 0.60:
        return False

    return True


def _post_pick_cleanup_pipeline(candidate: np.ndarray):
    """Multi-step cleanup pipeline: trim -> segment -> face tighten -> border cleanup -> validate."""
    if candidate is None or candidate.size == 0:
        return None

    cleaned = _trim_white_border(candidate)
    cleaned = _trim_blank_bottom_rows(cleaned)
    cleaned = _trim_sparse_edges(cleaned)

    seg_crop = _crop_to_person_segmentation_box(cleaned)
    if seg_crop is not None:
        cleaned = seg_crop
    else:
        cleaned = _tighten_crop_to_person_photo(cleaned)

    cleaned = _trim_white_border(cleaned)
    cleaned = _trim_blank_bottom_rows(cleaned)
    cleaned = _trim_sparse_edges(cleaned)
    cleaned = _tighten_crop_to_person_photo(cleaned)

    if not _passes_person_quality_gate(cleaned):
        return None
    return cleaned


def _face_coverage_ratio(bgr: np.ndarray) -> float:
    """
    Return an approximate face-to-crop area ratio.

    This helps reject whole-page crops that merely *contain* a face.
    """
    try:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB) if cv2 is not None else bgr
        pil = Image.fromarray(rgb)
        face = _detect_face(pil)
        if not face:
            return 0.0

        face_h = float(face.get("face_height") or 0.0)
        if face_h <= 0.0:
            return 0.0

        h, w = bgr.shape[:2]
        crop_area = float(max(1, h * w))

        # Approximate frontal face area from mesh height.
        est_face_area = face_h * face_h * 0.72
        return est_face_area / crop_area
    except Exception:
        return 0.0


def _is_page_like_box(x: int, y: int, bw: int, bh: int, img_w: int, img_h: int) -> bool:
    """Heuristic: reject candidates that are effectively the full document page."""
    pad_x = max(8, int(img_w * 0.015))
    pad_y = max(8, int(img_h * 0.015))

    near_left = x <= pad_x
    near_top = y <= pad_y
    near_right = (x + bw) >= (img_w - pad_x)
    near_bottom = (y + bh) >= (img_h - pad_y)

    return near_left and near_top and near_right and near_bottom


def _expand_bbox(
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    img_w: int,
    img_h: int,
    factor: float,
) -> Tuple[int, int, int, int]:
    """Expand a bounding box around its center and clamp to image bounds."""
    bw = max(1, x1 - x0)
    bh = max(1, y1 - y0)
    cx = (x0 + x1) / 2.0
    cy = (y0 + y1) / 2.0

    new_w = max(1, int(round(bw * factor)))
    new_h = max(1, int(round(bh * factor)))

    nx0 = int(round(cx - new_w / 2.0))
    ny0 = int(round(cy - new_h / 2.0))
    nx1 = nx0 + new_w
    ny1 = ny0 + new_h

    if nx0 < 0:
        nx1 -= nx0
        nx0 = 0
    if ny0 < 0:
        ny1 -= ny0
        ny0 = 0
    if nx1 > img_w:
        shift = nx1 - img_w
        nx0 = max(0, nx0 - shift)
        nx1 = img_w
    if ny1 > img_h:
        shift = ny1 - img_h
        ny0 = max(0, ny0 - shift)
        ny1 = img_h

    return nx0, ny0, nx1, ny1


def _face_guided_fallback_crop(bgr: np.ndarray):
    """
    Recover a likely pasted-photo crop when edge/contour detection misses it.

    Strategy:
      1) detect face on full page,
      2) try non-white connected component around face center,
      3) fallback to a face-proportional portrait box.
    """
    if cv2 is None:
        return None

    h, w = bgr.shape[:2]

    try:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        face = _detect_face(Image.fromarray(rgb))
    except Exception:
        face = None

    if not face:
        return None

    face_h = float(face.get("face_height") or 0.0)
    cx = float(face.get("face_center_x") or (w / 2.0))
    chin_y = float(face.get("chin_y") or (h / 2.0))

    if face_h < 20:
        return None

    comp_crop = None
    try:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        mask = (gray < _WHITE_TRIM_THRESHOLD).astype(np.uint8) * 255
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)

        fx = int(np.clip(round(cx), 0, w - 1))
        fy = int(np.clip(round(chin_y - face_h * 0.45), 0, h - 1))
        face_label = int(labels[fy, fx]) if num_labels > 1 else 0

        if face_label > 0:
            x = int(stats[face_label, cv2.CC_STAT_LEFT])
            y = int(stats[face_label, cv2.CC_STAT_TOP])
            bw = int(stats[face_label, cv2.CC_STAT_WIDTH])
            bh = int(stats[face_label, cv2.CC_STAT_HEIGHT])
            area = float(stats[face_label, cv2.CC_STAT_AREA])
            area_ratio = area / float(max(1, w * h))

            if (
                bw >= int(_MIN_OUTPUT_SIDE * 0.7)
                and bh >= int(_MIN_OUTPUT_SIDE * 0.7)
                and area_ratio <= _MAX_REGION_AREA_RATIO
                and not _is_page_like_box(x, y, bw, bh, w, h)
            ):
                ex0, ey0, ex1, ey1 = _expand_bbox(x, y, x + bw, y + bh, w, h, factor=1.10)
                comp_crop = bgr[ey0:ey1, ex0:ex1]
    except Exception:
        comp_crop = None

    if comp_crop is not None and comp_crop.size > 0:
        return comp_crop

    # Face-proportional portrait fallback.
    # Keep generous top headroom here; later refinement will tighten safely.
    top = int(round(chin_y - face_h * 1.65))
    bottom = int(round(chin_y + face_h * 0.95))

    y0 = max(0, top)
    y1 = min(h, bottom)
    if y1 - y0 < _MIN_OUTPUT_SIDE:
        return None

    crop_h = y1 - y0
    crop_w = int(round(crop_h * (35.0 / 45.0)))
    crop_w = max(_MIN_OUTPUT_SIDE, crop_w)

    x0 = int(round(cx - crop_w / 2.0))
    x1 = x0 + crop_w

    if x0 < 0:
        x1 -= x0
        x0 = 0
    if x1 > w:
        shift = x1 - w
        x0 = max(0, x0 - shift)
        x1 = w

    if (x1 - x0) < _MIN_OUTPUT_SIDE:
        return None

    if _is_page_like_box(x0, y0, x1 - x0, y1 - y0, w, h):
        return None

    return bgr[y0:y1, x0:x1]


def _tighten_crop_to_person_photo(bgr: np.ndarray) -> np.ndarray:
    """
    Tighten a candidate crop around the detected face to reduce extra page text.

    If no stable face-based refinement is possible, return the original crop.
    """
    if cv2 is None:
        return bgr

    h, w = bgr.shape[:2]
    if h < _MIN_OUTPUT_SIDE or w < _MIN_OUTPUT_SIDE:
        return bgr

    try:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        face = _detect_face(Image.fromarray(rgb))
    except Exception:
        face = None

    if not face:
        return bgr

    face_h = float(face.get("face_height") or 0.0)
    cx = float(face.get("face_center_x") or (w / 2.0))
    chin_y = float(face.get("chin_y") or (h / 2.0))

    if face_h < 18:
        return bgr

    # Build a face-anchored portrait window and keep extra top safety room.
    top = int(round(chin_y - face_h * 1.55))
    bottom = int(round(chin_y + face_h * 1.20))

    # If segmentation is available, anchor top above actual hair crown.
    try:
        hair_top = _segment_hair_top(Image.fromarray(rgb))
    except Exception:
        hair_top = None

    if hair_top is not None:
        hair_margin = max(10, int(round(face_h * 0.14)))
        seg_top = int(hair_top - hair_margin)

        # Allow moving upward for hair, but cap extreme expansion.
        max_upward = int(round(chin_y - face_h * 2.10))
        top = max(max_upward, min(top, seg_top))
    y0 = max(0, top)
    y1 = min(h, bottom)
    if (y1 - y0) < _MIN_OUTPUT_SIDE:
        return bgr

    target_ratio = 35.0 / 45.0
    crop_h = y1 - y0
    crop_w = int(round(crop_h * target_ratio))
    crop_w = max(_MIN_OUTPUT_SIDE, crop_w)

    x0 = int(round(cx - crop_w / 2.0))
    x1 = x0 + crop_w

    if x0 < 0:
        x1 -= x0
        x0 = 0
    if x1 > w:
        shift = x1 - w
        x0 = max(0, x0 - shift)
        x1 = w

    if (x1 - x0) < _MIN_OUTPUT_SIDE:
        return bgr

    refined = bgr[y0:y1, x0:x1]

    # Keep refinement only if it is at least as face-dense as original.
    try:
        old_ratio = _face_coverage_ratio(bgr)
        new_ratio = _face_coverage_ratio(refined)
        if new_ratio + 1e-6 >= old_ratio:
            return refined
    except Exception:
        return refined

    return bgr


def _bbox_iou(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b

    ix0 = max(ax0, bx0)
    iy0 = max(ay0, by0)
    ix1 = min(ax1, bx1)
    iy1 = min(ay1, by1)

    iw = max(0, ix1 - ix0)
    ih = max(0, iy1 - iy0)
    inter = iw * ih
    if inter == 0:
        return 0.0

    area_a = max(1, (ax1 - ax0) * (ay1 - ay0))
    area_b = max(1, (bx1 - bx0) * (by1 - by0))
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _quad_to_bbox(quad: np.ndarray) -> Tuple[int, int, int, int]:
    xs = quad[:, 0]
    ys = quad[:, 1]
    return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))


def _find_quad_candidates(bgr: np.ndarray) -> List[np.ndarray]:
    """
    Detect quadrilateral regions likely to be printed photos on paper.

    Uses edge + contour approximation and keeps sizeable convex 4-point regions.
    """
    if cv2 is None:
        return []

    h, w = bgr.shape[:2]
    img_area = float(w * h)

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    edges = cv2.Canny(blur, 45, 140)

    kernel = np.ones((3, 3), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    quads: List[np.ndarray] = []
    seen_boxes: List[Tuple[int, int, int, int]] = []

    for cnt in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(cnt)
        if area < img_area * _MIN_REGION_AREA_RATIO:
            continue
        if area > img_area * _MAX_REGION_AREA_RATIO:
            continue

        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)

        if len(approx) != 4:
            continue
        if not cv2.isContourConvex(approx):
            continue

        quad = approx.reshape(4, 2).astype(np.float32)

        x, y, bw, bh = cv2.boundingRect(approx)
        if bw < _MIN_OUTPUT_SIDE or bh < _MIN_OUTPUT_SIDE:
            continue
        if _is_page_like_box(x, y, bw, bh, w, h):
            continue

        ratio = bw / float(max(1, bh))
        if ratio < 0.45 or ratio > 1.8:
            continue

        bbox = _quad_to_bbox(quad)
        if any(_bbox_iou(bbox, prev) > 0.65 for prev in seen_boxes):
            continue

        seen_boxes.append(bbox)
        quads.append(quad)

        if len(quads) >= _MAX_CANDIDATES_PER_PAGE:
            break

    return quads


def _find_axis_aligned_fallback_boxes(bgr: np.ndarray) -> List[Tuple[int, int, int, int]]:
    """Fallback detector for near-rectangular but weak-edge pages."""
    if cv2 is None:
        return []

    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # Photos usually differ from paper tone; this isolates non-paper regions.
    mask = (gray < 245).astype(np.uint8) * 255
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    boxes: List[Tuple[int, int, int, int]] = []
    min_area = float(w * h) * _MIN_REGION_AREA_RATIO

    for cnt in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(cnt)
        if area < min_area:
            continue
        if area > (float(w * h) * _MAX_REGION_AREA_RATIO):
            continue

        x, y, bw, bh = cv2.boundingRect(cnt)
        if bw < _MIN_OUTPUT_SIDE or bh < _MIN_OUTPUT_SIDE:
            continue
        if _is_page_like_box(x, y, bw, bh, w, h):
            continue

        ratio = bw / float(max(1, bh))
        if ratio < 0.45 or ratio > 1.8:
            continue

        box = (x, y, x + bw, y + bh)
        if any(_bbox_iou(box, prev) > 0.7 for prev in boxes):
            continue

        boxes.append(box)
        if len(boxes) >= _MAX_CANDIDATES_PER_PAGE:
            break

    return boxes


def _extract_photos_from_page(image_path: Path) -> Tuple[List[np.ndarray], str]:
    """Extract perspective-corrected photo patches from one scanned page image."""
    bgr = _read_image_bgr(image_path)
    if bgr is None:
        return [], "Unreadable image"

    h, w = bgr.shape[:2]
    accepted: List[np.ndarray] = []

    for quad in _find_quad_candidates(bgr):
        quad = _expand_quad(quad, w, h)
        warped = _warp_quad(bgr, quad)
        if warped is None:
            continue

        warped = _trim_white_border(warped)
        if warped.shape[0] < _MIN_OUTPUT_SIDE or warped.shape[1] < _MIN_OUTPUT_SIDE:
            continue

        # Keep only regions with meaningful face occupancy, unless segmentation strongly confirms a person.
        if _face_coverage_ratio(warped) < _MIN_FACE_COVERAGE_RATIO and _person_mask_from_segmentation(warped) is None:
            continue

        refined = _post_pick_cleanup_pipeline(warped)
        if refined is not None:
            accepted.append(refined)

    if accepted:
        return accepted[:_MAX_PHOTOS_PER_PAGE], ""

    # Fallback: axis-aligned boxes where perspective cues were weak.
    for x0, y0, x1, y1 in _find_axis_aligned_fallback_boxes(bgr):
        crop = bgr[y0:y1, x0:x1]
        crop = _trim_white_border(crop)
        if crop.shape[0] < _MIN_OUTPUT_SIDE or crop.shape[1] < _MIN_OUTPUT_SIDE:
            continue
        if _face_coverage_ratio(crop) < _MIN_FACE_COVERAGE_RATIO and _person_mask_from_segmentation(crop) is None:
            continue
        refined = _post_pick_cleanup_pipeline(crop)
        if refined is not None:
            accepted.append(refined)

    if accepted:
        return accepted[:_MAX_PHOTOS_PER_PAGE], ""

    # Fallback 2: face-guided region when rectangular page edges are weak.
    guided = _face_guided_fallback_crop(bgr)
    if guided is not None and guided.size > 0:
        guided = _trim_white_border(guided)
        if guided.shape[0] >= _MIN_OUTPUT_SIDE and guided.shape[1] >= _MIN_OUTPUT_SIDE:
            if _face_coverage_ratio(guided) >= _MIN_FACE_COVERAGE_RATIO or _person_mask_from_segmentation(guided) is not None:
                refined = _post_pick_cleanup_pipeline(guided)
                if refined is not None:
                    accepted.append(refined)

    if accepted:
        return accepted[:_MAX_PHOTOS_PER_PAGE], ""

    return [], "No valid person-only photo region found"


def _iter_input_images(folder: Path) -> List[Path]:
    images: List[Path] = []
    for entry in folder.iterdir():
        if not entry.is_file():
            continue
        if entry.name.startswith(".") or entry.name.startswith("__"):
            continue
        if entry.suffix.lower() in config.ALLOWED_IMAGE_EXTENSIONS:
            images.append(entry)
    images.sort()
    return images


def _sanitize_photos_per_page(value: int | None) -> int:
    """Clamp requested photos-per-page to supported range."""
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = _DEFAULT_PHOTOS_PER_PAGE

    return max(1, min(_MAX_PHOTOS_PER_PAGE, numeric))


def _create_blank_passport_patch(reference: np.ndarray | None = None) -> np.ndarray:
    """Create a plain white portrait patch used when a page has missing detections."""
    if reference is not None and getattr(reference, "shape", None) is not None:
        h, w = reference.shape[:2]
        if h >= _MIN_OUTPUT_SIDE and w >= _MIN_OUTPUT_SIDE:
            return np.full((h, w, 3), 255, dtype=np.uint8)

    return np.full((_PASSPORT_BOX_HEIGHT, _PASSPORT_BOX_WIDTH, 3), 255, dtype=np.uint8)


def _clear_previous_outputs(folder: Path) -> None:
    """Remove files from a prior run so each run produces a clean result set."""
    try:
        for item in folder.iterdir():
            if item.is_file():
                item.unlink(missing_ok=True)
    except Exception:
        logger.warning("Could not fully clear previous output folder: %s", folder)


def pick_page_photos_in_folder(folder_path: str, photos_per_page: int = _DEFAULT_PHOTOS_PER_PAGE) -> Dict[str, Any]:
    """
    Extract person-photo patches from every page image in a folder.

    Output folders:
      - If photos_per_page == 1: <folder>/picked
      - If photos_per_page == 2: <folder>/picked_1 and <folder>/picked_2
      - If photos_per_page == 3: <folder>/picked_1, <folder>/picked_2, <folder>/picked_3
      - <folder>/failed (for pages with no valid photos)
    """
    folder = Path(folder_path).resolve()
    if not folder.exists():
        raise FileNotFoundError(f"Folder not found: {folder_path}")
    if not folder.is_dir():
        raise ValueError(f"Path is not a directory: {folder_path}")

    if cv2 is None:
        raise RuntimeError("OpenCV (cv2) is required for page photo picker")

    photos_per_page = _sanitize_photos_per_page(photos_per_page)

    # Create output folders based on photos_per_page
    if photos_per_page == 1:
        picked_dirs = [folder / "picked"]
    else:
        picked_dirs = [folder / f"picked_{i}" for i in range(1, photos_per_page + 1)]
    
    failed_dir = folder / "failed"
    
    # Create all directories
    for picked_dir in picked_dirs:
        picked_dir.mkdir(parents=True, exist_ok=True)
        _clear_previous_outputs(picked_dir)
    
    failed_dir.mkdir(parents=True, exist_ok=True)
    _clear_previous_outputs(failed_dir)

    input_images = _iter_input_images(folder)
    if not input_images:
        output_folder_str = str(picked_dirs[0]) if photos_per_page == 1 else ", ".join(str(d) for d in picked_dirs)
        return {
            "total": 0,
            "success": 0,
            "failed": 0,
            "accuracy": 0.0,
            "output_folder": output_folder_str,
            "output_folders": [str(d) for d in picked_dirs],
            "failed_folder": str(failed_dir),
            "processing_time": 0.0,
            "errors": [],
            "picked_files": [],
            "pages_processed": 0,
            "pages_success": 0,
            "pages_failed": 0,
            "photos_per_page": photos_per_page,
            "photos_extracted": 0,
            "photos_written": 0,
            "placeholders_generated": 0,
            "pipeline_steps": [
                "quad_or_fallback_detection",
                "perspective_or_axis_crop",
                "selfie_segmentation_person_refine",
                "face_tighten_fallback",
                "edge_trim_and_quality_gate",
            ],
        }

    t0 = time.perf_counter()
    errors: List[str] = []
    picked_files: List[str] = []

    pages_processed = 0
    pages_failed = 0
    photos_extracted = 0
    photos_written = 0
    placeholders_generated = 0

    for src in input_images:
        pages_processed += 1
        patches, reason = _extract_photos_from_page(src)

        detected_count = len(patches)

        if detected_count == 0:
            pages_failed += 1
            errors.append(f"{src.name}: {reason}")
            try:
                shutil.copy2(src, failed_dir / src.name)
            except Exception:

                pass

        selected_patches = list(patches[:photos_per_page])
        missing = max(0, photos_per_page - len(selected_patches))
        if missing > 0:
            reference_patch = selected_patches[0] if selected_patches else None
            for _ in range(missing):
                selected_patches.append(_create_blank_passport_patch(reference_patch))
            placeholders_generated += missing

        if not selected_patches:
            continue

        stem = src.stem
        for idx, patch in enumerate(selected_patches, start=1):
            # Determine which folder to save to
            target_dir = picked_dirs[idx - 1] if idx <= len(picked_dirs) else picked_dirs[-1]
            
            # Keep original filename without _1, _2, _3 suffix
            out_name = f"{stem}.jpg"
            out_path = target_dir / out_name

            # Keep names collision-safe if re-running in same folder
            suffix = 1
            while out_path.exists():
                out_name = f"{stem}_{suffix}.jpg"
                out_path = target_dir / out_name
                suffix += 1

            rgb = cv2.cvtColor(patch, cv2.COLOR_BGR2RGB)
            Image.fromarray(rgb).save(out_path, quality=100, optimize=False)

            picked_files.append(out_name)
            photos_written += 1

        photos_extracted += min(detected_count, photos_per_page)

    elapsed = round(time.perf_counter() - t0, 2)
    pages_success = max(0, pages_processed - pages_failed)
    total = pages_processed
    accuracy = round((pages_success / total) * 100, 2) if total else 0.0

    output_folder_str = str(picked_dirs[0]) if photos_per_page == 1 else ", ".join(str(d) for d in picked_dirs)

    return {
        "total": total,
        "success": pages_success,
        "failed": pages_failed,
        "accuracy": accuracy,
        "output_folder": output_folder_str,
        "output_folders": [str(d) for d in picked_dirs],
        "failed_folder": str(failed_dir),
        "processing_time": elapsed,
        "errors": errors[:200],
        "picked_files": sorted(picked_files),
        "pages_processed": pages_processed,
        "pages_success": pages_success,
        "pages_failed": pages_failed,
        "photos_per_page": photos_per_page,
        "photos_extracted": photos_extracted,
        "photos_written": photos_written,
        "placeholders_generated": placeholders_generated,
        "pipeline_steps": [
            "quad_or_fallback_detection",
            "perspective_or_axis_crop",
            "selfie_segmentation_person_refine",
            "face_tighten_fallback",
            "edge_trim_and_quality_gate",
        ],
    }
