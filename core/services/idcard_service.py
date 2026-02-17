"""
ID Card Service Module — SINGLE AUTHORITY for IDCard / IDCardTable mutations.

Contains: ID Card and ID Card Table CRUD, status management, search,
field upgrades, and default-group provisioning.

ARCHITECTURE RULES:
- All IDCard/IDCardTable mutations MUST go through IDCardService.
- Views must NOT call .save(), .create(), .delete() on IDCard or IDCardTable.
- Status changes delegate internally to WorkflowService.transition().
- Image handling delegates to ImageService (single authority for files).
"""
import logging
from typing import Dict, Any, List

from django.shortcuts import get_object_or_404
from django.db.models import Count

from ..models import IDCardGroup, IDCardTable, IDCard
from .base import BaseService, ServiceResult
from .image_service import ImageService

logger = logging.getLogger(__name__)


class IDCardService(BaseService):
    """
    Service for ID Card and ID Card Table operations.
    
    This is the core service handling:
    - ID Card Table CRUD (schema definition)
    - ID Card CRUD (individual records)
    - Status management (pending → verified → pool → approved → download → reprint)
    - Search across cards
    - Bulk operations
    """
    
    MAX_FIELDS_PER_TABLE = 20
    VALID_FIELD_TYPES = ['text', 'number', 'date', 'email', 'image', 'textarea', 'class', 'section',
                         'photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature']
    VALID_STATUSES = ['pending', 'verified', 'pool', 'approved', 'download', 'reprint']
    
    # Allowed status transitions: key = current status, value = list of valid target statuses
    VALID_TRANSITIONS = {
        'pending':  ['verified', 'pool'],
        'verified': ['approved', 'pending', 'pool'],
        'approved': ['download', 'verified', 'pool'],
        'download': ['approved', 'reprint'],
        'pool':     ['pending'],
        'reprint':  ['download'],
    }
    
    # Forward transitions that require all image fields to be present
    # key = target status, value = list of source statuses that trigger validation
    FORWARD_IMAGE_CHECK = {
        'verified': ['pending'],       # pending → verified
        'approved': ['verified'],      # verified → approved
    }
    
    @classmethod
    def _get_missing_image_fields(cls, card, image_field_names):
        """Return list of image field names that are missing/pending/not-found on a card."""
        missing = []
        field_data = card.field_data or {}
        for name in image_field_names:
            val = field_data.get(name, '')
            if not val or val == 'NOT_FOUND' or str(val).startswith('PENDING:'):
                missing.append(name)
        return missing
    
    @classmethod
    def _get_missing_mandatory_fields(cls, card, table_fields):
        """
        Return list of mandatory field names that are empty on a card.
        Checks both text fields and image fields marked as mandatory.
        """
        missing = []
        field_data = card.field_data or {}
        
        for field in table_fields:
            # Skip if field is not marked as mandatory
            if not field.get('mandatory', False):
                continue
            
            field_name = field.get('name', '')
            field_type = field.get('type', 'text')
            
            if not field_name:
                continue
            
            val = field_data.get(field_name, '')
            
            # Check if field is empty
            if field_type in cls.IMAGE_FIELD_TYPES:
                # Image field - check for missing/pending/not-found
                if not val or val == 'NOT_FOUND' or str(val).startswith('PENDING:'):
                    missing.append(field_name)
            else:
                # Text field - check for empty value
                if not val or str(val).strip() == '':
                    missing.append(field_name)
        
        return missing

    # ==================== ID Card Table Operations ====================
    
    @classmethod
    def serialize_table(cls, table: IDCardTable) -> Dict[str, Any]:
        """Serialize IDCardTable to dict"""
        return {
            'id': table.id,
            'name': table.name,
            'fields': table.fields,
            'field_count': len(table.fields) if table.fields else 0,
            'is_active': table.is_active,
            'created_at': table.created_at.strftime('%d-%b-%Y %I:%M %p'),
            'updated_at': table.updated_at.strftime('%d-%b-%Y %I:%M %p'),
        }
    
    @classmethod
    def create_table(cls, group_id: int, data: Dict[str, Any]) -> ServiceResult:
        """Create a new ID Card Table"""
        try:
            group = get_object_or_404(IDCardGroup, id=group_id)
            
            name = data.get('name', '').strip().upper()
            if not name:
                return ServiceResult(success=False, message='Table name is required!')
            
            fields = data.get('fields', [])
            if len(fields) > cls.MAX_FIELDS_PER_TABLE:
                return ServiceResult(
                    success=False, 
                    message=f'Maximum {cls.MAX_FIELDS_PER_TABLE} fields allowed!'
                )
            
            # Validate and normalize fields
            validated_fields = []
            for idx, field in enumerate(fields):
                field_name = field.get('name', '').strip().upper()
                field_type = field.get('type', 'text')
                
                if not field_name:
                    return ServiceResult(
                        success=False, 
                        message=f'Field {idx+1} name is required!'
                    )
                
                if field_type not in cls.VALID_FIELD_TYPES:
                    field_type = 'text'
                
                validated_fields.append({
                    'name': field_name,
                    'type': field_type,
                    'order': idx
                })
            
            table = IDCardTable.objects.create(
                group=group,
                name=name,
                fields=validated_fields,
                is_active=True
            )
            
            return ServiceResult(
                success=True,
                message='Table created successfully!',
                data={'table': cls.serialize_table(table)}
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def get_table(cls, table_id: int) -> ServiceResult:
        """Get a single ID Card Table"""
        try:
            table = get_object_or_404(IDCardTable, id=table_id)
            return ServiceResult(
                success=True,
                data={'table': cls.serialize_table(table)}
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def update_table(cls, table_id: int, data: Dict[str, Any]) -> ServiceResult:
        """Update an ID Card Table"""
        try:
            table = get_object_or_404(IDCardTable, id=table_id)
            
            name = data.get('name', '').strip().upper()
            if not name:
                return ServiceResult(success=False, message='Table name is required!')
            
            fields = data.get('fields', [])
            if len(fields) > cls.MAX_FIELDS_PER_TABLE:
                return ServiceResult(
                    success=False, 
                    message=f'Maximum {cls.MAX_FIELDS_PER_TABLE} fields allowed!'
                )
            
            # Validate fields
            validated_fields = []
            for idx, field in enumerate(fields):
                field_name = field.get('name', '').strip().upper()
                field_type = field.get('type', 'text')
                
                if not field_name:
                    return ServiceResult(
                        success=False, 
                        message=f'Field {idx+1} name is required!'
                    )
                
                if field_type not in cls.VALID_FIELD_TYPES:
                    field_type = 'text'
                
                validated_fields.append({
                    'name': field_name,
                    'type': field_type,
                    'order': idx
                })
            
            table.name = name
            table.fields = validated_fields
            table.save()
            
            return ServiceResult(
                success=True,
                message='Table updated successfully!',
                data={'table': cls.serialize_table(table)}
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def delete_table(cls, table_id: int) -> ServiceResult:
        """Delete an ID Card Table"""
        try:
            table = get_object_or_404(IDCardTable, id=table_id)
            table_name = table.name
            table.delete()
            
            return ServiceResult(
                success=True,
                message=f'Table "{table_name}" deleted successfully!'
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def toggle_table_status(cls, table_id: int) -> ServiceResult:
        """Toggle ID Card Table active/inactive status (atomic to prevent lost toggles)"""
        try:
            from django.db import transaction
            with transaction.atomic():
                table = IDCardTable.objects.select_for_update().get(id=table_id)
                table.is_active = not table.is_active
                status = 'active' if table.is_active else 'inactive'
                status_display = 'Active' if table.is_active else 'Inactive'
                table.save(update_fields=['is_active', 'updated_at'])
            
            return ServiceResult(
                success=True,
                message=f'Table status changed to {status_display}!',
                data={'status': status, 'status_display': status_display}
            )
        except IDCardTable.DoesNotExist:
            return ServiceResult(success=False, message='Table not found')
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def list_tables(cls, group_id: int) -> ServiceResult:
        """List all ID Card Tables for a group"""
        try:
            group = get_object_or_404(IDCardGroup, id=group_id)
            tables = IDCardTable.objects.filter(group=group)
            
            return ServiceResult(
                success=True,
                data={'tables': [cls.serialize_table(t) for t in tables]}
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))

    @classmethod
    def ensure_default_group(cls, client) -> 'IDCardGroup':
        """Return the first IDCardGroup for a client, creating one if none exists."""
        group = IDCardGroup.objects.filter(client=client).first()
        if not group:
            group = IDCardGroup.objects.create(
                client=client,
                name=f"{client.name} - Default Group",
                is_active=True,
            )
        return group
    
    # ==================== ID Card Operations ====================
    
    @classmethod
    def serialize_card(cls, card: IDCard, sr_no: int = None, table_fields: List[dict] = None) -> Dict[str, Any]:
        """Serialize IDCard to dict"""
        data = {
            'id': card.id,
            'table_id': card.table_id,
            'field_data': card.field_data,
            'photo': (card.field_data or {}).get('PHOTO') or (card.photo.url if card.photo else None),
            'status': card.status,
            'status_display': card.get_status_display(),
            'created_at': card.created_at.strftime('%d-%b-%Y %I:%M %p'),
            'updated_at': card.updated_at.strftime('%d-%b-%Y %I:%M %p'),
            'updated_at_iso': card.updated_at.isoformat() if card.updated_at else None,
        }
        
        if sr_no is not None:
            data['sr_no'] = sr_no
        
        # Add ordered_fields if table_fields provided
        if table_fields:
            ordered_fields = []
            field_data = card.field_data or {}
            
            # Create case-insensitive lookup
            field_data_normalized = {k.upper(): v for k, v in field_data.items()}
            
            # Reorder fields: text first, then images in canonical order
            # Must match the template filter reorder_fields_for_display
            reordered_fields = cls.reorder_fields_for_display(table_fields)
            
            for field in reordered_fields:
                field_name = field['name']
                field_type = field.get('type', 'text')
                
                # Check if it's an image field
                if cls.is_image_field(field):
                    field_type = 'image'
                
                # Get value (case-insensitive)
                field_value = field_data.get(field_name, '') or field_data_normalized.get(field_name.upper(), '')
                
                # Legacy fallback: if PHOTO field is empty, try card.photo (deprecated ImageField)
                if not field_value and field_name.upper() == 'PHOTO' and card.photo:
                    try:
                        field_value = card.photo.name or card.photo.url
                    except Exception:
                        pass
                
                ordered_fields.append({
                    'name': field_name,
                    'type': field_type,
                    'value': field_value,
                })
            
            data['ordered_fields'] = ordered_fields
        
        return data
    
    @classmethod
    def list_cards(
        cls, 
        table_id: int, 
        status_filter: str = None,
        offset: int = 0,
        limit: int = 100
    ) -> ServiceResult:
        """List ID Cards for a table with pagination"""
        try:
            table = get_object_or_404(IDCardTable, id=table_id)
            
            # Base queryset - newest first
            cards_query = IDCard.objects.filter(table=table).order_by('-id')
            
            if status_filter and status_filter in cls.VALID_STATUSES:
                cards_query = cards_query.filter(status=status_filter)
            
            total_count = cards_query.count()
            cards = cards_query[offset:offset + limit]
            
            # Serialize cards
            card_list = []
            for idx, card in enumerate(cards):
                card_list.append(cls.serialize_card(
                    card, 
                    sr_no=offset + idx + 1,
                    table_fields=table.fields
                ))
            
            # Get status counts
            status_counts = cls.get_status_counts(table)
            
            return ServiceResult(
                success=True,
                data={
                    'cards': card_list,
                    'total_count': total_count,
                    'offset': offset,
                    'limit': limit,
                    'has_more': offset + limit < total_count,
                    'status_counts': status_counts,
                    'table': cls.serialize_table(table),
                }
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def get_status_counts(cls, table: IDCardTable) -> Dict[str, int]:
        """Get count of cards by status for a table"""
        counts = {status: 0 for status in cls.VALID_STATUSES}
        counts['total'] = 0
        
        # Efficient aggregation
        status_agg = IDCard.objects.filter(table=table).values('status').annotate(count=Count('id'))
        
        for item in status_agg:
            counts[item['status']] = item['count']
            counts['total'] += item['count']
        
        return counts
    
    @classmethod
    def get_all_card_ids(cls, table_id: int, status_filter: str = None) -> ServiceResult:
        """Get all card IDs for a table (for Select All). Capped at 50,000."""
        MAX_CARD_IDS = 10000
        try:
            table = get_object_or_404(IDCardTable, id=table_id)
            
            cards_query = IDCard.objects.filter(table=table)
            if status_filter and status_filter in cls.VALID_STATUSES:
                cards_query = cards_query.filter(status=status_filter)
            
            card_ids = list(cards_query.values_list('id', flat=True)[:MAX_CARD_IDS])
            
            return ServiceResult(
                success=True,
                data={'card_ids': card_ids, 'total_count': len(card_ids)}
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def create_card(
        cls, 
        table_id: int, 
        field_data: Dict[str, Any],
        image_files: Dict[str, Any] = None,
        uploaded_by=None,
        legacy_photo_file=None,
    ) -> ServiceResult:
        """Create a new ID Card.

        Args:
            table_id: IDCardTable PK.
            field_data: Dict of field values (text + image paths).
            image_files: Dict of uploaded files keyed by ``image_<field_name>``.
            uploaded_by: User who triggered the upload.
            legacy_photo_file: Optional UploadedFile for the legacy ``photo``
                               key (pre-field-config tables).
        """
        try:
            from django.db import transaction
            table = get_object_or_404(IDCardTable, id=table_id)
            client = table.group.client
            
            # Uppercase text values only — preserve image paths
            field_data = cls.uppercase_field_data_selective(field_data, table.fields)
            
            # Track saved images for dual-write (Phase 2)
            saved_images = []
            
            # Handle image uploads if provided (outside transaction — disk I/O)
            image_counter = 0
            if image_files:
                for field in table.fields:
                    if cls.is_image_field(field):
                        field_name = field['name']
                        file_key = f"image_{field_name}"
                        
                        if file_key in image_files:
                            image_counter += 1
                            uploaded_file = image_files[file_key]
                            img_bytes = uploaded_file.read()
                            uploaded_file.seek(0)
                            original_ext = '.jpg'
                            if hasattr(uploaded_file, 'name') and uploaded_file.name:
                                _, _ext = __import__('os').path.splitext(uploaded_file.name)
                                if _ext:
                                    original_ext = _ext.lower()
                            result = ImageService.save_new_image(
                                image_bytes=img_bytes,
                                client=client,
                                field_name=field_name,
                                card=None,  # card not yet created
                                batch_counter=image_counter,
                                original_ext=original_ext,
                                original_filename=getattr(uploaded_file, 'name', None),
                                uploaded_by=uploaded_by,
                            )
                            if result.success:
                                field_data[field_name] = result.data['final_value']
                                saved_images.append({
                                    'path': result.data['final_value'],
                                    'field_name': field_name,
                                    'field_type': field.get('type', 'photo'),
                                    'original_filename': getattr(uploaded_file, 'name', None)
                                })
            
            # Atomic block: card creation + media records together
            with transaction.atomic():
                from .workflow_service import WorkflowService
                card = IDCard.objects.create(
                    table=table,
                    field_data=field_data,
                    status=WorkflowService.INITIAL_STATUS
                )
                
                # DUAL-WRITE: Create CardMedia records for saved images
                for img_info in saved_images:
                    try:
                        ImageService.create_media_record(
                            saved_path=img_info['path'],
                            client=client,
                            card=card,
                            field_name=img_info['field_name'],
                            media_type=img_info['field_type'],
                            original_filename=img_info['original_filename'],
                            uploaded_by=uploaded_by
                        )
                    except Exception as media_err:
                        logger.warning("Failed to create CardMedia for %s: %s", img_info['field_name'], media_err)
                
                # Legacy 'photo' key — old clients may send a separate photo file
                if legacy_photo_file:
                    try:
                        original_ext = '.jpg'
                        if hasattr(legacy_photo_file, 'name') and legacy_photo_file.name:
                            _, _ext = __import__('os').path.splitext(legacy_photo_file.name)
                            if _ext:
                                original_ext = _ext.lower()
                        img_bytes = legacy_photo_file.read()
                        legacy_photo_file.seek(0)
                        image_counter += 1
                        result = ImageService.save_new_image(
                            image_bytes=img_bytes,
                            client=client,
                            field_name='PHOTO',
                            card=card,
                            batch_counter=image_counter,
                            original_ext=original_ext,
                            original_filename=getattr(legacy_photo_file, 'name', None),
                            uploaded_by=uploaded_by,
                        )
                        if result.success and result.data.get('final_value'):
                            fd = card.field_data or {}
                            fd['PHOTO'] = result.data['final_value']
                            card.field_data = fd
                            card.save(update_fields=['field_data'])
                    except Exception as photo_err:
                        logger.error("Error saving legacy photo during create: %s", photo_err)
            
            return ServiceResult(
                success=True,
                message='ID Card created successfully!',
                data={'card': cls.serialize_card(card)}
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def get_card(cls, card_id: int) -> ServiceResult:
        """Get a single ID Card"""
        try:
            card = get_object_or_404(IDCard.objects.select_related('table'), id=card_id)
            
            data = cls.serialize_card(card)
            data['table_name'] = card.table.name
            
            return ServiceResult(success=True, data={'card': data})
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def update_card(
        cls, 
        card_id: int, 
        field_data: Dict[str, Any] = None,
        status: str = None,
        image_files: Dict[str, Any] = None,
        uploaded_by=None,
        expected_updated_at: str = None,
        legacy_photo_file=None,
    ) -> ServiceResult:
        """Update an ID Card with atomic concurrency control.

        Args:
            card_id: IDCard PK.
            field_data: Partial field_data to merge (text + image path values).
            status: Ignored — use WorkflowService.transition().
            image_files: Dict of uploaded files keyed by ``image_<field_name>``.
            uploaded_by: User who triggered the upload.
            expected_updated_at: ISO-8601 timestamp for optimistic concurrency.
                If the card was modified since this timestamp, a 'conflict'
                ServiceResult is returned.
            legacy_photo_file: Optional UploadedFile for the legacy ``photo``
                               key (pre-field-config tables).
        """
        try:
            from django.db import transaction as db_transaction
            from django.utils.dateparse import parse_datetime

            with db_transaction.atomic():
                # Lock the row to prevent concurrent writes
                card = IDCard.objects.select_for_update().select_related('table__group__client').get(id=card_id)
                table = card.table
                client = table.group.client

                # ── Optimistic concurrency check ──
                if expected_updated_at:
                    expected_dt = parse_datetime(expected_updated_at)
                    if expected_dt and card.updated_at and abs((card.updated_at - expected_dt).total_seconds()) > 1:
                        return ServiceResult(
                            success=False,
                            message='This card was modified by another user. Please refresh and try again.',
                            data={
                                'conflict': True,
                                'server_updated_at': card.updated_at.isoformat(),
                            },
                        )

                existing_data = card.field_data or {}
                image_field_names = cls.get_image_field_names(table.fields)

                if field_data:
                    field_data = cls.uppercase_field_data_selective(field_data, table.fields)

                    # Merge text (non-image) fields
                    for key, value in field_data.items():
                        if key not in image_field_names:
                            existing_data[key] = value

                    # Process each image field via ImageService.process_image_field
                    image_counter = 0
                    for img_field in image_field_names:
                        uploaded_file = image_files.get(f"image_{img_field}") if image_files else None
                        new_value = field_data.get(img_field)  # None if not sent

                        if uploaded_file is not None or new_value is not None:
                            existing_value = existing_data.get(img_field, '')
                            image_counter += 1
                            result = ImageService.process_image_field(
                                field_name=img_field,
                                new_value=new_value,
                                existing_value=existing_value,
                                client=client,
                                card=card,
                                uploaded_file=uploaded_file,
                                batch_counter=image_counter,
                                uploaded_by=uploaded_by,
                            )
                            if result.success:
                                existing_data[img_field] = result.data.get('final_value', existing_value)
                            else:
                                logger.warning("process_image_field failed for %s: %s", img_field, result.message)

                # Legacy 'photo' key
                if legacy_photo_file:
                    existing_photo = existing_data.get('PHOTO', '') or existing_data.get('Photo', '')
                    result = ImageService.process_image_field(
                        field_name='PHOTO',
                        new_value=None,  # upload takes precedence
                        existing_value=existing_photo,
                        client=client,
                        card=card,
                        uploaded_file=legacy_photo_file,
                        batch_counter=9,
                        uploaded_by=uploaded_by,
                    )
                    if result.success and result.data.get('action') == 'upload':
                        existing_data['PHOTO'] = result.data['final_value']
                        if 'Photo' in existing_data and 'Photo' != 'PHOTO':
                            del existing_data['Photo']
                    elif not result.success:
                        logger.warning("Could not save legacy photo: %s", result.message)

                card.field_data = existing_data

                # Status changes MUST go through WorkflowService.transition().
                if status:
                    logger.warning(
                        "IDCardService.update_card() called with status=%s for card %s — "
                        "ignored. Use WorkflowService.transition() instead.",
                        status, card_id
                    )

                card.save()

            # Refresh updated_at after commit so the caller can send it
            # back for the next concurrency check.
            card.refresh_from_db(fields=['updated_at'])

            card_data = cls.serialize_card(card)
            # Include ISO updated_at for concurrency round-trip
            card_data['updated_at_iso'] = card.updated_at.isoformat() if card.updated_at else None

            return ServiceResult(
                success=True,
                message='ID Card updated successfully!',
                data={'card': card_data}
            )

        except IDCard.DoesNotExist:
            return ServiceResult(success=False, message='Card not found')
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def update_single_field(cls, card_id: int, field: str, value: Any) -> ServiceResult:
        """Update a single field on an ID Card (for inline editing)"""
        try:
            from django.db import transaction
            with transaction.atomic():
                card = IDCard.objects.select_for_update().get(id=card_id)
                table = card.table
                
                if not field:
                    return ServiceResult(success=False, message='Field name is required!')
                
                field_data = card.field_data or {}
                
                if isinstance(value, str):
                    # Only uppercase non-image fields to protect image paths
                    if cls.is_image_field_name_for_table(field, table.fields):
                        field_data[field] = value
                    else:
                        field_data[field] = value.upper()
                else:
                    field_data[field] = value
                
                card.field_data = field_data
                card.save()
                
                return ServiceResult(
                    success=True,
                    message='Field updated successfully!',
                    data={'field': field, 'value': field_data[field]}
                )
            
        except IDCard.DoesNotExist:
            return ServiceResult(success=False, message='Card not found')
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def delete_card(cls, card_id: int) -> ServiceResult:
        """Delete an ID Card"""
        try:
            card = get_object_or_404(IDCard, id=card_id)
            card.delete()
            
            return ServiceResult(
                success=True,
                message='ID Card deleted successfully!'
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def change_status(cls, card_id: int, new_status: str, user=None, request=None) -> ServiceResult:
        """
        Change an ID Card's status — delegates to WorkflowService.transition().

        Kept as a thin wrapper so existing callers don't break.
        Permission & activity logging are handled by WorkflowService when
        user/request are supplied.
        """
        try:
            from .workflow_service import WorkflowService

            card = get_object_or_404(IDCard, id=card_id)
            return WorkflowService.transition(
                card, new_status, user=user, request=request,
                skip_permission=(user is None),
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def bulk_change_status(
        cls, 
        table_id: int, 
        card_ids: List[int], 
        new_status: str,
        user=None,
        request=None,
    ) -> ServiceResult:
        """
        Change status of multiple ID Cards — delegates to WorkflowService.bulk_transition().

        Kept as a thin wrapper so existing callers don't break.
        """
        try:
            from .workflow_service import WorkflowService

            table = get_object_or_404(IDCardTable, id=table_id)
            return WorkflowService.bulk_transition(
                table, card_ids, new_status,
                user=user, request=request,
                skip_permission=(user is None),
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def bulk_delete(
        cls, 
        table_id: int, 
        card_ids: List[int] = None, 
        delete_all: bool = False
    ) -> ServiceResult:
        """Delete multiple ID Cards"""
        try:
            table = get_object_or_404(IDCardTable, id=table_id)
            
            if delete_all:
                cards_qs = IDCard.objects.filter(table=table)
            else:
                cards_qs = IDCard.objects.filter(table=table, id__in=card_ids or [])
            
            from django.db import transaction
            with transaction.atomic():
                # Lock rows to prevent concurrent modifications during delete
                if delete_all:
                    locked_qs = IDCard.objects.select_for_update().filter(table=table)
                else:
                    locked_qs = IDCard.objects.select_for_update().filter(table=table, id__in=card_ids or [])
                
                # Collect image cleanup before deleting
                for card in list(locked_qs):
                    card.delete_images()
                
                deleted_count = locked_qs.count()
                locked_qs.delete()
            
            return ServiceResult(
                success=True,
                message=f'{deleted_count} cards deleted successfully!',
                data={'deleted_count': deleted_count}
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))
    
    @classmethod
    def search_cards(cls, table_id: int, query: str) -> ServiceResult:
        """Search ID Cards across all statuses"""
        try:
            if not query or len(query) < 2:
                return ServiceResult(
                    success=True,
                    data={'results': [], 'count': 0},
                    message='Please enter at least 2 characters to search'
                )
            
            table = get_object_or_404(IDCardTable, id=table_id)
            query_upper = query.strip().upper()
            
            MAX_SEARCH_RESULTS = 200
            # Use DB-level filtering instead of Python iteration
            cards = IDCard.objects.filter(
                table=table, field_data__icontains=query.strip()
            ).order_by('-id')[:MAX_SEARCH_RESULTS]
            results = []
            for card in cards:
                field_data = card.field_data or {}
                match_found = False
                matched_field = ''
                matched_value = ''
                
                for field_name, field_value in field_data.items():
                    if field_value and query_upper in str(field_value).upper():
                        match_found = True
                        matched_field = field_name
                        matched_value = str(field_value)
                        break
                
                if match_found:
                    # Get display name from first text field
                    display_name = ''
                    for field in table.fields:
                        if field.get('type') in ['text', 'textarea'] and field.get('name') in field_data:
                            display_name = field_data.get(field.get('name'), '')
                            break
                    
                    results.append({
                        'id': card.id,
                        'display_name': display_name or f'Card #{card.id}',
                        'status': card.status,
                        'status_display': card.get_status_display(),
                        'matched_field': matched_field,
                        'matched_value': matched_value,
                        'photo': (card.field_data or {}).get('PHOTO') or (card.photo.url if card.photo else None),
                        'field_data': card.field_data,
                    })
            
            return ServiceResult(
                success=True,
                data={
                    'results': results,
                    'count': len(results),
                    'query': query
                }
            )
            
        except Exception as e:
            return ServiceResult(success=False, message=str(e))

    @classmethod
    def upgrade_all_classes(cls, table_id: int) -> ServiceResult:
        """
        Upgrade the class field value for all download-status cards in a table.
        Each class value is bumped to the next level (e.g. V → VI).
        Cards at XII remain unchanged.
        Returns: ServiceResult with data={'upgraded', 'skipped', 'total'}
        """
        from core.utils.field_utils import CLASS_UPGRADE_MAP
        try:
            from django.db import transaction
            table = get_object_or_404(IDCardTable, id=table_id)
            fields = table.fields or []

            # Find the class field name
            class_field_name = None
            for field in fields:
                if field.get('type') == 'class':
                    class_field_name = field.get('name')
                    break

            if not class_field_name:
                return ServiceResult(
                    success=False,
                    message='No class field found in this table configuration'
                )

            cards = IDCard.objects.filter(table=table, status='download')
            total = cards.count()
            if total == 0:
                return ServiceResult(
                    success=False,
                    message='No cards in the Download list to upgrade'
                )

            upgraded = 0
            skipped = 0
            with transaction.atomic():
                BATCH_SIZE = 500
                cards_to_update = []
                for card in cards.iterator(chunk_size=BATCH_SIZE):
                    field_data = card.field_data or {}
                    current_val = str(field_data.get(class_field_name, '')).strip().upper()
                    if current_val in CLASS_UPGRADE_MAP:
                        field_data[class_field_name] = CLASS_UPGRADE_MAP[current_val]
                        card.field_data = field_data
                        cards_to_update.append(card)
                        upgraded += 1
                    else:
                        skipped += 1
                    # Flush batch to DB periodically to limit memory
                    if len(cards_to_update) >= BATCH_SIZE:
                        IDCard.objects.bulk_update(cards_to_update, ['field_data', 'updated_at'], batch_size=BATCH_SIZE)
                        cards_to_update = []
                if cards_to_update:
                    IDCard.objects.bulk_update(cards_to_update, ['field_data', 'updated_at'], batch_size=BATCH_SIZE)

            return ServiceResult(
                success=True,
                message=f'Upgraded {upgraded} card(s). {skipped} skipped (already XII or unknown value).',
                data={
                    'upgraded': upgraded,
                    'skipped': skipped,
                    'total': total,
                    'client_name': getattr(table.group.client, 'name', ''),
                }
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))