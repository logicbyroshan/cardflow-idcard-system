"""
Image Service

Main service class for all image operations.
Uses ImageRenamer for naming and ThumbnailService for thumbnails.

Hardened for production:
- Collision-safe filename generation
- Proper temp file cleanup on failure
- Case-insensitive ZIP/XLSX matching
- Deterministic multi-match resolution

NO STUBS. Real implementations only.
"""
import os
import logging
from io import BytesIO
from typing import Tuple, Optional, Dict, Any, List
from dataclasses import dataclass, field

from django.conf import settings
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile

from ..constants import (
    VALID_IMAGE_EXTENSIONS,
    IMAGE_FIELD_TYPES,
    IMAGE_FIELD_NAME_PATTERNS,
    THUMBNAIL_SIZE,
    THUMBNAIL_SUFFIX,
    CLIENT_IMAGE_BASE_FOLDER,
)
from .image_rename import ImageRenamer
from .image_thumbnail import ThumbnailService

logger = logging.getLogger(__name__)


# =============================================================================
# SERVICE RESULT
# =============================================================================

@dataclass
class MediaResult:
    """Standard result object for media service operations."""
    success: bool
    message: str = ''
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict suitable for JSON response."""
        response: Dict[str, Any] = {'success': self.success}
        if self.message:
            response['message'] = self.message
        if self.data:
            response.update(self.data)
        return response


# =============================================================================
# IMAGE SERVICE
# =============================================================================

class ImageService:
    """
    Service for handling all image operations.
    
    Responsibilities:
    - Generate unique filenames for images
    - Validate image data
    - Save images to client folders with thumbnails
    - Delete old images when updating
    - Match images from ZIP files to card data
    
    Storage structure:
    - Original: media/adrsh_img/{client_code}/{filename}.jpg
    - Thumbnail: media/adrsh_img/thumbs/{client_code}/{filename}.jpg
    - Temp: media/temp/ (cleaned after processing)
    """
    
    # Re-export constants for backward compatibility
    THUMBNAIL_SIZE = THUMBNAIL_SIZE
    THUMBNAIL_SUFFIX = THUMBNAIL_SUFFIX
    VALID_IMAGE_EXTENSIONS = VALID_IMAGE_EXTENSIONS
    IMAGE_FIELD_TYPES = IMAGE_FIELD_TYPES
    IMAGE_FIELD_NAME_PATTERNS = IMAGE_FIELD_NAME_PATTERNS
    
    # Temp folder for uploads
    TEMP_FOLDER = 'temp'
    
    # ==================== FILENAME GENERATION ====================
    
    @staticmethod
    def generate_filename(batch_counter: int = 1, original_ext: str = '.jpg') -> str:
        """Generate a unique 14-digit filename for NEW uploaded images."""
        return ImageRenamer.generate_filename(batch_counter, original_ext)
    
    @staticmethod
    def generate_updated_filename(existing_path: str, new_ext: Optional[str] = None) -> str:
        """Generate updated filename for EXISTING images (preserves original timestamp)."""
        return ImageRenamer.generate_updated_filename(existing_path, new_ext)
    
    # ==================== VALIDATION ====================
    
    @staticmethod
    def validate_image_bytes(image_bytes: bytes) -> Tuple[bool, Optional[str]]:
        """
        Validate that image bytes represent a valid image.
        
        Args:
            image_bytes: Raw image data
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        if not image_bytes:
            return False, "Image data is empty"
        
        if len(image_bytes) < 100:
            return False, "Image data is too small"
        
        MAX_IMAGE_SIZE = 30 * 1024 * 1024  # 30MB per image
        if len(image_bytes) > MAX_IMAGE_SIZE:
            return False, f"Image too large ({len(image_bytes) // 1024 // 1024}MB). Maximum is 30MB."
        
        try:
            from PIL import Image
            
            # MAX_IMAGE_PIXELS is set once at app startup (core/apps.py)
            
            # Try to open and verify the image
            with Image.open(BytesIO(image_bytes)) as img:
                img.verify()
            
            # Re-open to check it's actually readable
            with Image.open(BytesIO(image_bytes)) as img:
                img.load()
                
                # Check format is supported
                if img.format and img.format.lower() not in ['jpeg', 'jpg', 'png', 'gif', 'bmp', 'webp']:
                    return False, f"Unsupported image format: {img.format}"
            
            return True, None
            
        except Exception as e:
            return False, f"Invalid image: {str(e)}"
    
    # ==================== FOLDER MANAGEMENT ====================
    
    @staticmethod
    def get_client_image_folder(client) -> str:
        """
        Get or create the image folder path for a client.
        
        Args:
            client: Client model instance
            
        Returns:
            Folder path relative to MEDIA_ROOT (e.g., "adrsh_img/ABCDE12345")
        """
        folder_code = getattr(client, 'image_folder_code', None)
        if not folder_code:
            # Generate from client name if not set
            from ..utils import generate_folder_code_from_name, generate_unique_suffix
            folder_code = generate_folder_code_from_name(getattr(client, 'name', 'CLIENT'))
            folder_code += generate_unique_suffix(5)
        
        folder_path = f"{CLIENT_IMAGE_BASE_FOLDER}/{folder_code}"
        
        # Ensure folder exists in filesystem
        try:
            full_path = os.path.join(settings.MEDIA_ROOT, folder_path)
            os.makedirs(full_path, exist_ok=True)
            
            # Also ensure thumbs folder exists
            thumbs_path = os.path.join(settings.MEDIA_ROOT, CLIENT_IMAGE_BASE_FOLDER, 'thumbs', folder_code)
            os.makedirs(thumbs_path, exist_ok=True)
        except Exception as e:
            logger.warning("Could not create folder %s: %s", folder_path, e)
        
        return folder_path
    
    @classmethod
    def get_temp_folder(cls) -> str:
        """
        Get or create the temp folder path.
        
        Returns:
            Temp folder path relative to MEDIA_ROOT
        """
        temp_path = cls.TEMP_FOLDER
        try:
            full_path = os.path.join(settings.MEDIA_ROOT, temp_path)
            os.makedirs(full_path, exist_ok=True)
        except Exception as e:
            logger.warning("Could not create temp folder: %s", e)
        return temp_path
    
    # ==================== SINGLE-AUTHORITY ENTRY POINTS ====================
    # All image mutations MUST go through one of these four methods.
    # They guarantee: save + thumbnail + CardMedia + return final_value.
    # Callers store the returned data['final_value'] in field_data — nothing else.

    @classmethod
    def save_new_image(
        cls,
        image_bytes: bytes,
        client,
        field_name: str,
        card=None,
        batch_counter: int = 1,
        original_ext: str = '.jpg',
        original_filename: str = None,
        uploaded_by=None,
    ) -> 'MediaResult':
        """
        Single entry point for saving a NEW image (no existing path).

        Pipeline:
          1. Save image to client folder (collision-safe)
          2. Generate thumbnail
          3. Create CardMedia record (if card provided)

        Returns:
            MediaResult with data['final_value'] — the path to store in field_data.
        """
        result = cls.save_image_with_thumbnail(
            image_bytes=image_bytes,
            client=client,
            existing_path=None,
            batch_counter=batch_counter,
            original_ext=original_ext,
        )
        if not result.success:
            return result

        saved_path = result.data.get('path', '')

        # CardMedia dual-write
        if card and saved_path:
            try:
                cls.create_media_record(
                    saved_path=saved_path,
                    client=client,
                    card=card,
                    field_name=field_name,
                    media_type='photo',
                    original_filename=original_filename,
                    uploaded_by=uploaded_by,
                )
            except Exception as cm_err:
                logger.warning("CardMedia create failed in save_new_image for %s: %s", field_name, cm_err)

        result.data['final_value'] = saved_path
        result.data['action'] = 'upload'
        return result

    @classmethod
    def replace_image(
        cls,
        image_bytes: bytes,
        client,
        field_name: str,
        existing_path: str,
        card=None,
        batch_counter: int = 1,
        original_ext: str = '.jpg',
        original_filename: str = None,
        uploaded_by=None,
    ) -> 'MediaResult':
        """
        Single entry point for REPLACING an existing image.

        Pipeline:
          1. Save new image (edit naming preserves original 14-digit base)
          2. Delete old image + old thumbnail
          3. Generate new thumbnail
          4. Update CardMedia record (if card provided)

        Returns:
            MediaResult with data['final_value'] — the new path to store in field_data.
        """
        # Treat invalid existing paths as a fresh save
        if not existing_path or existing_path in ('NOT_FOUND', '') or existing_path.startswith('PENDING:'):
            return cls.save_new_image(
                image_bytes=image_bytes,
                client=client,
                field_name=field_name,
                card=card,
                batch_counter=batch_counter,
                original_ext=original_ext,
                original_filename=original_filename,
                uploaded_by=uploaded_by,
            )

        result = cls.save_image_with_thumbnail(
            image_bytes=image_bytes,
            client=client,
            existing_path=existing_path,
            batch_counter=batch_counter,
            original_ext=original_ext,
        )
        if not result.success:
            return result

        saved_path = result.data.get('path', '')

        # CardMedia: delete old, create new
        if card and saved_path:
            try:
                from ..models import CardMedia
                CardMedia.objects.filter(card=card, field_name=field_name).delete()
                cls.create_media_record(
                    saved_path=saved_path,
                    client=client,
                    card=card,
                    field_name=field_name,
                    media_type='photo',
                    original_filename=original_filename,
                    uploaded_by=uploaded_by,
                )
            except Exception as cm_err:
                logger.warning("CardMedia update failed in replace_image for %s: %s", field_name, cm_err)

        result.data['final_value'] = saved_path
        result.data['action'] = 'upload'
        return result

    @classmethod
    def mark_pending(cls, field_name: str, reference: str) -> 'MediaResult':
        """
        Mark an image field as pending — no image available yet.

        Returns:
            MediaResult with data['final_value'] = 'PENDING:{reference}' or ''.
        """
        if reference:
            final_value = f'PENDING:{reference}'
        else:
            final_value = ''
        return MediaResult(
            success=True,
            data={'final_value': final_value, 'action': 'pending'},
        )

    @classmethod
    def remove_image(cls, field_name: str, current_path: str, card=None) -> 'MediaResult':
        """
        Remove an image — deletes file, thumbnail, and CardMedia.

        Returns:
            MediaResult with data['final_value'] = ''.
        """
        if current_path and current_path not in ('', 'NOT_FOUND') and not current_path.startswith('PENDING:'):
            try:
                cls.delete_image(current_path)
            except Exception as del_err:
                logger.warning("Failed to delete image for %s: %s", field_name, del_err)

            if card:
                try:
                    from ..models import CardMedia
                    CardMedia.objects.filter(card=card, field_name=field_name).delete()
                except Exception as cm_err:
                    logger.warning("Failed to delete CardMedia for %s: %s", field_name, cm_err)

        return MediaResult(
            success=True,
            data={'final_value': '', 'action': 'removal'},
        )

    # ==================== IMAGE COMPRESSION ====================

    # Target size for stored images (5 MB)
    MAX_STORED_IMAGE_SIZE = 5 * 1024 * 1024

    @classmethod
    def compress_to_target_size(
        cls,
        image_bytes: bytes,
        target_size: int = None,
        min_quality: int = 10,
    ) -> bytes:
        """
        Compress image to *target_size* bytes by reducing JPEG quality only.

        RULES:
          - Dimensions are NEVER reduced.
          - Only JPEG quality is adjusted.
          - If already <= target_size, returns original bytes unchanged.
          - Uses a temporary file to avoid memory spikes on very large images.

        Returns:
            Compressed (or original) image bytes.
        """
        import tempfile
        from PIL import Image

        target_size = target_size or cls.MAX_STORED_IMAGE_SIZE

        if len(image_bytes) <= target_size:
            return image_bytes

        try:
            img = Image.open(BytesIO(image_bytes))
            try:
                # Preserve original dimensions — never resize
                if img.mode in ('RGBA', 'LA', 'P'):
                    bg = Image.new('RGB', img.size, (255, 255, 255))
                    if img.mode == 'P':
                        img = img.convert('RGBA')
                    bg.paste(img, mask=img.split()[-1] if 'A' in img.mode else None)
                    img.close()
                    img = bg
                elif img.mode != 'RGB':
                    img_c = img.convert('RGB')
                    img.close()
                    img = img_c

                # Handle EXIF orientation
                try:
                    from PIL import ImageOps
                    img = ImageOps.exif_transpose(img)
                except Exception:
                    pass

                # Binary-search for best quality that meets target
                lo, hi = min_quality, 95
                best_bytes = None

                while lo <= hi:
                    mid = (lo + hi) // 2
                    tmp = tempfile.SpooledTemporaryFile(max_size=target_size)
                    try:
                        img.save(tmp, format='JPEG', quality=mid, optimize=True)
                        size = tmp.tell()
                        tmp.seek(0)
                        if size <= target_size:
                            best_bytes = tmp.read()
                            lo = mid + 1  # try higher quality
                        else:
                            hi = mid - 1  # need lower quality
                    finally:
                        tmp.close()

                if best_bytes is not None:
                    logger.info(
                        "Compressed image from %d KB to %d KB (quality binary-search)",
                        len(image_bytes) // 1024, len(best_bytes) // 1024,
                    )
                    return best_bytes

                # Fallback: save at min_quality
                buf = BytesIO()
                img.save(buf, format='JPEG', quality=min_quality, optimize=True)
                result = buf.getvalue()
                logger.warning(
                    "Image compressed to %d KB at minimum quality %d (target was %d KB)",
                    len(result) // 1024, min_quality, target_size // 1024,
                )
                return result
            finally:
                img.close()
        except Exception as e:
            logger.error("compress_to_target_size failed: %s", e)
            return image_bytes  # return original on error

    # ==================== IMAGE SAVING (internal) ====================
    
    @classmethod
    def save_image(
        cls,
        file_content,
        client,
        existing_path: Optional[str] = None,
        batch_counter: int = 1
    ) -> 'MediaResult':
        """
        Save an image file to the client's folder with collision-safe renaming.
        
        On failure: cleans up any partially written files and logs explicit errors.
        
        Args:
            file_content: File content (UploadedFile or bytes)
            client: Client model instance
            existing_path: Path of existing image (for updates)
            batch_counter: Counter for unique filename generation
            
        Returns:
            MediaResult with saved path in data['path']
        """
        saved_path = None
        try:
            # Get image bytes
            if hasattr(file_content, 'read'):
                image_bytes = file_content.read()
                file_content.seek(0)  # Reset for potential re-read
            else:
                image_bytes = file_content
            
            # Validate image
            is_valid, error_msg = cls.validate_image_bytes(image_bytes)
            if not is_valid:
                return MediaResult(success=False, message=error_msg or "Invalid image")
            
            # Get extension from file if possible
            original_ext = '.jpg'
            if hasattr(file_content, 'name') and file_content.name:
                _, ext = os.path.splitext(file_content.name)
                if ext:
                    original_ext = ImageRenamer.normalize_extension(ext)
            
            # Get client folder
            client_folder = cls.get_client_image_folder(client)
            
            # Generate collision-safe filename
            is_update = (
                existing_path
                and existing_path not in ['NOT_FOUND', '', 'PENDING']
                and not existing_path.startswith('PENDING:')
            )
            
            if is_update:
                filename = ImageRenamer.generate_updated_filename_safe(
                    client_folder, existing_path, original_ext
                )
            else:
                filename = ImageRenamer.generate_filename_safe(
                    client_folder, batch_counter, original_ext
                )
            
            file_path = f"{client_folder}/{filename}"
            
            # Save the image
            saved_path = default_storage.save(file_path, ContentFile(image_bytes))
            
            # Delete old image if this is an update
            if is_update:
                try:
                    if default_storage.exists(existing_path):
                        default_storage.delete(existing_path)
                        logger.debug("Deleted old image: %s", existing_path)
                    # Also delete old thumbnail
                    ThumbnailService.delete_thumbnail(existing_path)
                except Exception as del_err:
                    logger.warning("Could not delete old image %s: %s", existing_path, del_err)
            
            return MediaResult(
                success=True,
                message="Image saved successfully",
                data={'path': saved_path, 'filename': filename}
            )
            
        except Exception as e:
            # CLEANUP: remove partially written file if it was saved
            if saved_path:
                try:
                    if default_storage.exists(saved_path):
                        default_storage.delete(saved_path)
                        logger.info("Cleaned up partial file after error: %s", saved_path)
                except Exception as cleanup_err:
                    logger.error("Failed to clean up partial file %s: %s", saved_path, cleanup_err)
            
            logger.error("Failed to save image: %s", e, exc_info=True)
            return MediaResult(success=False, message=f"Failed to save image: {str(e)}")
    
    @classmethod
    def save_image_with_thumbnail(
        cls,
        image_bytes: bytes,
        client,
        existing_path: Optional[str] = None,
        batch_counter: int = 1,
        original_ext: str = '.jpg'
    ) -> 'MediaResult':
        """
        Save an image and generate its thumbnail.

        Phase 1 rule: If the image exceeds 5 MB it is quality-compressed
        (dimensions preserved) before saving.
        """
        # Phase 1: compress large images to <= 5 MB (quality only, no resize)
        if len(image_bytes) > cls.MAX_STORED_IMAGE_SIZE:
            image_bytes = cls.compress_to_target_size(image_bytes)
            # After compression the effective extension is always JPEG
            original_ext = '.jpg'

        # First save the original
        result = cls.save_image(
            ContentFile(image_bytes),
            client,
            existing_path,
            batch_counter
        )
        
        if not result.success:
            return result
        
        saved_path = result.data.get('path')
        
        # Generate thumbnail
        if saved_path:
            thumb_path = ThumbnailService.create_thumbnail(saved_path)
        else:
            thumb_path = None
        if thumb_path:
            result.data['thumbnail_path'] = thumb_path
        else:
            logger.warning("Failed to create thumbnail for: %s", saved_path)
        
        return result
    
    # ==================== IMAGE DELETION ====================
    
    @classmethod
    def delete_image(cls, image_path: str) -> 'MediaResult':
        """
        Delete an image and its thumbnail.
        
        Args:
            image_path: Path to the image
            
        Returns:
            MediaResult indicating success/failure
        """
        if not image_path or image_path in ['NOT_FOUND', '', 'PENDING']:
            return MediaResult(success=True, message="No image to delete")
        
        if image_path.startswith('PENDING:'):
            return MediaResult(success=True, message="Pending reference cleared")
        
        try:
            # Delete original
            if default_storage.exists(image_path):
                default_storage.delete(image_path)
                logger.debug("Deleted image: %s", image_path)
            
            # Delete thumbnail
            ThumbnailService.delete_thumbnail(image_path)
            
            return MediaResult(success=True, message="Image deleted")
            
        except Exception as e:
            logger.error("Failed to delete image %s: %s", image_path, e)
            return MediaResult(success=False, message=f"Failed to delete: {str(e)}")
    
    # ==================== THUMBNAIL OPERATIONS ====================
    
    @classmethod
    def get_thumbnail_path(cls, original_path: Optional[str]) -> Optional[str]:
        """Get the thumbnail path for an original image."""
        if not original_path:
            return None
        return ThumbnailService.get_thumbnail_path(original_path)
    
    @classmethod
    def generate_thumbnail(cls, image_bytes: bytes, max_size: Optional[tuple] = None) -> Optional[bytes]:
        """Generate thumbnail bytes from image bytes."""
        return ThumbnailService.generate_thumbnail(image_bytes, max_size)
    
    @classmethod
    def ensure_thumbnail_exists(cls, image_path: str) -> Optional[str]:
        """Ensure thumbnail exists, creating if needed."""
        return ThumbnailService.ensure_thumbnail_exists(image_path)
    
    # ==================== CENTRALIZED IMAGE FIELD PROCESSOR ====================
    
    @classmethod
    def process_image_field(
        cls,
        field_name: str,
        new_value,
        existing_value: str,
        client,
        card=None,
        uploaded_file=None,
        batch_counter: int = 1,
        uploaded_by=None,
    ) -> 'MediaResult':
        """
        Centralized handler for ALL image field mutations.
        
        Handles every case:
          1. UPLOAD   – uploaded_file provided → save + thumbnail + CardMedia
          2. REMOVAL  – new_value is '' and existing_value had a path → delete file + thumbnail + CardMedia
          3. REWRITE  – new_value is a different valid path → normalize, validate, return
          4. UNCHANGED – new_value == existing_value → pass through
          5. MISSING   – path provided but file missing on disk → PENDING:{filename}
          6. PENDING   – new_value is PENDING:xxx → pass through
        
        Args:
            field_name:      Name of the image field (e.g. 'PHOTO', 'MOTHER PHOTO')
            new_value:       The incoming value (str path, '' for removal, None for unchanged)
            existing_value:  Current stored value in field_data for this field
            client:          Client model instance (for folder path generation)
            card:            IDCard model instance (optional, for CardMedia linkage)
            uploaded_file:   Django UploadedFile or None
            batch_counter:   Counter for unique filename generation
            uploaded_by:     User who uploaded (for CardMedia record)
            
        Returns:
            MediaResult with:
              data['final_value'] – the value to store in field_data
              data['action']      – one of: 'upload', 'removal', 'rewrite', 'unchanged', 'pending', 'missing'
              data['path']        – saved path (for uploads)
              data['thumbnail_path'] – thumbnail path (for uploads)
        """
        from core.services.base import BaseService
        
        existing_value = existing_value or ''
        
        # ── CASE 1: File upload ──────────────────────────────────────
        # Delegates to save_new_image / replace_image (single authority).
        if uploaded_file is not None:
            try:
                image_bytes = uploaded_file.read()
                uploaded_file.seek(0)
                original_ext = '.jpg'
                if hasattr(uploaded_file, 'name') and uploaded_file.name:
                    _, ext = os.path.splitext(uploaded_file.name)
                    if ext:
                        original_ext = ImageRenamer.normalize_extension(ext)
                
                original_filename = getattr(uploaded_file, 'name', None)
                
                # Determine existing path for replacement
                has_existing = (
                    existing_value
                    and existing_value not in ('', 'NOT_FOUND')
                    and not existing_value.startswith('PENDING:')
                )
                
                if has_existing:
                    result = cls.replace_image(
                        image_bytes=image_bytes,
                        client=client,
                        field_name=field_name,
                        existing_path=existing_value,
                        card=card,
                        batch_counter=batch_counter,
                        original_ext=original_ext,
                        original_filename=original_filename,
                        uploaded_by=uploaded_by,
                    )
                else:
                    result = cls.save_new_image(
                        image_bytes=image_bytes,
                        client=client,
                        field_name=field_name,
                        card=card,
                        batch_counter=batch_counter,
                        original_ext=original_ext,
                        original_filename=original_filename,
                        uploaded_by=uploaded_by,
                    )
                
                return result
            except Exception as e:
                logger.error("process_image_field upload error for %s: %s", field_name, e)
                return MediaResult(success=False, message=str(e))
        
        # Normalize new_value
        if new_value is None:
            # None means "not sent / unchanged"
            return MediaResult(
                success=True,
                data={'final_value': existing_value, 'action': 'unchanged'},
            )
        
        new_value = str(new_value).strip() if new_value else ''
        
        # ── CASE 6: PENDING reference ───────────────────────────────
        if new_value.startswith('PENDING:'):
            return cls.mark_pending(field_name, new_value[8:])
        
        # ── CASE 2: Removal ─────────────────────────────────────────
        # Delegates to remove_image (single authority).
        if new_value == '':
            return cls.remove_image(field_name, existing_value, card=card)
        
        # Normalize the path
        new_value = BaseService.normalize_image_path(new_value)
        
        # ── CASE 4: Unchanged ───────────────────────────────────────
        normalized_existing = BaseService.normalize_image_path(existing_value)
        if new_value == normalized_existing:
            return MediaResult(
                success=True,
                data={'final_value': existing_value, 'action': 'unchanged'},
            )
        
        # ── CASE 3 / 5: Rewrite or missing ──────────────────────────
        if BaseService.validate_image_path(new_value):
            return MediaResult(
                success=True,
                data={'final_value': new_value, 'action': 'rewrite'},
            )
        else:
            # File doesn't exist on disk → mark PENDING
            filename = os.path.basename(new_value) if new_value else ''
            pending_val = f'PENDING:{filename}' if filename else ''
            logger.warning("Image not found for %s: %s → %s", field_name, new_value, pending_val)
            return MediaResult(
                success=True,
                data={'final_value': pending_val, 'action': 'missing'},
            )
    
    # ==================== FIELD TYPE HELPERS ====================
    
    @classmethod
    def is_image_field(cls, field_config: dict) -> bool:
        """Check if a field configuration represents an image field."""
        import re
        field_type = field_config.get('type', 'text').lower()
        field_name = field_config.get('name', '').lower()
        
        # Check by type
        if field_type in [t.lower() for t in IMAGE_FIELD_TYPES]:
            return True
        
        # Check by name pattern with word boundary matching
        # This prevents 'designation' from matching 'sign'
        for pattern in IMAGE_FIELD_NAME_PATTERNS:
            pattern_lower = pattern.lower()
            # Use word boundary regex for safer matching
            if re.search(r'\b' + re.escape(pattern_lower) + r'\b', field_name):
                return True
            # Exact match
            if field_name == pattern_lower:
                return True
        
        return False
    
    @classmethod
    def get_image_field_names(cls, fields: list) -> list:
        """Get names of all image fields from a list of field configurations."""
        return [f.get('name') for f in fields if cls.is_image_field(f)]
    
    # ==================== IMAGE PATH RETRIEVAL ====================
    
    @classmethod
    def get_image_path_for_card(
        cls,
        card,
        field_name: str,
        fallback_to_field_data: bool = True
    ) -> Optional[str]:
        """
        Get the image path for a card's field.
        
        Args:
            card: IDCard model instance
            field_name: Name of the image field
            fallback_to_field_data: Whether to check field_data as fallback
            
        Returns:
            Image path if found and valid, None otherwise
        """
        # Check CardMedia first (future implementation)
        # For now, use field_data
        if fallback_to_field_data:
            field_data = card.field_data or {}
            path = field_data.get(field_name, '')
            
            if path and path not in ('NOT_FOUND', '') and not path.startswith('PENDING:'):
                # Phase 2 guard: NEVER return a thumbnail path from this helper.
                # Exports and all read-helpers must always get the original.
                if ThumbnailService.is_thumbnail_path(path):
                    logger.warning(
                        "Blocked thumbnail path from get_image_path_for_card: %s", path
                    )
                    return None

                # Phase 2: If original missing on disk, fall back to thumbnail
                try:
                    if default_storage.exists(path):
                        return path
                    # Original missing — check thumbnail as fallback
                    thumb_path = ThumbnailService.get_thumbnail_path(path)
                    if thumb_path and default_storage.exists(thumb_path):
                        logger.info(
                            "Original missing, falling back to thumbnail: %s -> %s",
                            path, thumb_path,
                        )
                        return thumb_path
                except Exception:
                    pass
                # Return path anyway for backward compat (callers check existence)
                return path
        
        return None
    
    @classmethod
    def get_image_path_for_export(
        cls,
        card,
        field_name: str,
        prefer_thumbnail: bool = False,
        fallback_to_field_data: bool = True
    ) -> Optional[str]:
        """
        Get image path for export, with optional thumbnail preference.
        
        Phase 4 update: PDF/Word exports should use thumbnails for smaller file size.
        ZIP exports continue using originals.
        
        Args:
            card: IDCard model instance
            field_name: Name of the image field
            prefer_thumbnail: If True, try thumbnail first, fall back to original
            fallback_to_field_data: Whether to check field_data as fallback
            
        Returns:
            Image path (thumbnail if preferred and available, else original)
        """
        # Get original path first
        original_path = cls.get_image_path_for_card(
            card, field_name, fallback_to_field_data
        )
        
        if not original_path:
            return None
        
        if not prefer_thumbnail:
            return original_path
        
        # Try to get/create thumbnail
        thumb_path = ThumbnailService.get_thumbnail_path(original_path)
        if thumb_path:
            try:
                if default_storage.exists(thumb_path):
                    return thumb_path
                # Thumbnail missing — regenerate automatically (Phase 2)
                created = ThumbnailService.create_thumbnail(original_path)
                if created and default_storage.exists(created):
                    return created
            except Exception as e:
                logger.debug("Thumbnail not available for %s: %s", original_path, e)
        
        # Fall back to original
        return original_path
    
    @classmethod
    def get_all_images_for_card(
        cls,
        card,
        image_field_names: Optional[List[str]] = None,
        fallback_to_field_data: bool = True
    ) -> Dict[str, Optional[str]]:
        """
        Get all image paths for a card.
        
        Args:
            card: IDCard model instance
            image_field_names: List of field names to check (all if None)
            fallback_to_field_data: Whether to check field_data
            
        Returns:
            Dict mapping field names to image paths (None if no image)
        """
        result = {}
        field_data = card.field_data or {}
        
        fields_to_check = image_field_names or list(field_data.keys())
        
        for field_name in fields_to_check:
            path = field_data.get(field_name, '')
            if path and path not in ('NOT_FOUND', '') and not path.startswith('PENDING:'):
                result[field_name] = path
            else:
                result[field_name] = None
        
        return result
    
    @classmethod
    def get_image_bytes_for_card(
        cls,
        card,
        field_name: str,
        fallback_to_field_data: bool = True
    ) -> Optional[bytes]:
        """
        Get image bytes for a card's field.
        
        Args:
            card: IDCard model instance
            field_name: Name of the image field
            fallback_to_field_data: Whether to check field_data
            
        Returns:
            Image bytes if found, None otherwise
        """
        path = cls.get_image_path_for_card(card, field_name, fallback_to_field_data)
        if not path:
            return None
        
        try:
            if default_storage.exists(path):
                with default_storage.open(path, 'rb') as f:
                    return f.read()
        except Exception as e:
            logger.warning("Could not read image at %s: %s", path, e)
        
        return None
    
    # ==================== CARDMEDIA INTEGRATION ====================
    
    @classmethod
    def create_media_record(
        cls,
        saved_path: str,
        client,
        card=None,
        group=None,
        media_type: Optional[str] = 'photo',
        field_name: Optional[str] = None,
        original_filename: Optional[str] = None,
        uploaded_by=None
    ) -> 'MediaResult':
        """
        Create a CardMedia record for a saved image.
        
        This enables dual-write for gradual migration to CardMedia.
        """
        try:
            from ..models import CardMedia
            
            media = CardMedia.objects.create(
                card=card,
                group=group,
                client=client,
                file=saved_path,
                media_type=media_type or 'photo',
                field_name=field_name,
                original_filename=original_filename,
                uploaded_by=uploaded_by
            )
            
            return MediaResult(
                success=True,
                message="Media record created",
                data={'media': media, 'media_id': media.pk}
            )
            
        except Exception as e:
            logger.warning("Failed to create CardMedia record: %s", e)
            return MediaResult(success=False, message=str(e), data={'media': None})
    
    @classmethod
    def save_image_with_media_record(
        cls,
        file_content,
        client,
        card=None,
        group=None,
        field_name: Optional[str] = None,
        media_type: Optional[str] = None,
        existing_path: Optional[str] = None,
        batch_counter: int = 1,
        uploaded_by=None,
        original_filename: Optional[str] = None
    ) -> 'MediaResult':
        """
        Save image and create CardMedia record in one operation.
        """
        # Save the image with thumbnail
        if hasattr(file_content, 'read'):
            image_bytes = file_content.read()
            file_content.seek(0)
        else:
            image_bytes = file_content
        
        # Get extension
        original_ext = '.jpg'
        if original_filename:
            _, ext = os.path.splitext(original_filename)
            if ext:
                original_ext = ImageRenamer.normalize_extension(ext)
        
        result = cls.save_image_with_thumbnail(
            image_bytes,
            client,
            existing_path,
            batch_counter,
            original_ext
        )
        
        if not result.success:
            return result
        
        # Create media record
        saved_path = result.data.get('path')
        if not saved_path:
            return result  # No path to record
        
        media_result = cls.create_media_record(
            saved_path=saved_path,
            client=client,
            card=card,
            group=group,
            media_type=media_type or field_name or 'photo',
            field_name=field_name,
            original_filename=original_filename,
            uploaded_by=uploaded_by
        )
        
        # Merge results
        result.data.update(media_result.data)
        
        return result


# Backward compatibility alias
ServiceResult = MediaResult
