"""
DEPRECATED: This module is kept for backward compatibility.
Superuser creation is now handled by startup.py which runs before Gunicorn.

For Render deployment, use the start command:
    python startup.py && gunicorn config.wsgi
"""

import logging
import os
from django.contrib.auth import get_user_model
from django.db.utils import OperationalError

logger = logging.getLogger(__name__)


def create_superuser_if_needed():
    """
    Create a superuser ONCE if it does not exist.
    
    DEPRECATED: Use startup.py instead for production deployments.
    This function is kept for backward compatibility and manual usage.
    
    Environment variables:
    - DJANGO_SUPERUSER_USERNAME (default: admin)
    - DJANGO_SUPERUSER_EMAIL (default: admin@mail.com)
    - DJANGO_SUPERUSER_PASSWORD (default: admin123)
    """
    try:
        User = get_user_model()

        username = os.getenv("DJANGO_SUPERUSER_USERNAME", "admin")
        email = os.getenv("DJANGO_SUPERUSER_EMAIL", "admin@mail.com")
        password = os.getenv("DJANGO_SUPERUSER_PASSWORD", "admin123")

        # Check if superuser already exists
        if User.objects.filter(is_superuser=True).exists():
            logger.info("Superuser already exists")
            return True

        # Create new superuser (role='super_admin' is now set automatically by CustomUserManager)
        user = User.objects.create_superuser(
            username=username,
            email=email,
            password=password,
        )
        
        logger.info("Superuser created: %s", username)
        return True

    except OperationalError:
        logger.warning("Database not ready, skipping superuser creation")
        return False
    except Exception as e:
        logger.error("Error creating superuser: %s", e)
        return False
