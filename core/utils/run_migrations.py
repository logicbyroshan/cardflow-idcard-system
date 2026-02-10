"""
DEPRECATED: This module is kept for backward compatibility.
Migrations are now handled by startup.py which runs before Gunicorn.

For Render deployment, use the start command:
    python startup.py && gunicorn config.wsgi
"""

import os
from django.core.management import call_command
from django.db.utils import OperationalError, ProgrammingError


def run_migrations():
    """
    Safely run migrations on startup.
    
    DEPRECATED: Use startup.py instead for production deployments.
    This function is kept for backward compatibility and manual usage.
    """
    try:
        call_command("migrate", interactive=False)
        print("✅ Database migrations applied")
        return True
    except (OperationalError, ProgrammingError) as e:
        print(f"⚠️ Migration skipped: {e}")
        return False
    except Exception as e:
        print(f"❌ Migration error: {e}")
        return False
