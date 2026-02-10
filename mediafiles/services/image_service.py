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
        
        MAX_IMAGE_SIZE = 25 * 1024 * 1024  # 25MB per image
        if len(image_bytes) > MAX_IMAGE_SIZE:
            return False, f"Image too large ({len(image_bytes) // 1024 // 1024}MB). Maximum is 25MB."
        
        try:
            from PIL import Image
            
            # Protect against decompression bombs
            Image.MAX_IMAGE_PIXELS = 25_000_000  # ~25MP, reasonable for ID cards
            
            # Try to open and verify the image
            img = Image.open(BytesIO(image_bytes))
            img.verify()
            
            # Re-open to check it's actually readable
            img = Image.open(BytesIO(image_bytes))
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
    
    # ==================== IMAGE SAVING ====================
    
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
        
        Args:
            image_bytes: Raw image data
            client: Client model instance
            existing_path: Path of existing image (for updates)
            batch_counter: Counter for unique filename generation
            original_ext: Original file extension
            
        Returns:
            MediaResult with saved paths in data
        """
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
                return path
        
        return None
    
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
