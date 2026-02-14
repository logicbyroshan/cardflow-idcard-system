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
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import wraps

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
        """
        from core.models import BackgroundTask
        from django.utils import timezone
        from datetime import timedelta
        
        try:
            task = BackgroundTask.objects.get(id=task_id)
        except BackgroundTask.DoesNotExist:
            logger.error("Task %d not found", task_id)
            return
        
        # Check if already processing (prevent double-processing)
        if task.status != "pending":
            logger.warning("Task %d is not pending (status=%s), skipping", task_id, task.status)
            return
        
        try:
            task.mark_started()
            logger.info("Processing task %d: %s", task_id, task.task_type)
            
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
            if task.status == 'processing' and task.started_at:
                elapsed = (timezone.now() - task.started_at).total_seconds()
                if elapsed > TASK_TIMEOUT_SECONDS:
                    task.mark_failed(
                        f"Task exceeded maximum timeout of {TASK_TIMEOUT_SECONDS // 60} minutes"
                    )
                    logger.warning("Task %d force-failed: exceeded %ds timeout", task_id, TASK_TIMEOUT_SECONDS)
                
        except Exception as e:
            logger.exception("Task %d failed with exception", task_id)
            try:
                task.refresh_from_db()
                task.mark_failed(str(e))
            except Exception:
                pass
        finally:
            # Periodic cleanup of orphaned temp/export files after every task
            try:
                from core.services.task_cleanup import cleanup_orphaned_temp_files, cleanup_old_exports
                cleanup_orphaned_temp_files(hours=24)
                cleanup_old_exports(days=3)
            except Exception:
                pass
    
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
    
    # Write in chunks - CRITICAL for memory efficiency
    with open(full_path, 'wb+') as destination:
        for chunk in uploaded_file.chunks(chunk_size=1024 * 1024):  # 1MB chunks
            destination.write(chunk)
    
    # Return relative path for storage in BackgroundTask
    relative_path = os.path.relpath(full_path, settings.MEDIA_ROOT)
    logger.info("Saved uploaded file to: %s", relative_path)
    return relative_path


def cancel_task(task_id: int, user=None) -> dict:
    """Cancel a pending or processing background task.

    Returns dict with 'success' and 'message' keys.
    """
    from core.models import BackgroundTask
    from django.utils import timezone

    try:
        if user and getattr(user, 'role', None) == 'super_admin':
            task = BackgroundTask.objects.get(id=task_id)
        elif user:
            task = BackgroundTask.objects.get(id=task_id, user=user)
        else:
            task = BackgroundTask.objects.get(id=task_id)
    except BackgroundTask.DoesNotExist:
        return {'success': False, 'message': 'Task not found'}

    if task.status in ('completed', 'failed', 'cancelled'):
        return {'success': False, 'message': f'Task is already {task.status}'}

    task.status = 'cancelled'
    task.completed_at = timezone.now()
    task.save(update_fields=['status', 'completed_at', 'updated_at'])
    task.cleanup_files()

    return {'success': True, 'message': 'Task cancelled'}


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
