"""
Background Export Task Manager
==============================

Thin facade over the DB-backed BackgroundTask + BackgroundWorker system.

Previously this module kept task state in an in-memory dict with raw threads,
which meant task state was lost on server restart and broken with multiple
gunicorn workers.  It now delegates entirely to BackgroundTask (DB-backed) and
the singleton BackgroundWorker (ThreadPoolExecutor max_workers=1), so:

  - Task state survives server restarts (stored in DB)
  - Multiple gunicorn workers are safe (DB is the shared source of truth)
  - Only one export runs at a time (single-worker queue prevents RAM overload)

The public API (start_pdf_export / get_status) is unchanged so no JS or view
code needs modification.

Usage:
    task_id = BackgroundExportManager.start_pdf_export(user, table_id, card_ids, ...)
    status  = BackgroundExportManager.get_status(task_id)
    # When status['state'] == 'completed':
    #   status['download_url'] → URL to download the file
"""
import logging
import os
from typing import Any, Dict, Optional

from django.conf import settings

logger = logging.getLogger(__name__)


class BackgroundExportManager:
    """
    Facade that queues PDF exports via BackgroundTask + BackgroundWorker.

    Keeps the same public interface as the old in-memory implementation so
    that existing callers (views, templates, JS) require no changes.
    """

    @classmethod
    def start_pdf_export(
        cls,
        user,
        table_id: int,
        card_ids: list,
        status: str = '',
        template_id: int = None,
        font_mode: str = 'auto',
    ) -> str:
        """
        Enqueue a PDF export and return a task_id string.

        Creates a BackgroundTask DB record and submits it to the
        BackgroundWorker queue.  Returns str(task.id) so the URL-safe
        string contract with callers is preserved.
        """
        from core.models import BackgroundTask
        from core.services.background_worker import background_worker

        metadata: Dict[str, Any] = {
            'table_id': table_id,
            'card_ids': list(card_ids) if card_ids else [],
            'status': status,
            'template_id': template_id,
            'font_mode': font_mode or 'auto',
        }

        task, error = BackgroundTask.create_if_no_active(
            user=user,
            task_type='export_pdf',
            metadata=metadata,
            total=len(card_ids) if card_ids else 0,
        )

        if task is None:
            # User already has an active PDF export — return its ID so the
            # frontend can poll the existing task rather than receiving an error.
            logger.warning(
                "PDF export blocked for user=%s: %s", user.id, error
            )
            existing = BackgroundTask.has_active_task(user, task_type='export_pdf')
            if existing:
                return str(existing.id)
            # Unlikely fallback: create anyway
            task = BackgroundTask.objects.create(
                user=user,
                task_type='export_pdf',
                metadata=metadata,
                total=len(card_ids) if card_ids else 0,
            )

        background_worker.submit_task(task.id)

        logger.info(
            "PDF export enqueued: user=%s table=%d cards=%d task_id=%d",
            user.id, table_id, len(card_ids) if card_ids else 0, task.id,
        )
        return str(task.id)

    @classmethod
    def get_status(cls, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Return a status dict for the given task_id string.

        The returned dict has the same keys as the old in-memory
        implementation so that views and JS need no changes:
          state, progress, message, download_url, filename

        Returns None if the task does not exist (view returns 404).
        """
        from core.models import BackgroundTask

        try:
            task = BackgroundTask.objects.get(id=int(task_id))
        except (BackgroundTask.DoesNotExist, ValueError, TypeError):
            return None

        # Map DB status → state string used by the frontend
        state = task.status
        if state == 'pending':
            state = 'processing'  # frontend only knows processing/completed/failed

        progress = task.progress_percentage

        # Human-readable message
        if task.status == 'pending':
            message = 'Queued, waiting to start...'
        elif task.status == 'processing':
            total = task.total or 0
            message = (
                f'Generating PDF... ({task.progress}/{total} cards)'
                if total else 'Generating PDF...'
            )
        elif task.status == 'completed':
            result_meta = task.metadata.get('result', {})
            count = result_meta.get('card_count', '')
            message = f'Export complete ({count} cards)' if count else 'Export complete'
        elif task.status == 'failed':
            message = task.error_message or 'Export failed. Please try again.'
        else:
            message = task.status

        # Build download URL from result_path (relative to MEDIA_ROOT)
        download_url = ''
        filename = ''
        if task.status == 'completed' and task.result_path:
            rel = task.result_path.replace('\\', '/')
            download_url = settings.MEDIA_URL.rstrip('/') + '/' + rel
            filename = task.metadata.get('result', {}).get(
                'filename', os.path.basename(task.result_path)
            )

        return {
            'state': state,
            'progress': progress,
            'message': message,
            'download_url': download_url,
            'filename': filename,
        }
