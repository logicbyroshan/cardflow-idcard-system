from django.apps import AppConfig


def _set_sqlite_pragmas(sender, connection, **kwargs):
    """Enable WAL mode and extended busy_timeout for SQLite connections."""
    if connection.vendor == 'sqlite':
        cursor = connection.cursor()
        cursor.execute('PRAGMA journal_mode=WAL;')
        cursor.execute('PRAGMA synchronous=NORMAL;')
        cursor.execute('PRAGMA busy_timeout=60000;')  # 60 s — room for background bulk writes


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
        
        For deployment, the start command should use ASGI app so websocket
        routes are available, e.g.:
            python startup.py && gunicorn config.asgi:application
        """

        # ── Pillow decompression-bomb guard (set once, process-wide) ──
        try:
            from PIL import Image
            Image.MAX_IMAGE_PIXELS = 25_000_000  # ~25 MP
        except ImportError:
            pass

        # Register optional HEIC/HEIF decoder once for all image pipelines.
        try:
            from mediafiles.utils import register_heif_opener
            register_heif_opener()
        except Exception:
            pass

        # SQLite WAL mode for concurrent access (dev env; production uses PostgreSQL)
        from django.db.backends.signals import connection_created
        connection_created.connect(_set_sqlite_pragmas)

        # Register security revalidation signals once at startup.
        try:
            from core.services.session_revalidation import register_revalidation_signals
            register_revalidation_signals()
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning("Session revalidation signal registration failed: %s", e)

