"""
Client Image Service — image upload and card-matching logic.
"""
import os

from core.models import Client, IDCardTable, IDCard
from core.services.base import BaseService, ServiceResult
from core.services.permission_service import PermissionService

from .services_access import ClientAccessService


class ClientImageService(BaseService):
    """
    Service for client image uploads.
    Handles image upload and linking to card data.
    """
    
    @classmethod
    def upload_images(cls, user, table_id: int, images) -> ServiceResult:
        """
        Upload images and link them to cards based on filename matching.
        
        Args:
            user: Current user
            table_id: ID of the table
            images: List of uploaded image files
        """
        try:
            client = ClientAccessService.get_client_for_user(user)
            if not client:
                return ServiceResult(success=False, message='Client profile not found')
            
            # Verify table access
            try:
                table = IDCardTable.objects.get(id=table_id)
            except IDCardTable.DoesNotExist:
                return ServiceResult(success=False, message='Table not found')
            
            if not ClientAccessService.can_access_table(user, table):
                return ServiceResult(success=False, message='Access denied')
            
            # Check upload permission
            if not PermissionService.has_permission(user, 'perm_reupload_idcard_image'):
                return ServiceResult(success=False, message='No permission to upload images')
            
            # Use the mediafiles ImageService for actual processing
            from mediafiles.services import ImageService
            
            matched = 0
            failed = 0
            for image in images:
                original_name = getattr(image, 'name', '')
                name_without_ext = os.path.splitext(original_name)[0] if original_name else ''
                
                # Find cards in the table that reference this image name
                cards = IDCard.objects.filter(table_id=table_id)
                for card in cards:
                    fd = card.field_data or {}
                    updated = False
                    for key, val in fd.items():
                        if isinstance(val, str) and name_without_ext and name_without_ext.lower() in val.lower():
                            try:
                                image.seek(0)
                                img_bytes = image.read()
                                result = ImageService.save_image(
                                    image_bytes=img_bytes,
                                    field_name=key,
                                    card=card,
                                    client=client,
                                    original_filename=original_name,
                                )
                                if result.success and result.data.get('path'):
                                    fd[key] = result.data['path']
                                    updated = True
                            except Exception:
                                failed += 1
                    if updated:
                        card.field_data = fd
                        card.save(update_fields=['field_data', 'updated_at'])
                        matched += 1
            
            return ServiceResult(
                success=True,
                message=f'Reupload complete: {matched} images matched, {failed} failed.',
                data={'matched': matched, 'failed': failed}
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
