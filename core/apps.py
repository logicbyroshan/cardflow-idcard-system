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
        """
        pass
