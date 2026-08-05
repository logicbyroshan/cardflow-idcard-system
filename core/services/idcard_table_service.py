"""
IDCard Table Service — table schema CRUD and default-group provisioning.

Part of the IDCardService split. Handles:
- IDCardTable serialization, CRUD, toggle, list
- Default IDCardGroup creation
"""
import logging
from typing import Dict, Any

from django.shortcuts import get_object_or_404
from django.utils.timezone import localtime

from idcards.models import IDCardGroup, IDCardTable
from .base import BaseService, ServiceResult

logger = logging.getLogger(__name__)


class IDCardTableService(BaseService):
    """Service for ID Card Table (schema) operations."""

    MAX_FIELDS_PER_TABLE = 30
    VALID_FIELD_TYPES = [
        'text', 'number', 'date', 'email', 'image', 'textarea', 'class', 'section',
        'photo', 'rel_photo', 'mother_photo', 'father_photo', 'barcode', 'qr_code', 'signature',
        'select', 'class_section',
    ]
    LEGACY_REL_PHOTO_ALIASES = {'mother_photo', 'father_photo'}

    VALID_TABLE_TYPES = {'school_student', 'college_student', 'staff', 'custom'}

    @classmethod
    def _normalize_field_type(cls, field_type: str) -> str:
        """Map legacy relation-photo aliases to canonical rel_photo."""
        normalized = str(field_type or 'text').strip().lower()
        if normalized in cls.LEGACY_REL_PHOTO_ALIASES:
            return 'rel_photo'
        return normalized

    @classmethod
    def _infer_table_type(cls, table_name: str, org_name: str = '') -> str:
        """Smart-detect table type from table name and organisation name.

        Rules (case-insensitive, first match wins):
        - Contains 'staff' | 'teacher' | 'employee' | 'faculty'  → 'staff'
        - Contains 'student' | 'pupil' | 'scholar':
            - org name contains 'college' | 'university' | 'institute' → 'college_student'
            - org name contains 'school' | 'vidyalaya' | 'academy'  → 'school_student'
            - fallback → 'school_student'
        - Otherwise → 'custom'
        """
        import re
        name_l = (table_name or '').lower()
        org_l  = (org_name or '').lower()

        staff_keywords   = r'\b(staff|teacher|employee|faculty|personnel|hr)\b'
        student_keywords = r'\b(student|pupil|scholar|learner)\b'
        college_org_kw   = r'\b(college|university|institute|polytechnic|degree)\b'
        school_org_kw    = r'\b(school|vidyalaya|academy|convent|bal|bal-vidya|bal vidya)\b'

        if re.search(staff_keywords, name_l):
            return 'staff'

        if re.search(student_keywords, name_l):
            if re.search(college_org_kw, org_l):
                return 'college_student'
            # school keyword in org or table name itself
            if re.search(school_org_kw, org_l) or re.search(school_org_kw, name_l):
                return 'school_student'
            # Default student → school_student
            return 'school_student'

        return 'custom'

    # ==================== Serialization ====================

    @classmethod
    def serialize_table(cls, table: IDCardTable) -> Dict[str, Any]:
        """Serialize IDCardTable to dict"""
        normalized_fields = []
        for field in (table.fields or []):
            if not isinstance(field, dict):
                continue
            normalized = dict(field)
            normalized['type'] = cls._normalize_field_type(field.get('type', 'text'))
            normalized_fields.append(normalized)

        return {
            'id': table.id,
            'name': table.name,
            'table_type': getattr(table, 'table_type', 'custom') or 'custom',
            'table_type_display': dict([
                ('school_student', 'School Student'),
                ('college_student', 'College Student'),
                ('staff', 'Staff'),
                ('custom', 'Custom'),
            ]).get(getattr(table, 'table_type', 'custom') or 'custom', 'Custom'),
            'fields': normalized_fields,
            'field_count': len(normalized_fields),
            'is_active': table.is_active,
            'created_at': localtime(table.created_at).strftime('%d-%b-%Y %H:%M'),
            'updated_at': localtime(table.updated_at).strftime('%d-%b-%Y %H:%M'),
        }

    # ==================== CRUD ====================

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
                field_type = cls._normalize_field_type(field.get('type', 'text'))
                field_mandatory = bool(field.get('mandatory', False))
                field_show_path = bool(field.get('show_path', False))

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
                    'order': idx,
                    'mandatory': field_mandatory,
                    'show_path': field_show_path
                })

            # Determine table type: use explicit value if valid, else auto-detect
            org_name = getattr(group.client, 'name', '') if group.client_id else ''
            raw_type = str(data.get('table_type') or '').strip().lower()
            if raw_type in cls.VALID_TABLE_TYPES:
                table_type = raw_type
            else:
                table_type = cls._infer_table_type(name, org_name)

            table = IDCardTable.objects.create(
                group=group,
                name=name,
                table_type=table_type,
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
                field_type = cls._normalize_field_type(field.get('type', 'text'))
                field_mandatory = bool(field.get('mandatory', False))
                field_show_path = bool(field.get('show_path', False))

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
                    'order': idx,
                    'mandatory': field_mandatory,
                    'show_path': field_show_path
                })

            # Determine / update table type
            org_name = getattr(table.group.client, 'name', '') if table.group.client_id else ''
            raw_type = str(data.get('table_type') or '').strip().lower()
            if raw_type in cls.VALID_TABLE_TYPES:
                table_type = raw_type
            else:
                table_type = cls._infer_table_type(name, org_name)

            table.name = name
            table.table_type = table_type
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
