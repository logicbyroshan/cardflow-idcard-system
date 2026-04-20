"""
passport_engine_core/config.py
──────────────────────────────
Application-specific constants for the Adarsh Engine (photo crop engine).
All paths are resolved relative to this package via ``__file__``.
"""

import configparser
from pathlib import Path

# ---------------------------------------------------------------------------
# Version
# ---------------------------------------------------------------------------
ENGINE_VERSION = "2.5.0"

# ---------------------------------------------------------------------------
# Path Configuration
# ---------------------------------------------------------------------------
# _PKG_DIR is the directory containing this file (passport_engine_core/).
_PKG_DIR = Path(__file__).resolve().parent

# BASE_DIR points to the project root (parent of passport_engine_core/).
BASE_DIR = _PKG_DIR.parent

# ---------------------------------------------------------------------------
# Passport Processor — Application-specific Constants
# ---------------------------------------------------------------------------

# Maximum number of images allowed in a single ZIP upload.
MAX_IMAGES_PER_ZIP = 50000

# Final passport photo dimensions in pixels (width × height).
# ISO/IEC 19794-5 common size used by many countries.
PASSPORT_WIDTH = 413
PASSPORT_HEIGHT = 531

# Target aspect ratio derived from the passport dimensions.
PASSPORT_ASPECT_RATIO = PASSPORT_WIDTH / PASSPORT_HEIGHT

# Directories under MEDIA_ROOT where processed results are stored.
MEDIA_ROOT = BASE_DIR / "media"
OUTPUT_DIR = MEDIA_ROOT / "output"
CROPPED_DIR = OUTPUT_DIR / "cropped"
FAILED_DIR = OUTPUT_DIR / "failed"

# Ensure output directories exist at import time so the processor never
# has to worry about missing folders.
for _dir in (OUTPUT_DIR, CROPPED_DIR, FAILED_DIR):
    _dir.mkdir(parents=True, exist_ok=True)

# Accepted image file extensions (lowercase).
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}

# Minimum acceptable image dimensions (width, height) in pixels.
# Images smaller than this are unlikely to produce a usable passport crop.
MIN_IMAGE_WIDTH = 200
MIN_IMAGE_HEIGHT = 200

# Maximum file size for a single image inside the ZIP (bytes).  50 MB.
MAX_IMAGE_FILE_SIZE = 50 * 1024 * 1024

# Maximum total ZIP file size accepted for upload (bytes).  5 GB.
MAX_ZIP_FILE_SIZE = 5 * 1024 * 1024 * 1024

# ---------------------------------------------------------------------------
# MediaPipe Model Paths
# ---------------------------------------------------------------------------
# Models ship alongside the package in _PKG_DIR/models/ when packaged,
# falling back to BASE_DIR/models/ for development layouts.
MODELS_DIR = (
    _PKG_DIR / "models" if (_PKG_DIR / "models").is_dir()
    else BASE_DIR / "models"
)
FACE_LANDMARKER_MODEL = MODELS_DIR / "face_landmarker.task"
FACE_DETECTOR_MODEL = MODELS_DIR / "blaze_face_short_range.tflite"
SELFIE_SEGMENTER_MODEL = MODELS_DIR / "selfie_segmenter.tflite"

# ---------------------------------------------------------------------------
# User-configured Default Output Directory
# ---------------------------------------------------------------------------
# The installer saves a config file at {app}/output_config.ini with the
# user's chosen output directory.  If present, this path is used as the
# default output location when no explicit output folder is provided.

_OUTPUT_CONFIG_FILE = BASE_DIR / "output_config.ini"

DEFAULT_OUTPUT_DIR: Path | None = None

if _OUTPUT_CONFIG_FILE.is_file():
    _cp = configparser.ConfigParser()
    try:
        _cp.read(str(_OUTPUT_CONFIG_FILE), encoding="utf-8")
        _raw = _cp.get("output", "directory", fallback="").strip()
        if _raw:
            _candidate = Path(_raw)
            _candidate.mkdir(parents=True, exist_ok=True)
            DEFAULT_OUTPUT_DIR = _candidate
    except Exception:
        pass  # Ignore malformed config — use default behaviour
