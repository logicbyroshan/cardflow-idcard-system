"""
ZIP Export Module

Handles ZIP file generation for ID card images.
This module is READ-ONLY - it never mutates data.

Features:
- Separate ZIP files per image field
- Base64 encoded output for JavaScript downloads
- Proper filename sanitization
- Skip invalid/missing images gracefully
- Phase 3: Prefers CardMedia, falls back to field_data
"""
import os
import re
import base64
import logging
import zipfile
from io import BytesIO
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

from django.db.models import QuerySet
from django.core.files.storage import default_storage

from mediafiles.services import ImageService

from .utils import (
    get_image_fields,
    clean_filename,
    is_valid_image_path,
)


@dataclass
class ZipFileInfo:
    """Information about a single ZIP file."""
    field_name: str
    filename: str
    data: str  # Base64 encoded
    image_count: int


@dataclass
class ZipExportResult:
    """Result of a ZIP export operation."""
    success: bool
    message: str = ''
    zip_files: List[ZipFileInfo] = field(default_factory=list)
    total_images: int = 0
    total_zips: int = 0


class ZipExporter:
    """
    Handles ZIP export operations for images.
    
    Creates separate ZIP files for each image field,
    containing all images from the selected cards.
    
    Usage:
        exporter = ZipExporter()
        result = exporter.export_images(table, cards)
        if result.success:
            for zip_info in result.zip_files:
                # zip_info.data is base64 encoded
                # zip_info.filename is the suggested filename
                pass
    """
    
    # Field name mappings for more readable filenames
    FIELD_NAME_MAPPINGS = {
        'F PHOTO': 'FATHER_PHOTO',
        'M PHOTO': 'MOTHER_PHOTO',
        'SIGN': 'SIGNATURE',
        'PHOTO': 'PHOTO',
        'SIGN.': 'SIGNATURE',
        'SIGNATURE': 'SIGNATURE',
        'FATHER PHOTO': 'FATHER_PHOTO',
        'MOTHER PHOTO': 'MOTHER_PHOTO',
    }
    
    def export_images(
        self,
        table,
        cards: QuerySet,
        status: str = ''
    ) -> ZipExportResult:
        """
        Export images as separate ZIP files for each image field.
        
        Args:
            table: IDCardTable instance
            cards: QuerySet of IDCard instances
            
        Returns:
            ZipExportResult with base64-encoded ZIP files
        """
        if not cards.exists():
            return ZipExportResult(
                success=False,
                message='No cards to export!'
            )
        
        try:
            # Get image fields from table
            image_fields = get_image_fields(table.fields or [])
            
            if not image_fields:
                return ZipExportResult(
                    success=False,
                    message='No image fields found in this table!'
                )
            
            # Get client name for filename
            client_name = ''
            if table.group and table.group.client:
                client_name = table.group.client.name
            clean_client_name = clean_filename(client_name) if client_name else ''
            clean_table_name = clean_filename(table.name)
            
            zip_files = []
            total_images = 0
            
            for field_info in image_fields:
                field_name = field_info['name']
                zip_info = self._create_zip_for_field(
                    cards, field_name, clean_table_name, clean_client_name,
                    status=status
                )
                
                if zip_info:
                    zip_files.append(zip_info)
                    total_images += zip_info.image_count
            
            if not zip_files:
                return ZipExportResult(
                    success=False,
                    message='No images found for selected cards!'
                )
            
            return ZipExportResult(
                success=True,
                zip_files=zip_files,
                total_images=total_images,
                total_zips=len(zip_files)
            )
            
        except Exception as e:
            logger.error("ZIP export failed: %s", e, exc_info=True)
            return ZipExportResult(
                success=False,
                message='ZIP export failed. Please try again or contact support.'
            )
    
    def _create_zip_for_field(
        self,
        cards: QuerySet,
        field_name: str,
        table_name: str,
        client_name: str,
        status: str = ''
    ) -> Optional[ZipFileInfo]:
        """
        Create a ZIP file for a single image field.
        
        Memory-efficient: Uses iterator() to avoid loading all cards into memory.
        
        Phase 2 guarantee: Thumbnails are NEVER included.
        get_image_path_for_card blocks /thumbs/ paths.
        
        Phase 3: Uses ImageService.get_image_path_for_card which:
        1. Checks CardMedia first
        2. Falls back to field_data if not in CardMedia
        
        Args:
            cards: QuerySet of IDCard instances
            field_name: Name of the image field
            table_name: Cleaned table name for filename
            client_name: Cleaned client name for filename
            
        Returns:
            ZipFileInfo if images were found, None otherwise
        """
        zip_buffer = BytesIO()
        images_count = 0
        used_names = {}
        
        # Maximum images per ZIP to prevent memory issues
        MAX_IMAGES_PER_ZIP = 1000
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            # Use iterator() for memory-efficient QuerySet iteration
            for card in cards.iterator(chunk_size=100):
                if images_count >= MAX_IMAGES_PER_ZIP:
                    logger.warning("ZIP export reached image limit for field %s", field_name)
                    break
                
                # Phase 3: Use ImageService with CardMedia + fallback
                img_path = ImageService.get_image_path_for_card(
                    card=card,
                    field_name=field_name,
                    fallback_to_field_data=True
                )
                
                if not is_valid_image_path(img_path):
                    continue
                
                try:
                    if default_storage.exists(img_path):
                        with default_storage.open(img_path, 'rb') as img_file:
                            img_data = img_file.read()
                            
                            # Minimum valid image size check
                            if img_data and len(img_data) >= 100:
                                base = os.path.basename(img_path)
                                # Sanitize filename for ZIP entry
                                base = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', '_', base)
                                if not base or base == '.':
                                    base = 'image.jpg'
                                if base in used_names:
                                    used_names[base] += 1
                                    name, ext = os.path.splitext(base)
                                    download_filename = f"{name}_{used_names[base]}{ext}"
                                else:
                                    used_names[base] = 0
                                    download_filename = base
                                zf.writestr(download_filename, img_data)
                                images_count += 1
                                
                                # Free memory for large images
                                del img_data
                except Exception:
                    # Skip problematic images silently
                    continue
        
        if images_count == 0:
            return None
        
        zip_buffer.seek(0)
        zip_data = zip_buffer.getvalue()
        
        # Generate clean filename: ClientName_ListName_Field_Status.zip
        clean_field_name = self._get_readable_field_name(field_name)
        parts = []
        if client_name:
            parts.append(client_name)
        parts.append(table_name)
        parts.append(clean_field_name)
        if status:
            parts.append(clean_filename(status.capitalize()))
        zip_filename = '_'.join(parts) + '.zip'
        
        # Encode as base64 for JavaScript download
        zip_base64 = base64.b64encode(zip_data).decode('utf-8')
        
        return ZipFileInfo(
            field_name=field_name,
            filename=zip_filename,
            data=zip_base64,
            image_count=images_count
        )
    
    def _get_readable_field_name(self, field_name: str) -> str:
        """
        Convert field name to a more readable format for filename.
        
        Args:
            field_name: Original field name
            
        Returns:
            Cleaned field name suitable for filenames
        """
        name_upper = field_name.upper().strip()
        
        # Check known mappings first
        if name_upper in self.FIELD_NAME_MAPPINGS:
            return self.FIELD_NAME_MAPPINGS[name_upper]
        
        # Default: replace spaces with underscores
        return name_upper.replace(' ', '_')


# =============================================================================
# MODULE-LEVEL CONVENIENCE FUNCTION
# =============================================================================

def export_images_to_zip(table, cards: QuerySet) -> ZipExportResult:
    """
    Convenience function to export images as ZIP files.
    
    Args:
        table: IDCardTable instance
        cards: QuerySet of IDCard instances
        
    Returns:
        ZipExportResult with base64-encoded ZIP files
    """
    exporter = ZipExporter()
    return exporter.export_images(table, cards)


def zip_result_to_dict(result: ZipExportResult) -> Dict[str, Any]:
    """
    Convert ZipExportResult to dictionary for JSON serialization.
    
    Args:
        result: ZipExportResult instance
        
    Returns:
        Dictionary suitable for JsonResponse
    """
    if not result.success:
        return {
            'success': False,
            'message': result.message
        }
    
    return {
        'success': True,
        'zip_files': [
            {
                'field_name': zf.field_name,
                'filename': zf.filename,
                'data': zf.data,
                'image_count': zf.image_count
            }
            for zf in result.zip_files
        ],
        'total_images': result.total_images,
        'total_zips': result.total_zips
    }


# =============================================================================
# MEMORY-SAFE DISK-BASED EXPORT (for large exports)
# =============================================================================

@dataclass
class DiskZipInfo:
    """Information about a ZIP file saved to disk."""
    field_name: str
    filename: str
    path: str  # Full path on disk
    image_count: int


@dataclass
class DiskZipResult:
    """Result of a disk-based ZIP export operation."""
    success: bool
    message: str = ''
    zip_files: List[DiskZipInfo] = field(default_factory=list)
    total_images: int = 0
    total_zips: int = 0


def export_images_to_disk(
    table,
    cards: QuerySet,
    output_dir: str,
    status: str = '',
    progress_callback=None
) -> DiskZipResult:
    """
    Export images to ZIP files saved directly on disk.
    
    CRITICAL: Memory-safe implementation for large exports.
    - Uses ZIP_STORED (no compression) for memory efficiency
    - Writes directly to disk, not BytesIO
    - Processes one image at a time
    
    Args:
        table: IDCardTable instance
        cards: QuerySet of IDCard instances
        output_dir: Directory to save ZIP files
        status: Status label for filename
        progress_callback: Optional callback(current, total) for progress updates
        
    Returns:
        DiskZipResult with file paths
    """
    from datetime import datetime
    from django.conf import settings
    
    if not cards.exists():
        return DiskZipResult(
            success=False,
            message='No cards to export!'
        )
    
    try:
        # Get image fields from table
        image_fields = get_image_fields(table.fields or [])
        
        if not image_fields:
            return DiskZipResult(
                success=False,
                message='No image fields found in this table!'
            )
        
        # Get client name for filename
        client_name = ''
        if table.group and table.group.client:
            client_name = table.group.client.name
        clean_client_name = clean_filename(client_name) if client_name else ''
        clean_table_name = clean_filename(table.name)
        
        # Ensure output directory exists
        os.makedirs(output_dir, exist_ok=True)
        
        zip_files = []
        total_images = 0
        total_cards = cards.count()
        current_progress = 0
        
        for field_info in image_fields:
            field_name = field_info['name']
            clean_field_name = _get_readable_field_name(field_name)
            
            # Generate filename with timestamp
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            parts = []
            if clean_client_name:
                parts.append(clean_client_name)
            parts.append(clean_table_name)
            parts.append(clean_field_name)
            if status:
                parts.append(clean_filename(status.capitalize()))
            parts.append(timestamp)
            zip_filename = '_'.join(parts) + '.zip'
            zip_path = os.path.join(output_dir, zip_filename)
            
            images_count = 0
            used_names = {}
            
            # Create ZIP file on disk with ZIP_STORED (no compression)
            with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_STORED) as zf:
                for card in cards.iterator(chunk_size=100):
                    # Get image path using ImageService
                    img_path = ImageService.get_image_path_for_card(
                        card=card,
                        field_name=field_name,
                        fallback_to_field_data=True
                    )
                    
                    if not is_valid_image_path(img_path):
                        current_progress += 1
                        if progress_callback:
                            progress_callback(current_progress, total_cards * len(image_fields))
                        continue
                    
                    try:
                        if default_storage.exists(img_path):
                            with default_storage.open(img_path, 'rb') as img_file:
                                img_data = img_file.read()
                                
                                # Minimum valid image size check
                                if img_data and len(img_data) >= 100:
                                    base = os.path.basename(img_path)
                                    if base in used_names:
                                        used_names[base] += 1
                                        name, ext = os.path.splitext(base)
                                        download_filename = f"{name}_{used_names[base]}{ext}"
                                    else:
                                        used_names[base] = 0
                                        download_filename = base
                                    
                                    zf.writestr(download_filename, img_data)
                                    images_count += 1
                    except Exception:
                        # Skip problematic images silently
                        pass
                    
                    current_progress += 1
                    if progress_callback:
                        progress_callback(current_progress, total_cards * len(image_fields))
            
            # Only keep ZIP if it has images
            if images_count > 0:
                zip_files.append(DiskZipInfo(
                    field_name=field_name,
                    filename=zip_filename,
                    path=zip_path,
                    image_count=images_count
                ))
                total_images += images_count
            else:
                # Remove empty ZIP
                try:
                    os.remove(zip_path)
                except Exception:
                    pass
        
        if not zip_files:
            return DiskZipResult(
                success=False,
                message='No images found for selected cards!'
            )
        
        return DiskZipResult(
            success=True,
            zip_files=zip_files,
            total_images=total_images,
            total_zips=len(zip_files)
        )
        
    except Exception as e:
        logger.error("Disk-based ZIP export failed: %s", e, exc_info=True)
        return DiskZipResult(
            success=False,
            message='ZIP export failed. Please try again or contact support.'
        )


def _get_readable_field_name(field_name: str) -> str:
    """Convert field name to readable format for filename."""
    FIELD_NAME_MAPPINGS = {
        'F PHOTO': 'FATHER_PHOTO',
        'M PHOTO': 'MOTHER_PHOTO',
        'SIGN': 'SIGNATURE',
        'PHOTO': 'PHOTO',
        'SIGN.': 'SIGNATURE',
        'SIGNATURE': 'SIGNATURE',
        'FATHER PHOTO': 'FATHER_PHOTO',
        'MOTHER PHOTO': 'MOTHER_PHOTO',
    }
    
    name_upper = field_name.upper().strip()
    if name_upper in FIELD_NAME_MAPPINGS:
        return FIELD_NAME_MAPPINGS[name_upper]
    return name_upper.replace(' ', '_')


def stream_zip_response(zip_path: str, filename: str, delete_after: bool = True):
    """
    Create a streaming FileResponse for a ZIP file with optional cleanup.
    
    CRITICAL: Uses FileResponse for memory-efficient streaming.
    Deletes the temp file after response is sent.
    
    Args:
        zip_path: Full path to the ZIP file
        filename: Filename for the download
        delete_after: If True, delete file after response completes
        
    Returns:
        FileResponse
    """
    from django.http import FileResponse
    
    response = FileResponse(
        open(zip_path, 'rb'),
        as_attachment=True,
        filename=filename
    )
    
    if delete_after:
        # Attach cleanup callback so temp file is deleted after streaming
        original_close = response.close
        def close_with_cleanup():
            original_close()
            try:
                if os.path.exists(zip_path):
                    os.remove(zip_path)
                    logger.info("Cleaned up temp ZIP file: %s", zip_path)
            except Exception as e:
                logger.warning("Failed to cleanup temp ZIP %s: %s", zip_path, e)
        response.close = close_with_cleanup
    
    return response

