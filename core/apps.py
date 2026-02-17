from django.apps import AppConfig


def _set_sqlite_pragmas(sender, connection, **kwargs):
    """Enable WAL mode and extended busy_timeout for SQLite connections."""
    if connection.vendor == 'sqlite':
        cursor = connection.cursor()
        cursor.execute('PRAGMA journal_mode=WAL;')
        cursor.execute('PRAGMA synchronous=NORMAL;')
        cursor.execute('PRAGMA busy_timeout=30000;')


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"

    def ready(self):
        """
        Django app ready hook.
        
        NOTE: Migrations and superuser creation are handled by startup.py
        which runs BEFORE Gunicorn starts. This is more reliable than
        running in ready() because:
        1. ready() runs multiple times (once per worker)
        2. ready() runs during management commands (migrate, collectstatic)
        3. ready() can cause race conditions with multiple workers
        
        For local development, you can still use:
            python manage.py migrate
            python manage.py createsuperuser
        
        For Render deployment, the start command runs:
            python startup.py && gunicorn config.wsgi
        
        Background Task System:
        - Runs cleanup of stale tasks on server startup
        - Only runs in server context (not during migrations)
        """
        import os
        import sys

        # ── Pillow decompression-bomb guard (set once, process-wide) ──
        try:
            from PIL import Image
            Image.MAX_IMAGE_PIXELS = 25_000_000  # ~25 MP
        except ImportError:
            pass

        # SQLite WAL mode for concurrent access (dev env; production uses PostgreSQL)
        from django.db.backends.signals import connection_created
        connection_created.connect(_set_sqlite_pragmas)
        
        # Skip cleanup during migrations and other management commands
        running_server = (
            'runserver' in sys.argv
            or (bool(sys.argv) and 'gunicorn' in sys.argv[0])
            or os.environ.get('RUN_MAIN') == 'true'
            or os.environ.get('GUNICORN_WORKER_READY') == 'true'
        )
        
        # Only run cleanup in main process when running server
        if running_server and not any(cmd in sys.argv for cmd in ['migrate', 'makemigrations', 'collectstatic', 'test', 'shell']):
            try:
                from core.services.task_cleanup import cleanup_stale_tasks, ensure_directories
                
                # Ensure temp and exports directories exist
                ensure_directories()
                
                # Mark any stuck tasks from previous server session as failed
                # Use 1-hour threshold: tasks surviving past a restart are certainly dead
                cleanup_stale_tasks(hours=1)
                
            except Exception as e:
                # Don't crash startup if cleanup fails
                import logging
                logger = logging.getLogger(__name__)
                logger.warning("Background task cleanup on startup failed: %s", e)

