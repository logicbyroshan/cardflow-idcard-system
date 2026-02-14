"""
Task Cleanup Service

Handles cleanup of stale and completed tasks:
- Mark stuck tasks as failed
- Remove old result files
- Clean up orphaned temp files

Should be called:
1. On server startup (via Django's AppConfig.ready())
2. Periodically (e.g., via cron or Django management command)
"""
import os
import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


def cleanup_stale_tasks(hours=24):
    """
    Mark tasks stuck in 'processing' or 'pending' state as failed.
    
    Pending tasks older than the threshold likely had their submission
    lost due to a server restart before the worker picked them up.
    
    Args:
        hours: Consider tasks stale if older than this
        
    Returns:
        Number of tasks cleaned up
    """
    from core.models import BackgroundTask
    
    stale_threshold = timezone.now() - timedelta(hours=hours)

    # Processing tasks — check started_at
    stale_processing = BackgroundTask.objects.filter(
        status='processing',
        started_at__lt=stale_threshold
    )
    # Pending tasks — check created_at (never started)
    stale_pending = BackgroundTask.objects.filter(
        status='pending',
        created_at__lt=stale_threshold
    )
    
    count = 0
    for task in list(stale_processing) + list(stale_pending):
        try:
            task.mark_failed(f'Task timed out after {hours} hours (server restart or worker crash)')
            count += 1
            logger.info("Marked stale task %d (%s) as failed", task.id, task.status)
        except Exception as e:
            logger.error("Failed to mark task %d as failed: %s", task.id, e)
    
    if count:
        logger.info("Cleaned up %d stale background tasks", count)
    
    return count


def cleanup_old_results(days=7):
    """
    Delete old completed task records and their result files.
    
    Args:
        days: Delete records older than this many days
        
    Returns:
        Number of tasks cleaned up
    """
    from core.models import BackgroundTask
    from django.core.files.storage import default_storage
    
    old_threshold = timezone.now() - timedelta(days=days)
    old_tasks = BackgroundTask.objects.filter(
        status__in=['completed', 'failed', 'cancelled'],
        completed_at__lt=old_threshold
    )
    
    count = 0
    for task in old_tasks:
        try:
            # Clean up result file if exists
            if task.result_path:
                try:
                    if default_storage.exists(task.result_path):
                        default_storage.delete(task.result_path)
                        logger.debug("Deleted result file: %s", task.result_path)
                except Exception as e:
                    logger.warning("Failed to delete result file %s: %s", task.result_path, e)
            
            task.delete()
            count += 1
        except Exception as e:
            logger.error("Failed to delete old task %d: %s", task.id, e)
    
    if count:
        logger.info("Deleted %d old background task records", count)
    
    return count


def cleanup_orphaned_temp_files(hours=24):
    """
    Remove temp files that are older than specified hours.
    These may be left over from crashed uploads or failed tasks.
    
    Args:
        hours: Delete files older than this many hours
        
    Returns:
        Number of files cleaned up
    """
    import time
    
    temp_dir = os.path.join(settings.MEDIA_ROOT, 'temp')
    if not os.path.exists(temp_dir):
        return 0
    
    cutoff_time = time.time() - (hours * 3600)
    count = 0
    
    try:
        for filename in os.listdir(temp_dir):
            file_path = os.path.join(temp_dir, filename)
            
            # Skip directories
            if os.path.isdir(file_path):
                continue
            
            try:
                # Check file modification time
                mtime = os.path.getmtime(file_path)
                if mtime < cutoff_time:
                    os.remove(file_path)
                    count += 1
                    logger.debug("Deleted orphaned temp file: %s", filename)
            except Exception as e:
                logger.warning("Failed to process temp file %s: %s", filename, e)
    except Exception as e:
        logger.error("Error cleaning temp directory: %s", e)
    
    if count:
        logger.info("Deleted %d orphaned temp files", count)
    
    return count


def cleanup_old_exports(days=3):
    """
    Remove old export files from the exports directory.
    
    Args:
        days: Delete files older than this many days
        
    Returns:
        Number of files cleaned up
    """
    import time
    
    exports_dir = os.path.join(settings.MEDIA_ROOT, 'exports')
    if not os.path.exists(exports_dir):
        return 0
    
    cutoff_time = time.time() - (days * 24 * 3600)
    count = 0
    
    try:
        for filename in os.listdir(exports_dir):
            file_path = os.path.join(exports_dir, filename)
            
            # Skip directories
            if os.path.isdir(file_path):
                continue
            
            try:
                # Check file modification time
                mtime = os.path.getmtime(file_path)
                if mtime < cutoff_time:
                    os.remove(file_path)
                    count += 1
                    logger.debug("Deleted old export file: %s", filename)
            except Exception as e:
                logger.warning("Failed to delete export file %s: %s", filename, e)
    except Exception as e:
        logger.error("Error cleaning exports directory: %s", e)
    
    if count:
        logger.info("Deleted %d old export files", count)
    
    return count


def run_all_cleanup():
    """
    Run all cleanup operations.
    
    Returns:
        Dict with counts of cleaned up items
    """
    results = {
        'stale_tasks': cleanup_stale_tasks(hours=24),
        'old_results': cleanup_old_results(days=7),
        'orphaned_temp': cleanup_orphaned_temp_files(hours=24),
        'old_exports': cleanup_old_exports(days=3),
    }
    
    total = sum(results.values())
    if total:
        logger.info("Cleanup completed: %s", results)
    
    return results


def ensure_directories():
    """
    Ensure required directories exist.
    """
    directories = [
        os.path.join(settings.MEDIA_ROOT, 'temp'),
        os.path.join(settings.MEDIA_ROOT, 'exports'),
    ]
    
    for directory in directories:
        os.makedirs(directory, exist_ok=True)
        logger.debug("Ensured directory exists: %s", directory)
