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
from django.utils import timezone

from idcards.models import IDCard, IDCardTable
from core.services.base import ServiceResult
from core.services.cache_version_service import CacheVersionService
from core.services.activity_service import ActivityService
from .models import ReprintRequest


class ReprintWorkflowService:
    """
    Single authority for ReprintRequest status transitions.

    Workflow: requested → confirmed → downloaded
    Reject removes the ReprintRequest. Card status remains unchanged by default.
    """

    ALLOWED_TRANSITIONS: Dict[str, List[str]] = {
        'requested':  ['confirmed'],
        'confirmed':  ['requested', 'downloaded'],
        'downloaded': [],
    }

    VALID_STATUSES = ['requested', 'confirmed', 'downloaded']

    INITIAL_STATUS = 'requested'

    @staticmethod
    def _status_label(status):
        labels = dict(ReprintRequest.REPRINT_STATUS_CHOICES)
        return labels.get(status, str(status or '').replace('_', ' ').title())

    @staticmethod
    def _normalize_positive_int_ids(raw_ids: Any) -> List[int]:
        """Normalize raw ID payloads into unique positive integers."""
        if not isinstance(raw_ids, (list, tuple, set)):
            return []

        normalized: List[int] = []
        seen = set()
        for value in raw_ids:
            if isinstance(value, bool):
                continue
            try:
                parsed = int(str(value).strip())
            except (TypeError, ValueError):
                continue
            if parsed <= 0 or parsed in seen:
                continue
            seen.add(parsed)
            normalized.append(parsed)
        return normalized

    @classmethod
    def _bump_dashboard_cache_versions(cls, table: IDCardTable) -> None:
        """Invalidate dashboard cache versions for reprint data updates."""
        try:
            CacheVersionService.bump('admin_dash_counts', 'global')
            client_id = getattr(getattr(table, 'group', None), 'client_id', None)
            if client_id:
                CacheVersionService.bump('client_dash_counts', f'client:{int(client_id)}')
        except Exception:
            pass

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

        cls._bump_dashboard_cache_versions(reprint_req.table)
        ActivityService.log(
            'reprint_status',
            f'Reprint moved from {cls._status_label(current)} to {cls._status_label(target_status)}',
            user=user,
            target_model='IDCard',
            target_id=reprint_req.card_id,
            target_name=f'Card #{reprint_req.card_id}',
        )

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

        rr_ids = cls._normalize_positive_int_ids(rr_ids)
        if not rr_ids:
            return ServiceResult(success=False, message='No reprint IDs provided')

        valid_from = [s for s, targets in cls.ALLOWED_TRANSITIONS.items() if target_status in targets]
        if not valid_from:
            return ServiceResult(success=False, message=f'No valid source status for {target_status}.')

        now = timezone.now()
        transition_rows = list(
            ReprintRequest.objects.filter(
                id__in=rr_ids,
                table=table,
                status__in=valid_from,
            ).values('id', 'card_id', 'status')
        )
        eligible_ids = [row['id'] for row in transition_rows]

        updated = ReprintRequest.objects.filter(
            id__in=eligible_ids,
            table=table,
            status__in=valid_from,
        ).update(status=target_status, updated_at=now)

        if not updated:
            return ServiceResult(
                success=False,
                message=f'No reprint requests eligible for transition to {target_status}.'
            )

        cls._bump_dashboard_cache_versions(table)
        for row in transition_rows:
            ActivityService.log(
                'reprint_status',
                f'Reprint moved from {cls._status_label(row.get("status"))} to {cls._status_label(target_status)}',
                user=user,
                target_model='IDCard',
                target_id=row.get('card_id'),
                target_name=f'Card #{row.get("card_id")}',
            )

        return ServiceResult(
            success=True,
            message=f'{updated} reprint(s) updated to {target_status}.',
            data={'updated_count': updated, 'updated_ids': eligible_ids}
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
        card_ids = cls._normalize_positive_int_ids(card_ids)
        if not card_ids:
            return ServiceResult(success=False, message='No card IDs provided')

        reason = str(reason or '').strip()

        with transaction.atomic():
            valid_ids = set(
                IDCard.objects.select_for_update().filter(
                    table=table,
                    id__in=card_ids,
                    status='download',
                ).values_list('id', flat=True)
            )

            already_requested = set(
                ReprintRequest.objects.filter(
                    table=table,
                    card_id__in=valid_ids,
                    status__in=['requested', 'confirmed', 'downloaded'],
                ).values_list('card_id', flat=True)
            )

            new_ids = sorted(valid_ids - already_requested)
            to_create = [
                ReprintRequest(
                    card_id=cid,
                    table=table,
                    status=cls.INITIAL_STATUS,
                    reason=reason,
                    requested_by=requested_by,
                )
                for cid in new_ids
            ]
            if to_create:
                ReprintRequest.objects.bulk_create(to_create, batch_size=500)
            created = len(to_create)

        skipped_count = len(already_requested & set(card_ids))

        if created > 0:
            cls._bump_dashboard_cache_versions(table)
            client_name = ''
            try:
                client_name = table.group.client.name
            except Exception:
                client_name = ''
            suffix = f' for {client_name}' if client_name else ''
            table_suffix = f' (Table: {table.name})' if getattr(table, 'name', '') else ''
            ActivityService.log(
                'reprint_request',
                f'{created} reprint request(s) created{suffix}{table_suffix}',
                user=requested_by,
                target_model='ReprintRequest',
                target_id=table.id,
                target_name=getattr(table, 'name', ''),
            )
            for cid in new_ids:
                ActivityService.log(
                    'reprint_request',
                    f'Reprint requested{suffix}',
                    user=requested_by,
                    target_model='IDCard',
                    target_id=cid,
                    target_name=f'Card #{cid}',
                )

        return ServiceResult(
            success=True,
            message=f'{created} reprint request(s) created',
            data={
                'created_count': created,
                'skipped_count': skipped_count,
            },
        )

    @classmethod
    def reject_requests(
        cls,
        table: IDCardTable,
        rr_ids: List[int],
        move_card_to_pool: bool = False,
        user=None,
    ) -> ServiceResult:
        """Reject (delete) reprint requests and optionally move cards to IDCard pool."""
        rr_ids = cls._normalize_positive_int_ids(rr_ids)
        if not rr_ids:
            return ServiceResult(success=False, message='No reprint IDs provided')

        with transaction.atomic():
            rr_qs = ReprintRequest.objects.select_for_update().filter(
                id__in=rr_ids,
                table=table,
                status__in=['requested', 'confirmed'],
            )

            rejected_ids = list(rr_qs.values_list('id', flat=True))
            rejected_count = len(rejected_ids)
            card_ids = list(rr_qs.values_list('card_id', flat=True))

            if move_card_to_pool and card_ids:
                now = timezone.now()
                IDCard.objects.filter(id__in=card_ids).update(
                    status='pool',
                    deleted_at=now,
                    status_changed_at=now,
                    updated_at=now,
                )

            rr_qs.delete()

        cls._bump_dashboard_cache_versions(table)
        for card_id in card_ids:
            ActivityService.log(
                'reprint_status',
                'Reprint rejected and card moved to pool' if move_card_to_pool else 'Reprint rejected',
                user=user,
                target_model='IDCard',
                target_id=card_id,
                target_name=f'Card #{card_id}',
            )

        return ServiceResult(
            success=True,
            message=(
                f'{rejected_count} reprint(s) rejected and moved to pool'
                if move_card_to_pool
                else f'{rejected_count} reprint(s) removed from request list'
            ),
            data={
                'rejected_count': rejected_count,
                'rejected_ids': rejected_ids,
                'moved_to_pool': bool(move_card_to_pool),
            },
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
