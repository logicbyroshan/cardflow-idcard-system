"""
Image Records — single-authority entry points + CardMedia integration.

Provides: ImageRecordsMixin (save_new_image, replace_image, mark_pending,
remove_image, create_media_record, save_image_with_media_record).

Part of the ImageService mixin split.
"""
import os
import logging
from typing import Optional

from django.core.files.base import ContentFile

from .image_rename import ImageRenamer
from .image_core import MediaResult

logger = logging.getLogger(__name__)


class ImageRecordsMixin:
    """
    Single-authority image mutation entry points and CardMedia record management.
    """

    # ==================== SINGLE-AUTHORITY ENTRY POINTS ====================
    # All image mutations MUST go through one of these four methods.
    # They guarantee: save + thumbnail + CardMedia + return final_value.
    # Callers store the returned data['final_value'] in field_data — nothing else.

    @staticmethod
    def _resolve_uploader_prefix(uploaded_by=None) -> str:
        """Map uploader role to filename prefix: admin-side='a', client-side='c'."""
        role = str(getattr(uploaded_by, 'role', '') or '').strip().lower()
        if role in ('client', 'client_staff'):
            return 'c'
        return 'a'

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
        uploader_prefix = cls._resolve_uploader_prefix(uploaded_by)
        result = cls.save_image_with_thumbnail(
            image_bytes=image_bytes,
            client=client,
            existing_path=None,
            batch_counter=batch_counter,
            original_ext=original_ext,
            uploader_prefix=uploader_prefix,
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
        delete_old_after_save: bool = True,
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

        uploader_prefix = cls._resolve_uploader_prefix(uploaded_by)

        result = cls.save_image_with_thumbnail(
            image_bytes=image_bytes,
            client=client,
            existing_path=existing_path,
            batch_counter=batch_counter,
            original_ext=original_ext,
            delete_existing_on_update=delete_old_after_save,
            uploader_prefix=uploader_prefix,
        )
        if not result.success:
            return result

        saved_path = result.data.get('path', '')

        # CardMedia: delete old, create new (atomic to prevent data loss)
        if card and saved_path:
            try:
                from django.db import transaction
                from ..models import CardMedia
                with transaction.atomic():
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
        if existing_path and not delete_old_after_save:
            result.data['old_path_to_delete'] = existing_path
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

                # Clear legacy photo ImageField if primary photo is being removed
                if field_name.upper() == 'PHOTO' and hasattr(card, 'photo') and card.photo:
                    try:
                        card.photo.delete(save=False)
                    except Exception as photo_err:
                        logger.warning("Failed to delete legacy card.photo: %s", photo_err)

        return MediaResult(
            success=True,
            data={'final_value': '', 'action': 'removal'},
        )

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
