import hashlib
from typing import Dict, Any
from django.db import transaction, IntegrityError
from apps.cards.models import Card, CardUniqueValue
from apps.fields.models import Field
from apps.auditlogs.models import AuditLog, AuditEvent
from rest_framework.exceptions import ValidationError

class StaleWriteError(Exception):
    pass

class CardService:
    @staticmethod
    def _enforce_unique_fields(table_id: str, card_id: str, data: Dict[str, Any]):
        unique_fields = Field.objects.filter(table_id=table_id, is_unique=True, is_deleted=False)
        for field in unique_fields:
            field_str_id = str(field.id)
            if field_str_id in data:
                value = data[field_str_id]
                if value is not None and str(value).strip() != "":
                    # Hash the value to ensure it fits in max_length=255 and index
                    value_hash = hashlib.sha256(str(value).encode('utf-8')).hexdigest()
                    try:
                        CardUniqueValue.objects.update_or_create(
                            card_id=card_id,
                            field_id=field.id,
                            defaults={'table_id': table_id, 'value_hash': value_hash}
                        )
                    except IntegrityError:
                        raise ValidationError(f"Unique constraint failed for field: {field.name}")
                else:
                    # Clean up value if set to None or empty
                    CardUniqueValue.objects.filter(card_id=card_id, field_id=field.id).delete()

    @staticmethod
    @transaction.atomic
    def create_card(table, organization_id: str, data: Dict[str, Any], created_by=None) -> Card:
        # Atomically increment the table's card_sequence to avoid race conditions
        # under concurrent bulk imports. select_for_update locks the table row.
        from django.db.models import F
        from apps.tables.models import Table as TableModel
        locked = TableModel.objects.select_for_update().get(pk=table.pk)
        locked.card_sequence = F('card_sequence') + 1
        locked.save(update_fields=['card_sequence'])
        locked.refresh_from_db(fields=['card_sequence'])
        seq = locked.card_sequence
        display_id = f"TBL-{seq}"

        card = Card.objects.create(
            table=table,
            organization_id=organization_id,
            display_id=display_id,
            data=data,
            created_by=created_by
        )

        CardService._enforce_unique_fields(str(table.id), str(card.id), data)

        AuditLog.objects.create(
            event_type=AuditEvent.CARD_CREATED,
            actor=created_by,
            target_organization_id=organization_id,
            details={"card_id": str(card.id), "table_id": str(table.id), "display_id": display_id}
        )
        return card

    @staticmethod
    @transaction.atomic
    def update_card(card: Card, data_update: Dict[str, Any], expected_version: int, updated_by=None) -> Card:
        if card.version != expected_version:
            raise StaleWriteError("Card has been modified by another user.")
            
        # Spreadsheet editing: targeted JSONB update (merge)
        new_data = dict(card.data)
        new_data.update(data_update)
        
        # Optimistic locking update
        updated_count = Card.objects.filter(id=card.id, version=expected_version).update(
            data=new_data,
            version=expected_version + 1,
            updated_by=updated_by
        )
        
        if updated_count == 0:
            raise StaleWriteError("Card has been modified by another user.")
            
        card.refresh_from_db()
        CardService._enforce_unique_fields(str(card.table_id), str(card.id), new_data)
        
        AuditLog.objects.create(
            event_type=AuditEvent.CARD_UPDATED,
            actor=updated_by,
            target_organization_id=card.organization_id,
            details={"card_id": str(card.id), "table_id": str(card.table_id), "version": card.version}
        )
        return card

    @staticmethod
    def delete_card(card: Card, deleted_by=None):
        card.soft_delete(user=deleted_by)
        # Remove unique values to free them up
        CardUniqueValue.objects.filter(card=card).delete()
        
        AuditLog.objects.create(
            event_type=AuditEvent.CARD_DELETED,
            actor=deleted_by,
            target_organization_id=card.organization_id,
            details={"card_id": str(card.id), "table_id": str(card.table_id)}
        )
