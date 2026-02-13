from django.apps import AppConfig


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
        
        # Skip cleanup during migrations and other management commands
        running_server = (
            'runserver' in sys.argv or
            'gunicorn' in sys.argv[0] if sys.argv else False or
            os.environ.get('RUN_MAIN') == 'true' or
            os.environ.get('GUNICORN_WORKER_READY') == 'true'
        )
        
        # Only run cleanup in main process when running server
        if running_server and not any(cmd in sys.argv for cmd in ['migrate', 'makemigrations', 'collectstatic', 'test', 'shell']):
            try:
                from core.services.task_cleanup import cleanup_stale_tasks, ensure_directories
                
                # Ensure temp and exports directories exist
                ensure_directories()
                
                # Mark any stuck tasks from previous server session as failed
                cleanup_stale_tasks(hours=24)
                
            except Exception as e:
                # Don't crash startup if cleanup fails
                import logging
                logger = logging.getLogger(__name__)
                logger.warning("Background task cleanup on startup failed: %s", e)

