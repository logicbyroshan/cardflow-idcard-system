"""
Background Worker Service

Lightweight background task processing using ThreadPoolExecutor.
CRITICAL: max_workers=1 to prevent memory exhaustion on 1GB RAM servers.

This service handles:
- Bulk uploads (XLSX + ZIP)
- Image reuploads (ZIP)
- Large file exports (ZIP, PDF, DOCX)

Usage:
    from core.services.background_worker import background_worker
    
    # Submit a task
    task = BackgroundTask.objects.create(...)
    background_worker.submit_task(task.id)
    
    # Check task status via API
    GET /api/task-status/<task_id>/
"""
import os
import logging
import time
import threading
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings

logger = logging.getLogger(__name__)

# Maximum time a single task may run before being marked as failed (seconds)
TASK_TIMEOUT_SECONDS = 30 * 60  # 30 minutes


class BackgroundWorker:
    """
    Singleton background worker using ThreadPoolExecutor with max_workers=1.
    
    CRITICAL DESIGN DECISIONS:
    - Single worker thread prevents RAM exhaustion
    - Tasks are queued, not parallel
    - Files are processed from disk, never loaded into memory
    - Progress is updated incrementally
    """
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        # CRITICAL: Only 1 worker for 1GB RAM server
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bg_worker")
        self._initialized = True
        logger.info("BackgroundWorker initialized with max_workers=1")
    
    def submit_task(self, task_id: int):
        """
        Submit a task to the background worker.
        
        Args:
            task_id: ID of the BackgroundTask record
            
        Returns:
            Future object (for testing/debugging)
        """
        future = self.executor.submit(self._process_task, task_id)
        logger.info("Task %d submitted to background worker", task_id)
        return future
    
    def _process_task(self, task_id: int):
        """
        Main task processing entry point.
        
        Routes to appropriate handler based on task_type.
        Handles all exceptions and updates task status accordingly.
        Includes a failsafe timeout of TASK_TIMEOUT_SECONDS.
        
        CRITICAL: Runs inside a ThreadPoolExecutor thread — not a Django
        request/response cycle.  We must close stale DB connections at
        the start (and on error) so PostgreSQL and SQLite both get a
        fresh, healthy connection.
        """
        from core.models import BackgroundTask
        from django.utils import timezone
        from django.db import close_old_connections
        from datetime import timedelta
        
        # ── Close stale/inherited DB connections ──
        # Django DB connections are thread-local.  In a long-lived
        # ThreadPoolExecutor thread the connection can outlive
        # PostgreSQL's idle timeout or be leftover from a previous
        # task.  close_old_connections() ensures a fresh connection.
        close_old_connections()
        
        try:
            task = BackgroundTask.objects.get(id=task_id)
        except BackgroundTask.DoesNotExist:
            logger.error("Task %d not found", task_id)
            return
        
        # Check if already processing (prevent double-processing)
        if task.status != "pending":
            logger.warning("Task %d is not pending (status=%s), skipping", task_id, task.status)
            return
        
        task_start = time.monotonic()
        try:
            task.mark_started()
            logger.info(
                "TASK_START task_id=%d type=%s user=%s",
                task_id, task.task_type,
                getattr(task, 'user', None) or '-',
            )
            
            # Route to appropriate handler
            handlers = {
                "bulk_upload": self._process_bulk_upload,
                "reupload_images": self._process_reupload_images,
                "export_zip": self._process_export_zip,
                "export_pdf": self._process_export_pdf,
                "export_docx": self._process_export_docx,
                "export_excel": self._process_export_excel,
            }
            
            handler = handlers.get(task.task_type)
            if handler:
                handler(task)
            else:
                task.mark_failed(f"Unknown task type: {task.task_type}")
            
            # ── Failsafe timeout check ──
            # If the handler completed but took too long AND didn't mark itself
            # as completed/failed, force-fail it. Also catches tasks that
            # silently returned without calling mark_completed.
            task.refresh_from_db()

            elapsed = time.monotonic() - task_start

            if task.status == 'processing' and task.started_at:
                wall = (timezone.now() - task.started_at).total_seconds()
                if wall > TASK_TIMEOUT_SECONDS:
                    task.mark_failed(
                        f"Task exceeded maximum timeout of {TASK_TIMEOUT_SECONDS // 60} minutes"
                    )
                    logger.warning(
                        "TASK_TIMEOUT task_id=%d type=%s wall=%.1fs",
                        task_id, task.task_type, wall,
                    )

            # Log final outcome
            logger.info(
                "TASK_END task_id=%d type=%s status=%s duration=%.2fs",
                task_id, task.task_type, task.status, elapsed,
            )
                
        except Exception as e:
            elapsed = time.monotonic() - task_start
            logger.exception(
                "TASK_FAIL task_id=%d type=%s duration=%.2fs error=%s",
                task_id, task.task_type, elapsed, e,
            )
            try:
                task.refresh_from_db()
                task.mark_failed(str(e))
            except Exception as mark_err:
                logger.warning('Failed to mark task %d as failed: %s', task_id, mark_err)
        finally:
            # ── Close DB connections after task completes ──
            # Prevents the background thread from holding an idle
            # PostgreSQL connection open until the next task arrives.
            try:
                from django.db import close_old_connections
                close_old_connections()
            except Exception:
                pass
            # Periodic cleanup of orphaned temp/export files.
            # Both functions are rate-limited internally (_MIN_CLEANUP_INTERVAL=1h)
            # so concurrent workers or rapid task completions skip the scan cheaply.
            try:
                from core.services.task_cleanup import run_all_cleanup
                # Periodic cleanup: temp files (24h), exports (3d), activity logs (30d).
                # All functions are rate-limited internally so repeated calls are cheap.
                run_all_cleanup()
            except Exception as cleanup_err:
                logger.warning('Post-task cleanup failed: %s', cleanup_err)
    
    def _process_bulk_upload(self, task):
        """
        Process bulk upload from saved file on disk.
        
        CRITICAL: Never load entire file into memory.
        - Read XLSX row by row
        - Process ZIP images one at a time
        - Batch database inserts (100 records)
        """
        from core.services.bulk_upload_processor import process_bulk_upload
        process_bulk_upload(task)
    
    def _process_reupload_images(self, task):
        """
        Process image reupload from ZIP on disk.
        
        CRITICAL: Process one image at a time from ZIP.
        """
        from core.services.reupload_processor import process_reupload_images
        process_reupload_images(task)
    
    def _process_export_zip(self, task):
        """
        Process ZIP export to temp file on disk.
        
        CRITICAL: Use ZIP_STORED (no compression) for memory efficiency.
        """
        from core.services.export_processor import process_export_zip
        process_export_zip(task)
    
    def _process_export_pdf(self, task):
        """
        Process PDF export to temp file on disk.
        """
        from core.services.export_processor import process_export_pdf
        process_export_pdf(task)
    
    def _process_export_docx(self, task):
        """
        Process DOCX export to temp file on disk.
        """
        from core.services.export_processor import process_export_docx
        process_export_docx(task)
    
    def _process_export_excel(self, task):
        """
        Process Excel export to temp file on disk.
        """
        from core.services.export_processor import process_export_excel
        process_export_excel(task)
    
    def shutdown(self, wait=True):
        """
        Shutdown the executor gracefully.
        
        Args:
            wait: If True, wait for pending tasks to complete
        """
        logger.info("Shutting down BackgroundWorker (wait=%s)", wait)
        self.executor.shutdown(wait=wait)


# Singleton instance
background_worker = BackgroundWorker()


def ensure_temp_directory():
    """
    Ensure the temp directory exists for file uploads.
    
    Returns:
        Path to temp directory
    """
    temp_dir = os.path.join(settings.MEDIA_ROOT, "temp")
    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir


def ensure_exports_directory():
    """
    Ensure the exports directory exists for generated files.
    
    Returns:
        Path to exports directory
    """
    exports_dir = os.path.join(settings.MEDIA_ROOT, "exports")
    os.makedirs(exports_dir, exist_ok=True)
    return exports_dir


def save_uploaded_file_to_disk(uploaded_file, filename=None):
    """
    Save an uploaded file to disk in chunks.
    
    CRITICAL: Never use file.read() for large files.
    Uses chunked writing to keep memory usage low.
    
    Args:
        uploaded_file: Django UploadedFile object
        filename: Optional filename (defaults to uploaded_file.name)
        
    Returns:
        Relative path to saved file (relative to MEDIA_ROOT)
    """
    import uuid
    from django.utils.text import get_valid_filename
    
    temp_dir = ensure_temp_directory()
    
    # Generate unique filename to prevent collisions
    if filename:
        safe_name = get_valid_filename(filename)
    else:
        safe_name = get_valid_filename(uploaded_file.name)
    
    # Add unique prefix to prevent race conditions
    unique_name = f"{uuid.uuid4().hex[:8]}_{safe_name}"
    full_path = os.path.join(temp_dir, unique_name)
    
    # Write in 8 MB chunks — 8× fewer syscalls vs 1 MB, same memory footprint
    with open(full_path, 'wb+') as destination:
        for chunk in uploaded_file.chunks(chunk_size=8 * 1024 * 1024):  # 8 MB chunks
            destination.write(chunk)
    
    # Return relative path for storage in BackgroundTask
    relative_path = os.path.relpath(full_path, settings.MEDIA_ROOT)
    logger.info("Saved uploaded file to: %s", relative_path)
    return relative_path


def cancel_task(task_id: int, user=None) -> dict:
    """Cancel a pending or processing background task.

    Uses select_for_update() to prevent race with concurrent task
    completion or duplicate cancel requests.

    Returns dict with 'success' and 'message' keys.
    """
    from core.models import BackgroundTask
    from django.db import transaction
    from django.utils import timezone

    try:
        with transaction.atomic():
            qs = BackgroundTask.objects.select_for_update()
            if user and getattr(user, 'role', None) == 'super_admin':
                task = qs.get(id=task_id)
            elif user:
                task = qs.get(id=task_id, user=user)
            else:
                task = qs.get(id=task_id)

            if task.status in ('completed', 'failed', 'cancelled'):
                return {'success': False, 'message': f'Task is already {task.status}'}

            task.status = 'cancelled'
            task.completed_at = timezone.now()
            task.save(update_fields=['status', 'completed_at', 'updated_at'])

        # Cleanup files outside the transaction (I/O)
        task.cleanup_files()
        return {'success': True, 'message': 'Task cancelled'}
    except BackgroundTask.DoesNotExist:
        return {'success': False, 'message': 'Task not found'}


def cleanup_temp_file(file_path):
    """
    Remove a temporary file safely.
    
    Args:
        file_path: Full path or relative path to file
    """
    if not file_path:
        return
    
    # Convert relative path to full path if needed
    if not os.path.isabs(file_path):
        file_path = os.path.join(settings.MEDIA_ROOT, file_path)
    
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info("Cleaned up temp file: %s", file_path)
    except Exception as e:
        logger.warning("Failed to cleanup temp file %s: %s", file_path, e)
