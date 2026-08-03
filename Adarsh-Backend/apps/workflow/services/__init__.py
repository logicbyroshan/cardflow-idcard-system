from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from apps.cards.models import Card, CardUniqueValue
from apps.cards.services import CardService
from apps.auditlogs.models import AuditLog
from apps.workflow.constants import WorkflowAction, WorkflowState, TRANSITION_MAP
from apps.workflow.models import WorkflowHistory
from apps.workflow.policies import WorkflowPolicy

class WorkflowService:
    @staticmethod
    @transaction.atomic
    def transition_card(card: Card, action: str, user, reason: str = None) -> Card:
        # 1. Map action to policy method
        policy_map = {
            WorkflowAction.VERIFY: WorkflowPolicy.can_verify,
            WorkflowAction.UNVERIFY: WorkflowPolicy.can_unverify,
            WorkflowAction.APPROVE: WorkflowPolicy.can_approve,
            WorkflowAction.UNAPPROVE: WorkflowPolicy.can_unapprove,
            WorkflowAction.DELETE: WorkflowPolicy.can_delete,
            WorkflowAction.RESTORE: WorkflowPolicy.can_restore,
            WorkflowAction.DOWNLOAD: WorkflowPolicy.can_download,
        }
        
        policy_func = policy_map.get(action)
        if not policy_func:
            raise ValidationError(f"Unknown action: {action}")
            
        if not policy_func(user, card):
            raise PermissionDenied("You do not have permission to perform this workflow action.")
            
        old_status = card.status
        
        # 2. Transition state validation
        if action == WorkflowAction.RESTORE:
            if old_status != WorkflowState.DELETED:
                raise ValidationError("Only DELETED records can be restored.")
            # Retrieve the previous status from the latest history entry
            history_entry = WorkflowHistory.objects.filter(
                card=card,
                new_status=WorkflowState.DELETED
            ).first()
            
            if history_entry:
                new_status = history_entry.old_status
            else:
                new_status = WorkflowState.PENDING
        else:
            # Look up allowed transitions
            if (old_status, action) not in TRANSITION_MAP:
                raise ValidationError(f"Transition from '{old_status}' via '{action}' is not allowed.")
            new_status = TRANSITION_MAP[(old_status, action)]
            
        # 3. Apply state changes
        if new_status == WorkflowState.DELETED:
            card.deleted_at = timezone.now()
            card.deleted_by = user
            # Free up unique constraint values when deleted
            CardUniqueValue.objects.filter(card=card).delete()
        else:
            # If transitioning from DELETED back to an active state, re-enforce unique values
            if old_status == WorkflowState.DELETED:
                card.deleted_at = None
                card.deleted_by = None
                CardService._enforce_unique_fields(str(card.table_id), str(card.id), card.data)
                
        card.status = new_status
        card.version += 1
        card.updated_by = user
        card.save()
        
        # 4. Save history record
        WorkflowHistory.objects.create(
            card=card,
            old_status=old_status,
            new_status=new_status,
            user=user,
            reason=reason
        )
        
        # 5. Log audit trail
        audit_event_map = {
            WorkflowAction.VERIFY: 'CARD_VERIFIED',
            WorkflowAction.UNVERIFY: 'CARD_UNVERIFIED',
            WorkflowAction.APPROVE: 'CARD_APPROVED',
            WorkflowAction.UNAPPROVE: 'CARD_UNAPPROVED',
            WorkflowAction.DELETE: 'CARD_DELETED',
            WorkflowAction.RESTORE: 'CARD_RESTORED',
            WorkflowAction.DOWNLOAD: 'CARD_DOWNLOADED',
        }
        
        AuditLog.objects.create(
            event_type=audit_event_map.get(action, 'CARD_UPDATED'),
            actor=user,
            target_organization_id=card.organization_id,
            details={
                "card_id": str(card.id),
                "table_id": str(card.table_id),
                "old_status": old_status,
                "new_status": new_status,
                "reason": reason
            }
        )
        
        return card

    @staticmethod
    @transaction.atomic
    def bulk_transition(table_id: str, action: str, card_ids: list, user, reason: str = None) -> list:
        if not card_ids:
            return []
            
        cards = list(Card.objects.filter(table_id=table_id, id__in=card_ids))
        if len(cards) != len(card_ids):
            found_ids = {str(c.id) for c in cards}
            missing_ids = set(card_ids) - found_ids
            raise ValidationError(f"Cards not found or do not belong to this table: {list(missing_ids)}")
            
        updated_cards = []
        for card in cards:
            updated_card = WorkflowService.transition_card(card, action, user, reason)
            updated_cards.append(updated_card)
            
        # Log bulk audit event
        if cards:
            AuditLog.objects.create(
                event_type='BULK_WORKFLOW_ACTION',
                actor=user,
                target_organization_id=cards[0].organization_id,
                details={
                    "table_id": table_id,
                    "action": action,
                    "card_ids": card_ids,
                    "reason": reason
                }
            )
            
        return updated_cards
