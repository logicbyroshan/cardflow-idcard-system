"""
Card Print Workflow Service
===========================
All mutations for PrintRequest go through this service.
Views must NOT call .save(), .create(), .delete() directly.
Modelled after ReprintWorkflowService.

3-step workflow: print_list → finalized (via Generate) → pool
"""
import logging

from django.db import transaction
from django.utils import timezone

from core.services.base import ServiceResult
from .models import PrintRequest

logger = logging.getLogger(__name__)


class PrintWorkflowService:
    """Service layer for the card-print workflow."""

    ALLOWED_TRANSITIONS = {
        'print_list': ['finalized'],
        'finalized': ['pool'],
    }

    VALID_STATUSES = ['print_list', 'finalized', 'pool']

    @classmethod
    def create_requests(cls, table, card_ids, user):
        """Create PrintRequest rows for the given card IDs.

        Skips cards that already have an active (non-pool) print request
        for the same table to avoid duplicates.

        Returns ServiceResult with data: {created: int, skipped: int}
        """
        if not card_ids:
            return ServiceResult(success=False, message='No card IDs provided')

        with transaction.atomic():
            existing_ids = set(
                PrintRequest.objects.select_for_update().filter(
                    table=table,
                    card_id__in=card_ids,
                    status__in=['print_list', 'finalized'],
                ).values_list('card_id', flat=True)
            )

            to_create = []
            skipped = 0
            for cid in card_ids:
                if cid in existing_ids:
                    skipped += 1
                    continue
                to_create.append(PrintRequest(
                    card_id=cid,
                    table=table,
                    status='print_list',
                    requested_by=user,
                ))

            if to_create:
                PrintRequest.objects.bulk_create(to_create, ignore_conflicts=True)

        created = len(to_create)
        logger.info(
            'PrintWorkflow: created=%d skipped=%d table=%d user=%s',
            created, skipped, table.id, user.username,
        )
        return ServiceResult(
            success=True,
            message=f'{created} card(s) sent to print list',
            data={'created': created, 'skipped': skipped},
        )

    @classmethod
    def bulk_generate(cls, request_ids, user):
        """Transition print_list → finalized for a batch of PrintRequest IDs.

        Returns ServiceResult with data: {updated: int, skipped: int}
        """
        target_status = 'finalized'
        valid_from = [s for s, targets in cls.ALLOWED_TRANSITIONS.items() if target_status in targets]

        with transaction.atomic():
            qs = PrintRequest.objects.select_for_update().filter(
                id__in=request_ids,
                status__in=valid_from,
            )
            updated = qs.update(status=target_status, updated_at=timezone.now())

        skipped = len(request_ids) - updated
        logger.info(
            'PrintWorkflow: generate updated=%d skipped=%d user=%s',
            updated, skipped, user.username,
        )
        if not updated:
            return ServiceResult(
                success=False,
                message='No print list items eligible for generation.',
                data={'updated': 0, 'skipped': skipped},
            )
        return ServiceResult(
            success=True,
            message=f'{updated} item(s) generated successfully',
            data={'updated': updated, 'skipped': skipped},
        )

    @classmethod
    def bulk_mark_pool(cls, request_ids, user):
        """Transition finalized → pool for a batch of PrintRequest IDs.

        Returns ServiceResult with data: {updated: int, skipped: int}
        """
        target_status = 'pool'
        valid_from = [s for s, targets in cls.ALLOWED_TRANSITIONS.items() if target_status in targets]

        with transaction.atomic():
            qs = PrintRequest.objects.select_for_update().filter(
                id__in=request_ids,
                status__in=valid_from,
            )
            updated = qs.update(status=target_status, updated_at=timezone.now())

        skipped = len(request_ids) - updated
        logger.info(
            'PrintWorkflow: mark_pool updated=%d skipped=%d user=%s',
            updated, skipped, user.username,
        )
        if not updated:
            return ServiceResult(
                success=False,
                message='No finalized items eligible for pool.',
                data={'updated': 0, 'skipped': skipped},
            )
        return ServiceResult(
            success=True,
            message=f'{updated} item(s) moved to pool',
            data={'updated': updated, 'skipped': skipped},
        )

    @classmethod
    def delete_requests(cls, request_ids, user):
        """Remove PrintRequest rows (only print_list status).

        Returns ServiceResult with data: {deleted: int, skipped: int}
        """
        if not request_ids:
            return ServiceResult(success=False, message='No request IDs provided')

        with transaction.atomic():
            qs = PrintRequest.objects.select_for_update().filter(
                id__in=request_ids,
                status='print_list',
            )
            deleted, _ = qs.delete()

        skipped = len(request_ids) - deleted
        logger.info(
            'PrintWorkflow: deleted=%d skipped=%d user=%s',
            deleted, skipped, user.username,
        )
        return ServiceResult(
            success=True,
            message=f'{deleted} item(s) removed from print list',
            data={'deleted': deleted, 'skipped': skipped},
        )
