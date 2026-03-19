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
import tempfile
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime

from django.utils import timezone as django_tz

logger = logging.getLogger(__name__)

from django.db.models import QuerySet
from django.core.files.storage import default_storage

from mediafiles.services import ImageService

from .utils import (
    get_image_fields,
    clean_filename,
    is_valid_image_path,
    is_image_field,
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

    RENAMEABLE_IMAGE_KEYS = {'PHOTO', 'FATHER_PHOTO', 'MOTHER_PHOTO'}
    
    def export_images(
        self,
        table,
        cards: QuerySet,
        status: str = '',
        rename_options: Optional[Dict[str, Any]] = None,
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
            image_name_mapping = self._resolve_image_name_mapping(rename_options, table.fields or [])
            
            # Create a SINGLE ZIP with subdirectories per image field
            zip_tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
            zip_tmp_path = zip_tmp.name
            zip_tmp.close()
            
            MAX_IMAGES_PER_ZIP = 5000
            
            try:
                with zipfile.ZipFile(zip_tmp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                    for field_info in image_fields:
                        field_name = field_info['name']
                        field_type = field_info.get('type', '')
                        folder_name = self._get_readable_field_name(field_name)
                        canonical_key = self._canonical_image_key(field_name, field_type)
                        rename_source_field = image_name_mapping.get(canonical_key, '')
                        used_names = {}
                        field_count = 0
                        
                        for card in cards.iterator(chunk_size=100):
                            if total_images >= MAX_IMAGES_PER_ZIP:
                                break
                            
                            img_path = ImageService.get_image_path_for_card(
                                card=card,
                                field_name=field_name,
                                fallback_to_field_data=True
                            )
                            
                            if not is_valid_image_path(img_path):
                                continue
                            
                            try:
                                with default_storage.open(img_path, 'rb') as img_file:
                                    img_data = img_file.read()
                                    
                                    if img_data and len(img_data) >= 100:
                                        download_filename = self._build_download_filename(
                                            img_path=img_path,
                                            card=card,
                                            rename_source_field=rename_source_field,
                                            used_names=used_names,
                                        )
                                        
                                        # Place inside subdirectory named after field
                                        arcname = f"{folder_name}/{download_filename}"
                                        zf.writestr(arcname, img_data)
                                        field_count += 1
                                        total_images += 1
                                        
                                        del img_data
                            except FileNotFoundError:
                                continue
                            except Exception:
                                continue
                
                if total_images == 0:
                    os.unlink(zip_tmp_path)
                    return ZipExportResult(
                        success=False,
                        message='No images found for selected cards!'
                    )
                
                # Read from disk and base64-encode
                with open(zip_tmp_path, 'rb') as f:
                    zip_data = f.read()
                
                # Generate clean filename
                parts = []
                if clean_client_name:
                    parts.append(clean_client_name)
                parts.append(clean_table_name)
                parts.append('Images')
                if status:
                    parts.append(clean_filename(status.capitalize()))
                zip_filename = '_'.join(parts) + '.zip'
                
                zip_base64 = base64.b64encode(zip_data).decode('utf-8')
                del zip_data
                
                zip_files.append(ZipFileInfo(
                    field_name='ALL',
                    filename=zip_filename,
                    data=zip_base64,
                    image_count=total_images
                ))
            finally:
                try:
                    os.unlink(zip_tmp_path)
                except OSError:
                    pass
            
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
        zip_tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
        zip_tmp_path = zip_tmp.name
        zip_tmp.close()
        images_count = 0
        used_names = {}
        
        # Maximum images per ZIP to prevent memory issues
        MAX_IMAGES_PER_ZIP = 5000
        
        try:
            with zipfile.ZipFile(zip_tmp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
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
                    except FileNotFoundError:
                        # Image file doesn't exist on disk — skip silently
                        continue
                    except Exception:
                        # Skip problematic images silently
                        continue
        
            if images_count == 0:
                os.unlink(zip_tmp_path)
                return None
            
            # Read from disk and base64-encode (avoids double-buffering of BytesIO)
            with open(zip_tmp_path, 'rb') as f:
                zip_data = f.read()
        
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
            del zip_data  # Free the raw bytes immediately
            
            return ZipFileInfo(
                field_name=field_name,
                filename=zip_filename,
                data=zip_base64,
                image_count=images_count
            )
        finally:
            # Always clean up temp file
            try:
                os.unlink(zip_tmp_path)
            except OSError:
                pass
    
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

    def _normalize_field_key(self, value: str) -> str:
        """Normalize field names/keys for fuzzy matching."""
        return re.sub(r'[^A-Z0-9]', '', str(value or '').upper())

    def _canonical_image_key(self, field_name: str, field_type: str = '') -> str:
        """
        Map table image field to one of the renameable canonical keys.
        Only PHOTO/FATHER_PHOTO/MOTHER_PHOTO are renameable.
        """
        type_norm = str(field_type or '').strip().upper()
        if type_norm in self.RENAMEABLE_IMAGE_KEYS:
            return type_norm

        raw = str(field_name or '').upper().strip()
        normalized = self._normalize_field_key(raw)

        if normalized in ('MPHOTO', 'MOTHERPHOTO') or ('MOTHER' in raw and 'PHOTO' in raw):
            return 'MOTHER_PHOTO'
        if normalized in ('FPHOTO', 'FATHERPHOTO') or ('FATHER' in raw and 'PHOTO' in raw):
            return 'FATHER_PHOTO'
        if 'PHOTO' in raw:
            return 'PHOTO'
        return ''

    def _resolve_image_name_mapping(self, rename_options: Optional[Dict[str, Any]], table_fields: List[Dict[str, Any]]) -> Dict[str, str]:
        """Validate and resolve requested image->name-field mapping against table fields."""
        if not isinstance(rename_options, dict) or rename_options.get('enabled') is not True:
            return {}

        raw_map = rename_options.get('image_name_fields')
        if not isinstance(raw_map, dict):
            return {}

        valid_text_fields: Dict[str, str] = {}
        for field in table_fields:
            field_name = str((field or {}).get('name', '')).strip()
            if not field_name:
                continue
            if is_image_field(field or {}):
                continue
            valid_text_fields[self._normalize_field_key(field_name)] = field_name

        mapping: Dict[str, str] = {}
        for raw_image_key, raw_text_field_name in raw_map.items():
            canonical_image = self._canonical_image_key(str(raw_image_key), '')
            if canonical_image not in self.RENAMEABLE_IMAGE_KEYS:
                continue
            normalized_text_key = self._normalize_field_key(str(raw_text_field_name))
            resolved_text_field = valid_text_fields.get(normalized_text_key)
            if resolved_text_field:
                mapping[canonical_image] = resolved_text_field

        return mapping

    def _get_card_field_value(self, card: Any, field_name: str) -> str:
        """Read a text field from card.field_data using exact then normalized matching."""
        field_data = getattr(card, 'field_data', None) or {}
        if not isinstance(field_data, dict):
            return ''

        direct_value = field_data.get(field_name)
        if direct_value not in (None, ''):
            return str(direct_value).strip()

        target_key = self._normalize_field_key(field_name)
        for key, value in field_data.items():
            if self._normalize_field_key(str(key)) == target_key and value not in (None, ''):
                return str(value).strip()
        return ''

    def _build_download_filename(self, img_path: str, card: Any, rename_source_field: str, used_names: Dict[str, int]) -> str:
        """Build collision-safe filename, optionally renamed from selected card field."""
        base_name = os.path.basename(img_path)
        _, ext = os.path.splitext(base_name)
        if not ext:
            ext = '.jpg'

        target_base = ''
        if rename_source_field:
            name_value = self._get_card_field_value(card, rename_source_field)
            if name_value:
                target_base = f"{clean_filename(name_value)}{ext.lower()}"

        if not target_base:
            target_base = base_name

        target_base = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', '_', target_base)
        if not target_base or target_base == '.':
            target_base = f"image{ext.lower()}"

        if target_base in used_names:
            used_names[target_base] += 1
            name, original_ext = os.path.splitext(target_base)
            return f"{name}_{used_names[target_base]}{original_ext}"

        used_names[target_base] = 0
        return target_base


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
# MEMORY-SAFE DISK-BASED EXPORT (for large exports) — with 1 GB split
# =============================================================================

# Maximum uncompressed size per ZIP part before splitting
ZIP_SPLIT_THRESHOLD = 1 * 1024 * 1024 * 1024  # 1 GB


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
    - Phase 4: Automatically splits when a single ZIP exceeds 1 GB

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

    if not cards.exists():
        return DiskZipResult(success=False, message='No cards to export!')

    try:
        image_fields = get_image_fields(table.fields or [])
        if not image_fields:
            return DiskZipResult(success=False, message='No image fields found in this table!')

        client_name = ''
        if table.group and table.group.client:
            client_name = table.group.client.name
        clean_client_name = clean_filename(client_name) if client_name else ''
        clean_table_name = clean_filename(table.name)

        os.makedirs(output_dir, exist_ok=True)

        zip_files: List[DiskZipInfo] = []
        total_images = 0
        total_cards = cards.count()
        current_progress = 0

        # Build single ZIP filename
        timestamp = django_tz.localtime(django_tz.now()).strftime('%Y%m%d_%H%M%S')
        name_parts = []
        if clean_client_name:
            name_parts.append(clean_client_name)
        name_parts.append(clean_table_name)
        name_parts.append('Images')
        if status:
            name_parts.append(clean_filename(status.capitalize()))
        name_parts.append(timestamp)
        zip_filename = '_'.join(name_parts) + '.zip'
        zip_path = os.path.join(output_dir, zip_filename)

        # Create a SINGLE ZIP with subdirectories per image field
        part_size = 0
        part_num = 0
        current_zip_path = zip_path
        current_zip_fn = zip_filename
        all_parts: List[tuple] = []  # (path, fn, count)

        zf = zipfile.ZipFile(current_zip_path, 'w', compression=zipfile.ZIP_STORED)

        try:
            for field_info in image_fields:
                field_name = field_info['name']
                folder_name = _get_readable_field_name(field_name)
                used_names: Dict[str, int] = {}

                for card in cards.iterator(chunk_size=100):
                    img_path = ImageService.get_image_path_for_card(
                        card=card,
                        field_name=field_name,
                        fallback_to_field_data=True,
                    )
                    if not is_valid_image_path(img_path):
                        current_progress += 1
                        if progress_callback:
                            progress_callback(current_progress, total_cards * len(image_fields))
                        continue

                    try:
                        if not default_storage.exists(img_path):
                            continue
                        with default_storage.open(img_path, 'rb') as img_file:
                            img_data = img_file.read()

                        if not img_data or len(img_data) < 100:
                            continue

                        base = os.path.basename(img_path)
                        if base in used_names:
                            used_names[base] += 1
                            name_stem, ext = os.path.splitext(base)
                            download_filename = f"{name_stem}_{used_names[base]}{ext}"
                        else:
                            used_names[base] = 0
                            download_filename = base

                        # Check split threshold
                        if part_size + len(img_data) > ZIP_SPLIT_THRESHOLD and total_images > 0:
                            zf.close()
                            all_parts.append((current_zip_path, current_zip_fn, total_images))
                            part_num += 1
                            current_zip_fn = zip_filename.replace('.zip', f'_part{part_num}.zip')
                            current_zip_path = os.path.join(output_dir, current_zip_fn)
                            zf = zipfile.ZipFile(current_zip_path, 'w', compression=zipfile.ZIP_STORED)
                            part_size = 0

                        # Place inside subdirectory named after field
                        arcname = f"{folder_name}/{download_filename}"
                        zf.writestr(arcname, img_data)
                        part_size += len(img_data)
                        total_images += 1

                        del img_data
                    except Exception as e:
                        logger.warning("Failed to add image to ZIP (card field): %s", e)

                    current_progress += 1
                    if progress_callback:
                        progress_callback(current_progress, total_cards * len(image_fields))
        finally:
            zf.close()

        if total_images > 0:
            all_parts.append((current_zip_path, current_zip_fn, total_images))
        else:
            try:
                os.remove(current_zip_path)
            except Exception:
                pass

        # If we split, rename the first part
        if len(all_parts) > 1:
            old_path, old_fn, cnt = all_parts[0]
            new_fn = zip_filename.replace('.zip', '_part0.zip')
            new_path = os.path.join(output_dir, new_fn)
            try:
                os.rename(old_path, new_path)
                all_parts[0] = (new_path, new_fn, cnt)
            except Exception:
                pass

        for p_path, p_fn, p_cnt in all_parts:
            zip_files.append(DiskZipInfo(
                field_name='ALL',
                filename=p_fn,
                path=p_path,
                image_count=p_cnt,
            ))

        if not zip_files:
            return DiskZipResult(success=False, message='No images found for selected cards!')

        return DiskZipResult(
            success=True,
            zip_files=zip_files,
            total_images=total_images,
            total_zips=len(zip_files),
        )

    except Exception as e:
        logger.error("Disk-based ZIP export failed: %s", e, exc_info=True)
        return DiskZipResult(
            success=False,
            message='ZIP export failed. Please try again or contact support.',
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

