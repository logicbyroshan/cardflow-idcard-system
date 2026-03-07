"""
Reprint Card Services
=====================
ReprintWorkflowService — all mutations for ReprintRequest.

ARCHITECTURE RULES:
- No .save() / .create() / .delete() in views.
- All mutations flow through this class.
"""
from typing import Any, Dict, List

from django.db import transaction

from idcards.models import IDCard, IDCardTable
from core.services.base import ServiceResult
from .models import ReprintRequest


class ReprintWorkflowService:
    """
    Single authority for ReprintRequest status transitions.

    Workflow: confirmed → downloaded (after send-to-print)
    Reject deletes the ReprintRequest and moves card to IDCard pool.
    """

    ALLOWED_TRANSITIONS: Dict[str, List[str]] = {
        'requested':  ['confirmed'],
        'confirmed':  ['downloaded'],
        'downloaded': [],
    }

    VALID_STATUSES = ['requested', 'confirmed', 'downloaded']

    INITIAL_STATUS = 'confirmed'

    # ── Single transition ───────────────────────────────────────────

    @classmethod
    def transition(
        cls,
        reprint_req: ReprintRequest,
        target_status: str,
        user=None,
    ) -> ServiceResult:
        """Transition a single ReprintRequest."""
        if target_status not in cls.VALID_STATUSES:
            return ServiceResult(success=False, message=f'Invalid reprint status: {target_status}')

        with transaction.atomic():
            try:
                reprint_req = ReprintRequest.objects.select_for_update().get(pk=reprint_req.pk)
            except ReprintRequest.DoesNotExist:
                return ServiceResult(success=False, message='Reprint request not found')

            current = reprint_req.status
            allowed = cls.ALLOWED_TRANSITIONS.get(current, [])
            if target_status not in allowed:
                return ServiceResult(
                    success=False,
                    message=f'Cannot change reprint status from {current} to {target_status}.'
                )

            reprint_req.status = target_status
            reprint_req.save(update_fields=['status', 'updated_at'])

        return ServiceResult(
            success=True,
            message=f'Reprint request status changed to {target_status}.',
            data={'status': target_status}
        )

    # ── Bulk transition ─────────────────────────────────────────────

    @classmethod
    def bulk_transition(
        cls,
        table: IDCardTable,
        rr_ids: List[int],
        target_status: str,
        user=None,
    ) -> ServiceResult:
        """Transition multiple ReprintRequests to target_status."""
        if target_status not in cls.VALID_STATUSES:
            return ServiceResult(success=False, message=f'Invalid reprint status: {target_status}')

        valid_from = [s for s, targets in cls.ALLOWED_TRANSITIONS.items() if target_status in targets]
        if not valid_from:
            return ServiceResult(success=False, message=f'No valid source status for {target_status}.')

        updated = ReprintRequest.objects.filter(
            id__in=rr_ids, table=table, status__in=valid_from
        ).update(status=target_status)

        if not updated:
            return ServiceResult(
                success=False,
                message=f'No reprint requests eligible for transition to {target_status}.'
            )

        return ServiceResult(
            success=True,
            message=f'{updated} reprint(s) updated to {target_status}.',
            data={'updated_count': updated}
        )

    # ── Create / reject ─────────────────────────────────────────────

    @classmethod
    def create_requests(
        cls,
        table: IDCardTable,
        card_ids: List[int],
        reason: str = '',
        requested_by=None,
    ) -> ServiceResult:
        """Create reprint requests for the given card IDs.
        Skips cards that already have a pending/confirmed reprint request.
        """
        if not card_ids:
            return ServiceResult(success=False, message='No card IDs provided')

        valid_ids = set(
            IDCard.objects.filter(table=table, id__in=card_ids)
            .values_list('id', flat=True)
        )

        already_requested = set(
            ReprintRequest.objects.filter(
                table=table,
                card_id__in=valid_ids,
                status__in=['requested', 'confirmed'],
            ).values_list('card_id', flat=True)
        )

        new_ids = valid_ids - already_requested
        created = 0
        for cid in new_ids:
            ReprintRequest.objects.create(
                card_id=cid,
                table=table,
                status=cls.INITIAL_STATUS,
                reason=reason,
                requested_by=requested_by,
            )
            created += 1

        return ServiceResult(
            success=True,
            message=f'{created} reprint request(s) created',
            data={
                'created_count': created,
                'skipped_count': len(already_requested & set(card_ids)),
            },
        )

    @classmethod
    def reject_requests(
        cls,
        table: IDCardTable,
        rr_ids: List[int],
        move_card_to_pool: bool = True,
    ) -> ServiceResult:
        """Reject (delete) reprint requests and optionally move cards to IDCard pool."""
        if not rr_ids:
            return ServiceResult(success=False, message='No reprint IDs provided')

        rr_qs = ReprintRequest.objects.filter(
            id__in=rr_ids, table=table, status__in=['requested', 'confirmed']
        )

        if move_card_to_pool:
            card_ids = list(rr_qs.values_list('card_id', flat=True))
            if card_ids:
                IDCard.objects.filter(id__in=card_ids).update(status='pool')

        deleted, _ = rr_qs.delete()

        return ServiceResult(
            success=True,
            message=f'{deleted} reprint(s) rejected and moved to pool',
            data={'rejected_count': deleted},
        )

    # ── Debug / introspection ───────────────────────────────────────

    @classmethod
    def debug_reprint(cls, rr_id: int) -> Dict[str, Any]:
        """Return reprint workflow state for debug endpoint."""
        try:
            rr = ReprintRequest.objects.get(id=rr_id)
        except ReprintRequest.DoesNotExist:
            return {'error': f'ReprintRequest {rr_id} not found'}

        return {
            'rr_id': rr.id,
            'card_id': rr.card_id,
            'current_status': rr.status,
            'allowed_transitions': list(cls.ALLOWED_TRANSITIONS.get(rr.status, [])),
        }
