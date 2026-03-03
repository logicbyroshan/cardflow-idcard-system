"""
IDCard Card Service — individual card CRUD, status, serialization.

Part of the IDCardService split. Handles:
- IDCard serialization, CRUD, single-field update
- Status change (thin wrapper around WorkflowService)
- Status counts, card-ID listing
- Helper methods for image/mandatory field checks, class/section extraction,
  class filtering, and name-field detection.
"""
import logging
from typing import Dict, Any, List

from django.shortcuts import get_object_or_404
from django.db.models import Count
from django.utils.timezone import localtime

from idcards.models import IDCardGroup, IDCardTable, IDCard
from .base import BaseService, ServiceResult
from .image_service import ImageService

logger = logging.getLogger(__name__)


class IDCardCardService(BaseService):
    """Service for individual ID Card operations."""

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

    # ==================== Helper Methods ====================

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

    @classmethod
    def _get_class_section_field_names(cls, table):
        """Extract class and section field names from table field definitions."""
        class_field = None
        section_field = None
        if table.fields:
            for field in table.fields:
                fname = field.get('name', '')
                ftype = field.get('type', '')
                if ftype == 'class' or (not class_field and fname.lower() == 'class'):
                    class_field = fname
                if ftype == 'section' or (not section_field and fname.lower() == 'section'):
                    section_field = fname
        return class_field, section_field

    @classmethod
    def _apply_class_filter(cls, qs, class_filter, class_field_name):
        """Apply class filter with canonical normalization.

        Finds all raw variants that normalize to the same canonical class
        and matches them all.  E.g. filtering by 'KG1' also finds
        'KG-I', 'KGI', 'LKG', 'kgI', etc.
        """
        from django.db.models.fields.json import KeyTextTransform
        from django.db.models.functions import Cast
        from django.db.models import CharField, Q
        from core.utils.field_utils import normalize_class_value

        norm_filter = normalize_class_value(class_filter)

        # Get all distinct raw class values
        all_raw = list(
            qs.annotate(_cv_raw=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
            .exclude(_cv_raw__isnull=True).exclude(_cv_raw='')
            .order_by()
            .values_list('_cv_raw', flat=True).distinct()
        )

        matching_raw = [r for r in all_raw if normalize_class_value(r) == norm_filter]

        if not matching_raw:
            return qs.none()

        qs = qs.annotate(_cls=KeyTextTransform(class_field_name, 'field_data'))
        q = Q()
        for raw in matching_raw:
            q |= Q(_cls=raw)
        return qs.filter(q)

    @classmethod
    def _get_name_field(cls, table):
        """Get the name/text field from table definitions for sorting."""
        if not table.fields:
            return None
        for field in table.fields:
            ftype = field.get('type', '')
            fname = field.get('name', '')
            if fname.lower() == 'name' or fname.lower() == 'student name':
                return fname
        # Fallback: first text field
        for field in table.fields:
            ftype = field.get('type', '')
            if ftype in ('text', 'name', ''):
                return field.get('name', '')
        return None

    # ==================== Serialization ====================

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
            'created_at': localtime(card.created_at).strftime('%d-%b-%Y %H:%M'),
            'updated_at': localtime(card.updated_at).strftime('%d-%b-%Y %H:%M'),
            'updated_at_iso': card.updated_at.isoformat() if card.updated_at else None,
            'downloaded_at': localtime(card.downloaded_at).strftime('%d-%b-%Y %H:%M') if card.downloaded_at else None,
            'deleted_at': localtime(card.deleted_at).strftime('%d-%b-%Y %H:%M') if card.deleted_at else None,
            'modified_by': card.modified_by or '',
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

    # ==================== List / Query ====================

    @classmethod
    def list_cards(
        cls,
        table_id: int,
        status_filter: str = None,
        offset: int = 0,
        limit: int = 100,
        search: str = '',
        class_filter: str = '',
        section_filter: str = '',
        sort_order: str = 'sr-asc',
        image_column: str = '',
        image_condition: str = '',
        from_date: str = '',
        to_date: str = '',
    ) -> ServiceResult:
        """List ID Cards for a table with pagination and server-side filtering."""
        from django.db.models.fields.json import KeyTextTransform
        from django.db.models.functions import Cast
        from django.db.models import Q, CharField

        try:
            table = get_object_or_404(IDCardTable, id=table_id)

            # Base queryset
            cards_query = IDCard.objects.filter(table=table)

            if status_filter and status_filter in cls.VALID_STATUSES:
                cards_query = cards_query.filter(status=status_filter)

            # --- Server-side search ---
            if search:
                cards_query = cards_query.filter(field_data__icontains=search)

            # --- Class / Section filters (with canonical normalization) ---
            if class_filter or section_filter:
                class_field_name, section_field_name = cls._get_class_section_field_names(table)
                if class_filter and class_field_name:
                    cards_query = cls._apply_class_filter(cards_query, class_filter, class_field_name)
                if section_filter and section_field_name:
                    cards_query = cards_query.annotate(
                        _sec=KeyTextTransform(section_field_name, 'field_data')
                    ).filter(_sec__iexact=section_filter)

            # --- Image sort filter ---
            # Cast() avoids SQLite crash: JSON_EXTRACT('', '$') is invalid.
            if image_column and image_condition in ('complete', 'pending', 'incomplete'):
                cards_query = cards_query.annotate(
                    _img=Cast(KeyTextTransform(image_column, 'field_data'), CharField())
                )
                if image_condition == 'complete':
                    cards_query = cards_query.exclude(_img__isnull=True).exclude(_img='').exclude(_img='NOT_FOUND')
                    cards_query = cards_query.exclude(_img__startswith='PENDING:')
                elif image_condition == 'pending':
                    cards_query = cards_query.filter(_img__startswith='PENDING:')
                elif image_condition == 'incomplete':
                    cards_query = cards_query.filter(Q(_img__isnull=True) | Q(_img='') | Q(_img='NOT_FOUND'))

            # --- DateTime range filter (download list) ---
            if status_filter == 'download' and (from_date or to_date):
                from datetime import datetime as dt
                from django.utils.timezone import make_aware, is_naive
                if from_date:
                    try:
                        from_dt = dt.fromisoformat(from_date)
                        from_dt = make_aware(from_dt) if is_naive(from_dt) else from_dt
                        cards_query = cards_query.filter(downloaded_at__gte=from_dt)
                    except (ValueError, TypeError):
                        pass
                if to_date:
                    try:
                        to_dt = dt.fromisoformat(to_date)
                        to_dt = make_aware(to_dt) if is_naive(to_dt) else to_dt
                        cards_query = cards_query.filter(downloaded_at__lte=to_dt)
                    except (ValueError, TypeError):
                        pass

            # --- Sorting ---
            if sort_order == 'sr-desc':
                cards_query = cards_query.order_by('id')
            elif sort_order == 'name-asc':
                # Sort by first text field in field_data (Name/name)
                name_field = cls._get_name_field(table)
                if name_field:
                    cards_query = cards_query.annotate(
                        _name=KeyTextTransform(name_field, 'field_data')
                    ).order_by('_name')
                else:
                    cards_query = cards_query.order_by('-id')
            elif sort_order == 'name-desc':
                name_field = cls._get_name_field(table)
                if name_field:
                    cards_query = cards_query.annotate(
                        _name=KeyTextTransform(name_field, 'field_data')
                    ).order_by('-_name')
                else:
                    cards_query = cards_query.order_by('-id')
            elif sort_order == 'date-new':
                cards_query = cards_query.order_by('-updated_at')
            elif sort_order == 'date-old':
                cards_query = cards_query.order_by('updated_at')
            else:
                # Default: sr-asc — show recently moved cards first
                # Download list: order by downloaded_at (most recent download first)
                # Other lists: order by updated_at (most recently moved first)
                if status_filter == 'download':
                    cards_query = cards_query.order_by('-downloaded_at', '-id')
                elif status_filter == 'pool':
                    cards_query = cards_query.order_by('-deleted_at', '-id')
                else:
                    cards_query = cards_query.order_by('-updated_at', '-id')

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
            logger.error("list_cards error for table_id=%s: %s", table_id, e, exc_info=True)
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
    def get_all_card_ids(cls, table_id: int, status_filter: str = None,
                         search: str = '', class_filter: str = '', section_filter: str = '',
                         from_date: str = '', to_date: str = '',
                         image_column: str = '', image_condition: str = '') -> ServiceResult:
        """Get all card IDs for a table (for Select All). Capped at 50,000."""
        from django.db.models.fields.json import KeyTextTransform
        from django.db.models.functions import Cast
        from django.db.models import Q, CharField

        MAX_CARD_IDS = 10000
        try:
            table = get_object_or_404(IDCardTable, id=table_id)

            cards_query = IDCard.objects.filter(table=table)
            if status_filter and status_filter in cls.VALID_STATUSES:
                cards_query = cards_query.filter(status=status_filter)

            # Apply search filter
            if search:
                cards_query = cards_query.filter(field_data__icontains=search)

            # Apply class/section with canonical normalization
            if class_filter or section_filter:
                class_field_name, section_field_name = cls._get_class_section_field_names(table)
                if class_filter and class_field_name:
                    cards_query = cls._apply_class_filter(cards_query, class_filter, class_field_name)
                if section_filter and section_field_name:
                    cards_query = cards_query.annotate(
                        _sec=KeyTextTransform(section_field_name, 'field_data')
                    ).filter(_sec__iexact=section_filter)

            # Apply image sort filter
            # Cast() avoids SQLite crash: JSON_EXTRACT('', '$') is invalid.
            if image_column and image_condition in ('complete', 'pending', 'incomplete'):
                cards_query = cards_query.annotate(
                    _img=Cast(KeyTextTransform(image_column, 'field_data'), CharField())
                )
                if image_condition == 'complete':
                    cards_query = cards_query.exclude(_img__isnull=True).exclude(_img='').exclude(_img='NOT_FOUND')
                    cards_query = cards_query.exclude(_img__startswith='PENDING:')
                elif image_condition == 'pending':
                    cards_query = cards_query.filter(_img__startswith='PENDING:')
                elif image_condition == 'incomplete':
                    cards_query = cards_query.filter(Q(_img__isnull=True) | Q(_img='') | Q(_img='NOT_FOUND'))

            # DateTime range filter (download list)
            if from_date:
                try:
                    from django.utils.dateparse import parse_datetime
                    dt = parse_datetime(from_date)
                    if dt:
                        cards_query = cards_query.filter(downloaded_at__gte=dt)
                except (ValueError, TypeError):
                    pass
            if to_date:
                try:
                    from django.utils.dateparse import parse_datetime
                    dt = parse_datetime(to_date)
                    if dt:
                        cards_query = cards_query.filter(downloaded_at__lte=dt)
                except (ValueError, TypeError):
                    pass

            card_ids = list(cards_query.order_by('-id').values_list('id', flat=True)[:MAX_CARD_IDS])

            return ServiceResult(
                success=True,
                data={'card_ids': card_ids, 'total_count': len(card_ids)}
            )
        except Exception as e:
            return ServiceResult(success=False, message=str(e))

    # ==================== CRUD ====================

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
        modified_by: str = None,
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

                # Track who performed the update
                if modified_by:
                    card.modified_by = modified_by
                elif uploaded_by and hasattr(uploaded_by, 'username'):
                    card.modified_by = uploaded_by.username

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
    def update_single_field(cls, card_id: int, field: str, value: Any, modified_by: str = None) -> ServiceResult:
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
                if modified_by:
                    card.modified_by = modified_by
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
