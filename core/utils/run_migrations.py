"""
DEPRECATED: This module is kept for backward compatibility.
Migrations are now handled by startup.py which runs before Gunicorn.

For Render deployment, use the start command:
    python startup.py && gunicorn config.wsgi
"""

import logging
import os
from django.core.management import call_command
from django.db.utils import OperationalError, ProgrammingError

logger = logging.getLogger(__name__)


def run_migrations():
    """
    Safely run migrations on startup.
    
    DEPRECATED: Use startup.py instead for production deployments.
    This function is kept for backward compatibility and manual usage.
    """
    try:
        call_command("migrate", interactive=False)
        logger.info("Database migrations applied")
        return True
    except (OperationalError, ProgrammingError) as e:
        logger.warning("Migration skipped: %s", e)
        return False
    except Exception as e:
        logger.error("Migration error: %s", e)
        return False
