"""
Background Export Task Manager
==============================

Simple in-memory background task manager using Python threads.
Used for long-running PDF exports that would otherwise time out
behind Cloudflare's ~100s proxy timeout.

Architecture:
- Exports are started in background threads
- Progress and results are tracked in a thread-safe dict
- Completed PDFs are saved to media/temp/exports/
- A cleanup job purges files older than 1 hour

Usage:
    task_id = BackgroundExportManager.start_pdf_export(user, table_id, card_ids, ...)
    status  = BackgroundExportManager.get_status(task_id)
    # When status['state'] == 'completed':
    #   status['download_url'] → URL to download the file
"""
import os
import uuid
import time
import logging
import threading
from typing import Dict, Any, Optional

from django.conf import settings

logger = logging.getLogger(__name__)

# Thread-safe task registry
_tasks: Dict[str, Dict[str, Any]] = {}
_tasks_lock = threading.Lock()

# Directory for temporary export files
EXPORT_TEMP_DIR = os.path.join(settings.MEDIA_ROOT, 'temp', 'exports')

# Auto-cleanup: delete export files older than this (seconds)
EXPORT_FILE_TTL = 3600  # 1 hour


def _ensure_export_dir():
    """Create the temp export directory if it doesn't exist."""
    os.makedirs(EXPORT_TEMP_DIR, exist_ok=True)


class BackgroundExportManager:
    """Manages background PDF export tasks."""

    @classmethod
    def start_pdf_export(
        cls,
        user,
        table_id: int,
        card_ids: list,
        status: str = '',
        template_id: int = None,
    ) -> str:
        """
        Start a background PDF export.

        Returns a task_id that can be polled for progress.
        """
        task_id = uuid.uuid4().hex[:16]
        _ensure_export_dir()

        with _tasks_lock:
            _tasks[task_id] = {
                'state': 'processing',
                'progress': 0,
                'message': 'Starting PDF generation...',
                'filename': '',
                'download_url': '',
                'card_count': len(card_ids),
                'created_at': time.time(),
                'user_id': user.id,
            }

        # Start background thread
        thread = threading.Thread(
            target=cls._generate_pdf_background,
            args=(task_id, user, table_id, card_ids, status, template_id),
            daemon=True,
        )
        thread.start()

        # Trigger cleanup of old exports in a separate thread
        threading.Thread(target=cls._cleanup_old_exports, daemon=True).start()

        return task_id

    @classmethod
    def get_status(cls, task_id: str) -> Optional[Dict[str, Any]]:
        """Get the current status of a background export task."""
        with _tasks_lock:
            task = _tasks.get(task_id)
            if task is None:
                return None
            # Return a copy to avoid race conditions
            return dict(task)

    @classmethod
    def _update_task(cls, task_id: str, **kwargs):
        """Update task status (thread-safe)."""
        with _tasks_lock:
            if task_id in _tasks:
                _tasks[task_id].update(kwargs)

    @classmethod
    def _generate_pdf_background(
        cls,
        task_id: str,
        user,
        table_id: int,
        card_ids: list,
        status: str,
        template_id: int,
    ):
        """Background thread: generate PDF and save to temp file."""
        try:
            cls._update_task(task_id, progress=10, message='Loading card data...')

            # Import here to avoid circular imports
            from .services import ExportService
            from .pdf import PdfExporter
            from core.models import IDCardTable, IDCard

            service = ExportService(user)
            table = IDCardTable.objects.select_related('group__client').get(id=table_id)

            # Fetch cards
            cards = IDCard.objects.filter(
                id__in=card_ids, table_id=table_id
            ).order_by('id')

            cls._update_task(task_id, progress=20, message=f'Generating PDF for {cards.count()} cards...')

            # Generate PDF using the existing exporter
            exporter = PdfExporter()
            result = exporter.export_cards(table, cards, status=status, template_id=template_id)

            if not result.success:
                cls._update_task(
                    task_id,
                    state='failed',
                    progress=100,
                    message=result.message,
                )
                return

            cls._update_task(task_id, progress=80, message='Saving PDF file...')

            # Save PDF to temp file
            pdf_bytes = result.response.content
            filename = result.filename or f'export_{task_id}.pdf'
            filepath = os.path.join(EXPORT_TEMP_DIR, f'{task_id}_{filename}')

            with open(filepath, 'wb') as f:
                f.write(pdf_bytes)

            # Build download URL
            rel_path = os.path.relpath(filepath, settings.MEDIA_ROOT).replace('\\', '/')
            download_url = f'{settings.MEDIA_URL}{rel_path}'

            cls._update_task(
                task_id,
                state='completed',
                progress=100,
                message=f'PDF ready ({result.card_count} cards)',
                filename=filename,
                download_url=download_url,
            )

            logger.info(
                "Background PDF export completed: task=%s table=%d cards=%d file=%s",
                task_id, table_id, result.card_count, filename,
            )

        except Exception as e:
            logger.exception("Background PDF export failed: task=%s error=%s", task_id, e)
            cls._update_task(
                task_id,
                state='failed',
                progress=100,
                message='PDF generation failed. Please try again.',
            )

    @classmethod
    def _cleanup_old_exports(cls):
        """Delete export temp files older than EXPORT_FILE_TTL."""
        try:
            if not os.path.isdir(EXPORT_TEMP_DIR):
                return
            now = time.time()
            cleaned = 0
            for fname in os.listdir(EXPORT_TEMP_DIR):
                fpath = os.path.join(EXPORT_TEMP_DIR, fname)
                if os.path.isfile(fpath):
                    age = now - os.path.getmtime(fpath)
                    if age > EXPORT_FILE_TTL:
                        os.unlink(fpath)
                        cleaned += 1
            # Also clean up old task entries
            with _tasks_lock:
                stale_ids = [
                    tid for tid, t in _tasks.items()
                    if now - t.get('created_at', 0) > EXPORT_FILE_TTL
                ]
                for tid in stale_ids:
                    del _tasks[tid]
            if cleaned:
                logger.info("Cleaned up %d old export file(s)", cleaned)
        except Exception as e:
            logger.warning("Export cleanup error: %s", e)
