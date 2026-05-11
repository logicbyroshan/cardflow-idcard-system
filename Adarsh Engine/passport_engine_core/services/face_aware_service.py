"""
Face-Aware Auto-Fix Service
============================

Uses MediaPipe Face Detection to identify face regions in images,
then applies intelligent adjustments optimized for portrait photography:
- Face-focused histogram analysis (better lighting for faces)
- Gentle skin tone enhancement
- Eye and face region highlighting
- Professional "glowing" effect

Best results with portrait/headshot images.
"""

from __future__ import annotations

import logging
import numpy as np
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import cv2

try:
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    MEDIAPIPE_AVAILABLE = False

from .common import ensure_image_file

logger = logging.getLogger(__name__)

# MediaPipe Face Detection model (lightweight)
_face_detector = None
_mp_drawing = None


def _get_face_detector():
    """Lazy-load MediaPipe face detector."""
    global _face_detector, _mp_drawing
    
    if not MEDIAPIPE_AVAILABLE:
        return None
    
    if _face_detector is None:
        try:
            from mediapipe.tasks.python import vision
            model_path = None  # Use default bundled model
            base_options = mp.tasks.BaseOptions(model_asset_path=model_path)
            options = vision.FaceDetectorOptions(base_options=base_options)
            _face_detector = vision.FaceDetector.create_from_options(options)
        except Exception as e:
            logger.warning("Failed to initialize MediaPipe face detector: %s", e)
            return None
    
    return _face_detector


def detect_faces(image_cv: np.ndarray) -> list[Dict[str, Any]]:
    """
    Detect faces in image using MediaPipe.
    
    Args:
        image_cv: OpenCV image (BGR format)
    
    Returns:
        List of face detection results with bounding boxes
    """
    if not MEDIAPIPE_AVAILABLE:
        logger.warning("MediaPipe not available, face detection disabled")
        return []
    
    detector = _get_face_detector()
    if detector is None:
        return []
    
    try:
        # Convert BGR to RGB
        rgb_image = cv2.cvtColor(image_cv, cv2.COLOR_BGR2RGB)
        
        # Create MediaPipe image
        from mediapipe import Image as MPImage
        mp_image = MPImage(image_format=mp.ImageFormat.SRGB, data=rgb_image)
        
        # Detect faces
        detection_result = detector.detect(mp_image)
        
        faces = []
        if detection_result.detections:
            h, w = rgb_image.shape[:2]
            for detection in detection_result.detections:
                bbox = detection.bounding_box
                # Convert normalized coords to pixel coords
                x_min = int(bbox.origin_x * w)
                y_min = int(bbox.origin_y * h)
                x_max = int((bbox.origin_x + bbox.width) * w)
                y_max = int((bbox.origin_y + bbox.height) * h)
                
                # Clamp to image bounds
                x_min = max(0, x_min)
                y_min = max(0, y_min)
                x_max = min(w, x_max)
                y_max = min(h, y_max)
                
                faces.append({
                    'x_min': x_min,
                    'y_min': y_min,
                    'x_max': x_max,
                    'y_max': y_max,
                    'confidence': detection.categories[0].score if detection.categories else 0.0,
                    'area': (x_max - x_min) * (y_max - y_min),
                })
        
        return faces
    
    except Exception as e:
        logger.warning("Face detection failed: %s", e)
        return []


def calculate_face_aware_histogram(image_path: str, face_region: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Calculate histogram focusing on face region for better lighting.
    
    Args:
        image_path: Path to image
        face_region: Face bounding box {x_min, y_min, x_max, y_max}
    
    Returns:
        Auto-levels parameters optimized for face region
    """
    img = cv2.imread(str(image_path))
    if img is None:
        return {"success": False, "error": "Failed to read image"}
    
    # Get histogram ROI (region of interest)
    if face_region and face_region.get('x_max') > face_region.get('x_min'):
        roi = img[
            face_region['y_min']:face_region['y_max'],
            face_region['x_min']:face_region['x_max']
        ]
    else:
        roi = img
    
    if roi.size == 0:
        return {"success": False, "error": "Invalid ROI"}
    
    # Calculate luminance histogram (Y from YCrCb)
    yuv = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
    y_channel = yuv[:, :, 0].astype(np.float32)
    
    # Calculate histogram
    hist, _ = np.histogram(y_channel, bins=256, range=(0, 256))
    hist = hist.astype(np.float32)
    
    # Cumulative distribution function
    cdf = np.cumsum(hist)
    cdf_normalized = cdf / cdf[-1]
    
    # Find 1% and 99% points (ignore extreme outliers)
    threshold_low = 0.01
    threshold_high = 0.99
    
    black_point = np.argmax(cdf_normalized >= threshold_low)
    white_point = np.argmax(cdf_normalized >= threshold_high)
    
    # Ensure valid range
    black_point = max(0, min(black_point, 200))
    white_point = max(white_point, 55)
    white_point = min(255, white_point)
    
    if white_point <= black_point:
        white_point = black_point + 100
    
    # Calculate gamma for face brightness
    # Slightly boost to create "glowing" effect
    avg_luminance = np.mean(y_channel)
    if avg_luminance < 80:
        gamma = 1.3  # Darken → brighten more
    elif avg_luminance > 180:
        gamma = 0.85  # Bright → subtle darkening
    else:
        gamma = 1.0  # Mid-tones → neutral
    
    # Add gentle vibrance boost for face
    vibrance = 15  # Boost color in skin tones
    temperature = 5  # Subtle warm tone (professional lighting)
    
    return {
        "success": True,
        "black_point": int(black_point),
        "white_point": int(white_point),
        "gamma": round(gamma, 3),
        "vibrance": vibrance,
        "temperature": temperature,
        "face_detected": bool(face_region),
        "confidence": face_region.get('confidence', 0.0) if face_region else 0.0,
    }


def auto_fix_single_image(
    image_path: str,
    output_path: str,
    use_face_detection: bool = True,
) -> Dict[str, Any]:
    """
    Auto-fix a single image with face-awareness.
    
    Args:
        image_path: Source image path
        output_path: Output image path
        use_face_detection: Whether to use face detection for better results
    
    Returns:
        Success dict with applied parameters
    """
    from PIL import Image, ImageEnhance
    import numpy as np
    
    # Detect faces
    faces = []
    primary_face = None
    
    if use_face_detection:
        img_cv = cv2.imread(str(image_path))
        if img_cv is not None:
            faces = detect_faces(img_cv)
            if faces:
                # Use largest face for histogram
                primary_face = max(faces, key=lambda f: f['area'])
    
    # Calculate auto-levels (face-aware)
    params = calculate_face_aware_histogram(image_path, primary_face)
    if not params.get("success"):
        return params
    
    # Apply adjustments through the existing editor service.
    from .editor_service import adjust_image
    
    try:
        result = adjust_image(
            image_path=image_path,
            output_path=output_path,
            black_point=params['black_point'],
            gamma=params['gamma'],
            white_point=params['white_point'],
            vibrance=params['vibrance'],
            temperature=params['temperature'],
        )
        
        if result.get("success"):
            result.update({
                "face_detected": params.get("face_detected"),
                "face_count": len(faces),
                "applied_params": {
                    "black_point": params['black_point'],
                    "white_point": params['white_point'],
                    "gamma": params['gamma'],
                    "vibrance": params['vibrance'],
                    "temperature": params['temperature'],
                }
            })
        
        return result
    
    except Exception as e:
        logger.exception("Failed to apply adjustments: %s", e)
        return {"success": False, "error": str(e)}


def batch_auto_fix_folder(
    folder_path: str,
    use_face_detection: bool = True,
) -> Dict[str, Any]:
    """
    Apply face-aware auto-fix to all images in folder.
    
    Saves results to /edited subfolder.
    
    Args:
        folder_path: Folder containing images
        use_face_detection: Whether to use face detection
    
    Returns:
        Summary of processing results
    """
    from pathlib import Path
    from .file_ops_service import _build_edited_output
    
    folder = Path(folder_path).resolve()
    if not folder.is_dir():
        return {"success": False, "error": f"Not a directory: {folder_path}"}
    
    # Import config for allowed extensions
    from .. import config
    
    success_count = 0
    failed_count = 0
    face_detected_count = 0
    results = []
    
    # Find all images
    image_files = []
    for ext in config.ALLOWED_IMAGE_EXTENSIONS:
        image_files.extend(folder.glob(f"*{ext}"))
        image_files.extend(folder.glob(f"*{ext.upper()}"))
    
    # Remove duplicates
    image_files = list(set(image_files))
    image_files.sort()
    
    if not image_files:
        return {
            "success": False,
            "error": "No images found",
            "total": 0,
        }
    
    logger.info("Auto-fixing %d images in %s", len(image_files), folder)
    
    for image_path in image_files:
        try:
            # Build output path in /edited folder
            _edited_folder, output_path, output_name = _build_edited_output(
                str(image_path),
                image_path.name,
            )
            
            # Apply auto-fix
            result = auto_fix_single_image(
                image_path=str(image_path),
                output_path=str(output_path),
                use_face_detection=use_face_detection,
            )
            
            if result.get("success"):
                success_count += 1
                if result.get("face_detected"):
                    face_detected_count += 1
                
                results.append({
                    "filename": image_path.name,
                    "status": "success",
                    "output": output_name,
                    "face_detected": result.get("face_detected"),
                    "params": result.get("applied_params"),
                })
            else:
                failed_count += 1
                results.append({
                    "filename": image_path.name,
                    "status": "failed",
                    "error": result.get("error"),
                })
        
        except Exception as e:
            logger.exception("Failed to process %s: %s", image_path.name, e)
            failed_count += 1
            results.append({
                "filename": image_path.name,
                "status": "failed",
                "error": str(e),
            })
    
    return {
        "success": True,
        "total": len(image_files),
        "success_count": success_count,
        "failed_count": failed_count,
        "face_detected_count": face_detected_count,
        "edited_folder": str(folder / "edited"),
        "results": results,
        "summary": {
            "auto_fixed": success_count,
            "failed": failed_count,
            "with_faces": face_detected_count,
        },
    }
