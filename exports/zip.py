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
import io
import base64
import logging
import zipfile
import tempfile
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime

from django.utils import timezone as django_tz

logger = logging.getLogger(__name__)

# Minimum export size floor for non-super-admin inline payloads.
# Super admin path remains unlimited (allow_large_base64=True bypasses this check).
MAX_BASE64_ZIP_BYTES = 1 * 1024 * 1024 * 1024  # 1 GB raw ZIP before base64 expansion

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
        allow_large_base64: bool = False,
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

            requested_selected_image = ''
            if isinstance(rename_options, dict) and rename_options.get('enabled') is True:
                requested_selected_image = str(rename_options.get('selected_image_field') or '').strip()

            selected_image_field = self._resolve_selected_image_field(rename_options, image_fields)
            if requested_selected_image and not selected_image_field:
                return ZipExportResult(
                    success=False,
                    message='Selected image column is not available in this table.'
                )

            if selected_image_field:
                selected_image_norm = self._normalize_field_key(selected_image_field)
                image_fields = [
                    field for field in image_fields
                    if self._normalize_field_key(str((field or {}).get('name', ''))) == selected_image_norm
                ]

                if not image_fields:
                    return ZipExportResult(
                        success=False,
                        message='Selected image column is not available in this table.'
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

            output_format = 'zip'
            if isinstance(rename_options, dict):
                raw_mode = str(rename_options.get('output_format', 'zip') or 'zip').strip().lower()
                if raw_mode == 'pdf_zip':
                    output_format = 'pdf_zip'

            if output_format == 'pdf_zip':
                return self._export_images_as_pdf_zip(
                    table=table,
                    cards=cards,
                    image_fields=image_fields,
                    image_name_mapping=image_name_mapping,
                    clean_client_name=clean_client_name,
                    clean_table_name=clean_table_name,
                    status=status,
                    allow_large_base64=allow_large_base64,
                )
            
            # Create a SINGLE ZIP with subdirectories per image field
            zip_tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
            zip_tmp_path = zip_tmp.name
            zip_tmp.close()
            
            try:
                with zipfile.ZipFile(zip_tmp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                    for field_info in image_fields:
                        field_name = field_info['name']
                        field_type = field_info.get('type', '')
                        folder_name = self._get_readable_field_name(field_name)
                        canonical_key = self._canonical_image_key(field_name, field_type)
                        rename_source_fields = image_name_mapping.get(canonical_key, [])
                        used_names = {}
                        field_count = 0
                        
                        for card in cards.iterator(chunk_size=100):
                            
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
                                            rename_source_fields=rename_source_fields,
                                            used_names=used_names,
                                        )
                                        
                                        # Place inside subdirectory named after field
                                        arcname = f"{folder_name}/{download_filename}"
                                        zf.writestr(arcname, img_data)
                                        field_count += 1
                                        total_images += 1
                                        
                                        del img_data
                            except FileNotFoundError:
                                logger.debug('Image file missing during ZIP export: %s', img_path)
                                continue
                            except Exception as exc:
                                logger.warning('Failed to include image in ZIP export for card=%s path=%s: %s', getattr(card, 'id', None), img_path, exc)
                                continue
                
                if total_images == 0:
                    os.unlink(zip_tmp_path)
                    return ZipExportResult(
                        success=False,
                        message='No images found for selected cards!'
                    )

                zip_size = os.path.getsize(zip_tmp_path)
                if not allow_large_base64 and zip_size > MAX_BASE64_ZIP_BYTES:
                    os.unlink(zip_tmp_path)
                    return ZipExportResult(
                        success=False,
                        message='Selected images exceed the 1 GB inline ZIP limit for this account.'
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

    def _export_images_as_pdf_zip(
        self,
        table,
        cards: QuerySet,
        image_fields: List[Dict[str, Any]],
        image_name_mapping: Dict[str, List[str]],
        clean_client_name: str,
        clean_table_name: str,
        status: str,
        allow_large_base64: bool = False,
    ) -> ZipExportResult:
        """Create one ZIP that contains one PDF per selected photo column."""
        selected_keys = [
            key for key in ('PHOTO', 'FATHER_PHOTO', 'MOTHER_PHOTO')
            if key in image_name_mapping
        ]
        if not selected_keys:
            return ZipExportResult(
                success=False,
                message='Select at least one image-name mapping to export PDF files.'
            )

        field_by_key: Dict[str, Dict[str, Any]] = {}
        for field_info in image_fields:
            key = self._canonical_image_key(field_info.get('name', ''), field_info.get('type', ''))
            if key and key in selected_keys and key not in field_by_key:
                field_by_key[key] = field_info

        if not field_by_key:
            return ZipExportResult(
                success=False,
                message='No matching PHOTO columns found for PDF export.'
            )

        zip_tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
        zip_tmp_path = zip_tmp.name
        zip_tmp.close()

        total_images = 0
        pdf_count = 0
        try:
            with zipfile.ZipFile(zip_tmp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for key in selected_keys:
                    field_info = field_by_key.get(key)
                    if not field_info:
                        continue

                    field_name = field_info.get('name', '')
                    if not field_name:
                        continue

                    pdf_tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')
                    pdf_tmp_path = pdf_tmp.name
                    pdf_tmp.close()
                    try:
                        max_pages = None
                        page_count = self._write_image_field_pdf(
                            cards=cards,
                            field_name=field_name,
                            pdf_path=pdf_tmp_path,
                            max_pages=max_pages,
                        )
                        if page_count <= 0:
                            continue

                        readable_field = self._get_readable_field_name(field_name)
                        pdf_filename = f"{readable_field}_Images.pdf"
                        zf.write(pdf_tmp_path, arcname=pdf_filename)
                        total_images += page_count
                        pdf_count += 1
                    finally:
                        try:
                            os.unlink(pdf_tmp_path)
                        except OSError:
                            pass

            if pdf_count == 0:
                return ZipExportResult(
                    success=False,
                    message='No images found for selected photo columns!'
                )

            zip_size = os.path.getsize(zip_tmp_path)
            if not allow_large_base64 and zip_size > MAX_BASE64_ZIP_BYTES:
                return ZipExportResult(
                    success=False,
                    message='Selected PDF ZIP exceeds the 1 GB inline ZIP limit for this account.'
                )

            with open(zip_tmp_path, 'rb') as f:
                zip_data = f.read()

            parts = []
            if clean_client_name:
                parts.append(clean_client_name)
            parts.append(clean_table_name)
            parts.append('ImagesPDF')
            if status:
                parts.append(clean_filename(status.capitalize()))
            zip_filename = '_'.join(parts) + '.zip'

            zip_base64 = base64.b64encode(zip_data).decode('utf-8')
            del zip_data

            return ZipExportResult(
                success=True,
                zip_files=[
                    ZipFileInfo(
                        field_name='PDF',
                        filename=zip_filename,
                        data=zip_base64,
                        image_count=total_images,
                    )
                ],
                total_images=total_images,
                total_zips=1,
            )
        except Exception as e:
            logger.error("PDF-in-ZIP export failed: %s", e, exc_info=True)
            return ZipExportResult(
                success=False,
                message='PDF ZIP export failed. Please try again or contact support.'
            )
        finally:
            try:
                os.unlink(zip_tmp_path)
            except OSError:
                pass

    def _write_image_field_pdf(self, cards: QuerySet, field_name: str, pdf_path: str, max_pages: Optional[int] = None) -> int:
        """Write one PDF where each page contains one image from the given field."""
        from reportlab.pdfgen import canvas
        from reportlab.lib.utils import ImageReader

        pdf_canvas = canvas.Canvas(pdf_path)
        page_count = 0

        try:
            for card in cards.iterator(chunk_size=100):
                if max_pages is not None and page_count >= max_pages:
                    break

                img_path = ImageService.get_image_path_for_card(
                    card=card,
                    field_name=field_name,
                    fallback_to_field_data=True,
                )
                if not is_valid_image_path(img_path):
                    continue

                try:
                    with default_storage.open(img_path, 'rb') as img_file:
                        img_data = img_file.read()

                    if not img_data or len(img_data) < 100:
                        continue

                    image_reader = ImageReader(io.BytesIO(img_data))
                    width, height = image_reader.getSize()
                    if width <= 0 or height <= 0:
                        continue

                    width = float(width)
                    height = float(height)
                    pdf_canvas.setPageSize((width, height))
                    pdf_canvas.drawImage(image_reader, 0, 0, width=width, height=height)
                    pdf_canvas.showPage()
                    page_count += 1
                except FileNotFoundError:
                    logger.debug('Image file missing during PDF-ZIP export: %s', img_path)
                    continue
                except Exception as exc:
                    logger.warning('Failed PDF page generation for card=%s field=%s path=%s: %s', getattr(card, 'id', None), field_name, img_path, exc)
                    continue

            pdf_canvas.save()
        except Exception:
            try:
                pdf_canvas.save()
            except Exception as exc:
                logger.debug('Failed to finalize PDF canvas after error for field=%s: %s', field_name, exc)
            return 0

        return page_count
    
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
        
        try:
            with zipfile.ZipFile(zip_tmp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                # Use iterator() for memory-efficient QuerySet iteration
                for card in cards.iterator(chunk_size=100):
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
                        logger.debug('Image file missing while building field ZIP: %s', img_path)
                        continue
                    except Exception as exc:
                        # Skip problematic images silently
                        logger.warning('Failed to add image to field ZIP for card=%s field=%s path=%s: %s', getattr(card, 'id', None), field_name, img_path, exc)
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

    def _resolve_image_name_mapping(self, rename_options: Optional[Dict[str, Any]], table_fields: List[Dict[str, Any]]) -> Dict[str, List[str]]:
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

        mapping: Dict[str, List[str]] = {}
        for raw_image_key, raw_text_field_names in raw_map.items():
            canonical_image = self._canonical_image_key(str(raw_image_key), '')
            if canonical_image not in self.RENAMEABLE_IMAGE_KEYS:
                continue

            values_to_resolve = []
            if isinstance(raw_text_field_names, (list, tuple)):
                values_to_resolve = list(raw_text_field_names)
            else:
                values_to_resolve = [raw_text_field_names]

            resolved_fields = []
            seen = set()
            for raw_text_field_name in values_to_resolve:
                normalized_text_key = self._normalize_field_key(str(raw_text_field_name))
                resolved_text_field = valid_text_fields.get(normalized_text_key)
                if not resolved_text_field:
                    continue
                dedupe_key = resolved_text_field.lower()
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                resolved_fields.append(resolved_text_field)

            if resolved_fields:
                mapping[canonical_image] = resolved_fields

        return mapping

    def _resolve_selected_image_field(self, rename_options: Optional[Dict[str, Any]], image_fields: List[Dict[str, Any]]) -> str:
        """Return a validated selected image field name for rename-mode exports."""
        if not isinstance(rename_options, dict) or rename_options.get('enabled') is not True:
            return ''

        raw_selected_field = str(rename_options.get('selected_image_field') or '').strip()
        if not raw_selected_field:
            return ''

        normalized_target = self._normalize_field_key(raw_selected_field)
        if not normalized_target:
            return ''

        for field in image_fields:
            field_name = str((field or {}).get('name') or '').strip()
            if not field_name:
                continue
            if self._normalize_field_key(field_name) == normalized_target:
                return field_name

        return ''

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

    def _build_download_filename(self, img_path: str, card: Any, rename_source_fields: List[str], used_names: Dict[str, int]) -> str:
        """Build collision-safe filename, optionally renamed from selected card field."""
        base_name = os.path.basename(img_path)
        _, ext = os.path.splitext(base_name)
        if not ext:
            ext = '.jpg'

        target_base = ''
        if rename_source_fields:
            values = []
            for source_field in rename_source_fields:
                name_value = self._get_card_field_value(card, source_field)
                if not name_value:
                    continue
                clean_value = clean_filename(name_value)
                if clean_value:
                    values.append(clean_value)

            if values:
                base_stem = '_'.join(values)
                if len(base_stem) > 180:
                    base_stem = base_stem[:180].rstrip('._')
                target_base = f"{base_stem}{ext.lower()}"

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
                        base = os.path.basename(img_path)
                        if base in used_names:
                            used_names[base] += 1
                            name_stem, ext = os.path.splitext(base)
                            download_filename = f"{name_stem}_{used_names[base]}{ext}"
                        else:
                            used_names[base] = 0
                            download_filename = base

                        # Fast path for FileSystem storage: add file directly to ZIP
                        # without reading full bytes into Python memory.
                        real_path = None
                        real_size = 0
                        try:
                            real_path = default_storage.path(img_path)
                            if real_path and os.path.exists(real_path):
                                real_size = os.path.getsize(real_path)
                        except (AttributeError, NotImplementedError, OSError):
                            real_path = None
                            real_size = 0

                        if real_path and real_size >= 100:
                            if part_size + real_size > ZIP_SPLIT_THRESHOLD and total_images > 0:
                                zf.close()
                                all_parts.append((current_zip_path, current_zip_fn, total_images))
                                part_num += 1
                                current_zip_fn = zip_filename.replace('.zip', f'_part{part_num}.zip')
                                current_zip_path = os.path.join(output_dir, current_zip_fn)
                                zf = zipfile.ZipFile(current_zip_path, 'w', compression=zipfile.ZIP_STORED)
                                part_size = 0

                            arcname = f"{folder_name}/{download_filename}"
                            zf.write(real_path, arcname=arcname)
                            part_size += real_size
                            total_images += 1
                            current_progress += 1
                            if progress_callback:
                                progress_callback(current_progress, total_cards * len(image_fields))
                            continue

                        # Fallback for non-local storages: read and write bytes.
                        with default_storage.open(img_path, 'rb') as img_file:
                            img_data = img_file.read()

                        if not img_data or len(img_data) < 100:
                            continue

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
            except Exception as exc:
                logger.debug('Failed removing empty ZIP part %s: %s', current_zip_path, exc)

        # If we split, rename the first part
        if len(all_parts) > 1:
            old_path, old_fn, cnt = all_parts[0]
            new_fn = zip_filename.replace('.zip', '_part0.zip')
            new_path = os.path.join(output_dir, new_fn)
            try:
                os.rename(old_path, new_path)
                all_parts[0] = (new_path, new_fn, cnt)
            except Exception as exc:
                logger.debug('Failed renaming first ZIP part %s -> %s: %s', old_path, new_path, exc)

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

