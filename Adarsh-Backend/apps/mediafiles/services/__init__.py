import os
import uuid
import hashlib
from io import BytesIO
from typing import BinaryIO
from PIL import Image
from django.conf import settings
from django.utils import timezone
from django.db import transaction
from rest_framework.exceptions import ValidationError, PermissionDenied
from apps.cards.models import Card
from apps.fields.models import Field
from apps.auditlogs.models import AuditLog
from apps.cards.policies import CardPolicy
from apps.mediafiles.models import MediaFile, MediaVariant, MediaReference
from apps.mediafiles.storage.factory import StorageFactory

class ChecksumService:
    @staticmethod
    def generate_checksum(content: BinaryIO) -> str:
        sha256 = hashlib.sha256()
        content.seek(0)
        for chunk in iter(lambda: content.read(4096), b""):
            sha256.update(chunk)
        content.seek(0)
        return sha256.hexdigest()


class ImageValidationService:
    @staticmethod
    def validate_image(file_name: str, content_type: str) -> None:
        allowed_extensions = getattr(settings, 'ALLOWED_IMAGE_EXTENSIONS', ['jpeg', 'jpg', 'png', 'webp'])
        allowed_mime_types = getattr(settings, 'ALLOWED_IMAGE_MIME_TYPES', ['image/jpeg', 'image/png', 'image/webp'])
        
        ext = os.path.splitext(file_name)[1].lower().replace('.', '')
        if ext not in allowed_extensions:
            raise ValidationError(f"File extension '.{ext}' is not allowed. Supported: {allowed_extensions}")
            
        if content_type not in allowed_mime_types:
            raise ValidationError(f"MIME type '{content_type}' is not allowed. Supported: {allowed_mime_types}")


class ThumbnailService:
    @staticmethod
    def generate_thumbnail(image_content: BinaryIO, max_size=(150, 150)) -> bytes:
        image_content.seek(0)
        img = Image.open(image_content)
        img.thumbnail(max_size)
        
        thumb_io = BytesIO()
        fmt = img.format or 'PNG'
        img.save(thumb_io, format=fmt)
        thumb_io.seek(0)
        return thumb_io.getvalue()


class StorageService:
    @staticmethod
    def get_storage():
        return StorageFactory.get_storage()


class MediaService:
    @staticmethod
    @transaction.atomic
    def upload_image(card: Card, field: Field, file_name: str, content_type: str, file_content: BinaryIO, user) -> MediaFile:
        # 1. Enforce security constraints
        proposed_data = dict(card.data or {})
        proposed_data[str(field.id)] = "proposed_media_id"
        
        if not CardPolicy.can_access_card(user, card):
            raise PermissionDenied("You do not have access to this card.")
        if not CardPolicy.can_write_card_data(user, str(card.table_id), proposed_data):
            raise PermissionDenied("You do not have permission to write card data.")
            
        # 2. Validate image
        ImageValidationService.validate_image(file_name, content_type)
        
        # 3. Calculate dimension & checksum
        file_content.seek(0)
        img = Image.open(file_content)
        width, height = img.size
        
        checksum = ChecksumService.generate_checksum(file_content)
        
        # 4. Save original file to storage
        storage = StorageService.get_storage()
        ext = os.path.splitext(file_name)[1].lower()
        file_uuid = uuid.uuid4()
        file_uuid_str = str(file_uuid)
        stored_name = f"media/{file_uuid_str[0:2]}/{file_uuid_str[2:4]}/{file_uuid_str}{ext}"
        
        file_content.seek(0)
        raw_bytes = file_content.read()
        try:
            from apps.imports.services.metadata import ImageMetadataService
            meta_dict = {
                "card_id": str(card.id),
                "table_id": str(card.table_id),
                "organization_id": str(card.organization_id),
                "media_id": file_uuid_str
            }
            raw_bytes = ImageMetadataService.embed_metadata(raw_bytes, ext.replace('.', ''), meta_dict)
        except Exception:
            pass
            
        file_content = BytesIO(raw_bytes)
        storage.save(stored_name, file_content)
        
        # Get file size
        file_content.seek(0, os.SEEK_END)
        file_size = file_content.tell()
        file_content.seek(0)
        
        # 5. Create MediaFile record
        media_file = MediaFile.objects.create(
            id=file_uuid,
            organization=card.organization,
            table=card.table,
            card=card,
            field=field,
            original_name=file_name,
            stored_name=stored_name,
            mime_type=content_type,
            extension=ext.replace('.', ''),
            file_size=file_size,
            width=width,
            height=height,
            checksum=checksum,
            storage_provider=getattr(settings, 'STORAGE_PROVIDER', 'local'),
            created_by=user
        )
        
        # 6. Generate thumbnail and save
        try:
            thumb_data = ThumbnailService.generate_thumbnail(file_content)
            thumb_uuid = uuid.uuid4()
            thumb_uuid_str = str(thumb_uuid)
            thumb_stored_name = f"media/{thumb_uuid_str[0:2]}/{thumb_uuid_str[2:4]}/{thumb_uuid_str}_thumb{ext}"
            
            thumb_io = BytesIO(thumb_data)
            storage.save(thumb_stored_name, thumb_io)
            
            MediaVariant.objects.create(
                media_file=media_file,
                variant_name='thumbnail',
                stored_name=thumb_stored_name,
                file_size=len(thumb_data),
                width=150,
                height=150
            )
        except Exception:
            pass  # Thumbnail is a non-blocking enhancement
            
        # 7. Check if field already references a media file (replace behavior)
        existing_ref = MediaReference.objects.filter(card=card, field=field).first()
        is_replace = existing_ref is not None
        if is_replace:
            # Soft-delete the old media file
            old_media = existing_ref.media_file
            old_media.is_deleted = True
            old_media.deleted_at = timezone.now()
            old_media.save()
            # Delete reference
            existing_ref.delete()
            
        # 8. Create new MediaReference
        MediaReference.objects.create(
            media_file=media_file,
            card=card,
            field=field
        )
        
        # 9. Update card data
        card_data = dict(card.data or {})
        card_data[str(field.id)] = str(media_file.id)
        card.data = card_data
        card.save()
        
        # 10. Audit log
        AuditLog.objects.create(
            event_type='MEDIA_REPLACE' if is_replace else 'MEDIA_UPLOAD',
            actor=user,
            target_organization=card.organization,
            details={
                "card_id": str(card.id),
                "field_id": str(field.id),
                "media_file_id": str(media_file.id),
                "original_name": file_name,
            }
        )
        
        return media_file

    @staticmethod
    @transaction.atomic
    def replace_image(card: Card, field: Field, file_name: str, content_type: str, file_content: BinaryIO, user) -> MediaFile:
        return MediaService.upload_image(card, field, file_name, content_type, file_content, user)

    @staticmethod
    @transaction.atomic
    def delete_image(card: Card, field: Field, user) -> None:
        proposed_data = dict(card.data or {})
        proposed_data[str(field.id)] = None
        
        if not CardPolicy.can_access_card(user, card):
            raise PermissionDenied("You do not have access to this card.")
        if not CardPolicy.can_write_card_data(user, str(card.table_id), proposed_data):
            raise PermissionDenied("You do not have permission to write card data.")
            
        # Find active reference
        ref = MediaReference.objects.filter(card=card, field=field).first()
        if ref:
            media_file = ref.media_file
            media_file.is_deleted = True
            media_file.deleted_at = timezone.now()
            media_file.save()
            
            ref.delete()
            
        # Remove from card data
        card_data = dict(card.data or {})
        if str(field.id) in card_data:
            card_data[str(field.id)] = None
            card.data = card_data
            card.save()
            
        AuditLog.objects.create(
            event_type='MEDIA_DELETE',
            actor=user,
            target_organization=card.organization,
            details={
                "card_id": str(card.id),
                "field_id": str(field.id),
            }
        )

    @staticmethod
    @transaction.atomic
    def restore_image(media_file_id: str, user) -> MediaFile:
        media_file = MediaFile.objects.select_related('card', 'field', 'organization').get(id=media_file_id)
        
        card = media_file.card
        field = media_file.field
        
        if not card or not field:
            raise ValidationError("Cannot restore a media file that is not associated with a card/field.")
            
        proposed_data = dict(card.data or {})
        proposed_data[str(field.id)] = str(media_file.id)
        
        if not CardPolicy.can_access_card(user, card):
            raise PermissionDenied("You do not have access to this card.")
        if not CardPolicy.can_write_card_data(user, str(card.table_id), proposed_data):
            raise PermissionDenied("You do not have permission to write card data.")
            
        if not media_file.is_deleted:
            return media_file
            
        # Restore record status
        media_file.is_deleted = False
        media_file.deleted_at = None
        media_file.save()
        
        # Check if there's currently an active image for this field
        existing_ref = MediaReference.objects.filter(card=card, field=field).first()
        if existing_ref:
            # Soft-delete the currently active image to make room for this restoration
            current_media = existing_ref.media_file
            current_media.is_deleted = True
            current_media.deleted_at = timezone.now()
            current_media.save()
            existing_ref.delete()
            
        # Recreate the active reference
        MediaReference.objects.create(
            media_file=media_file,
            card=card,
            field=field
        )
        
        # Restore card data link
        card_data = dict(card.data or {})
        card_data[str(field.id)] = str(media_file.id)
        card.data = card_data
        card.save()
        
        AuditLog.objects.create(
            event_type='CARD_RESTORED',
            actor=user,
            target_organization=card.organization,
            details={
                "card_id": str(card.id),
                "field_id": str(field.id),
                "media_file_id": str(media_file.id),
            }
        )
        
        return media_file
