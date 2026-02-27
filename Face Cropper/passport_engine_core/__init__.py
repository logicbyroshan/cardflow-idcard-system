"""
passport_engine_core
────────────────────
Standalone passport photo cropping engine.

Quick start::

    from passport_engine_core import process_zip, process_folder

    result = process_zip("path/to/images.zip")
    result = process_folder("path/to/image_folder")
"""

from .engine import process_zip, process_folder
from .config import ENGINE_VERSION

__all__ = ["process_zip", "process_folder", "ENGINE_VERSION"]
