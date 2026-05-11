"""
Service layer for the Adarsh Engine.

Each service module wraps core processing logic with validation and
consistent return shapes for API endpoints.
"""

from .cropper_service import process_zip, process_folder
from .page_picker_service import pick_page_photos
from .compressor_service import compress_folder
from .renamer_service import rename_preview, rename_execute, get_supported_operations
from .editor_service import adjust_image
from .auto_adjust_service import auto_levels, auto_adjust_image
from .file_ops_service import build_download_zip, delete_image, save_edited_image
from .preview_service import preview_folder, resolve_image_file
from .face_aware_service import batch_auto_fix_folder

__all__ = [
    "process_zip",
    "process_folder",
    "pick_page_photos",
    "compress_folder",
    "rename_preview",
    "rename_execute",
    "get_supported_operations",
    "adjust_image",
    "auto_levels",
    "auto_adjust_image",
    "build_download_zip",
    "delete_image",
    "save_edited_image",
    "preview_folder",
    "resolve_image_file",
    "batch_auto_fix_folder",
]
