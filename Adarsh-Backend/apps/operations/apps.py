import sys
from django.apps import AppConfig

class OperationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.operations'

    def ready(self):
        # Prevent validation checks from blocking schema creation/compilation commands
        if not any(cmd in sys.argv for cmd in ['makemigrations', 'migrate', 'collectstatic', 'showmigrations']):
            try:
                from apps.operations.services import StartupDiagnosticService
                StartupDiagnosticService.validate()
            except Exception as e:
                # Log startup failure
                import logging
                logger = logging.getLogger(__name__)
                logger.critical(f"Operations Startup Check Failed: {e}")
                raise
