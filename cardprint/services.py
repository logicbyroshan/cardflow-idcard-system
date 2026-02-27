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

from .models import PrintRequest

logger = logging.getLogger(__name__)

ALLOWED_TRANSITIONS = {
    'print_list': ['finalized'],
    'finalized': ['pool'],
}


class PrintWorkflowService:
    """Service layer for the card-print workflow."""

    @staticmethod
    def create_requests(table, card_ids, user):
        """Create PrintRequest rows for the given card IDs.

        Skips cards that already have an active (non-pool) print request
        for the same table to avoid duplicates.

        Returns dict: {created: int, skipped: int}
        """
        existing_ids = set(
            PrintRequest.objects.filter(
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
        return {'created': created, 'skipped': skipped}

    @staticmethod
    def bulk_generate(request_ids, user):
        """Transition print_list → finalized for a batch of PrintRequest IDs.

        NOTE: In future this will trigger a background task (e.g. PDF generation).
        For now it transitions directly.

        Returns dict: {updated: int, skipped: int}
        """
        qs = PrintRequest.objects.filter(
            id__in=request_ids,
            status='print_list',
        )
        updated = qs.update(status='finalized', updated_at=timezone.now())
        skipped = len(request_ids) - updated
        logger.info(
            'PrintWorkflow: generate updated=%d skipped=%d user=%s',
            updated, skipped, user.username,
        )
        return {'updated': updated, 'skipped': skipped}

    @staticmethod
    def bulk_mark_pool(request_ids, user):
        """Transition finalized → pool for a batch of PrintRequest IDs.

        Returns dict: {updated: int, skipped: int}
        """
        qs = PrintRequest.objects.filter(
            id__in=request_ids,
            status='finalized',
        )
        updated = qs.update(status='pool', updated_at=timezone.now())
        skipped = len(request_ids) - updated
        logger.info(
            'PrintWorkflow: mark_pool updated=%d skipped=%d user=%s',
            updated, skipped, user.username,
        )
        return {'updated': updated, 'skipped': skipped}

    @staticmethod
    def delete_requests(request_ids, user):
        """Remove PrintRequest rows (only print_list status).

        Returns dict: {deleted: int, skipped: int}
        """
        qs = PrintRequest.objects.filter(
            id__in=request_ids,
            status='print_list',
        )
        deleted, _ = qs.delete()
        skipped = len(request_ids) - deleted
        logger.info(
            'PrintWorkflow: deleted=%d skipped=%d user=%s',
            deleted, skipped, user.username,
        )
        return {'deleted': deleted, 'skipped': skipped}
