"""
DEPRECATED: This module is kept for backward compatibility.
Superuser creation is now handled by startup.py which runs before Gunicorn.

For Render deployment, use the start command:
    python startup.py && gunicorn config.wsgi
"""

import os
from django.contrib.auth import get_user_model
from django.db.utils import OperationalError


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
            print("✅ Superuser already exists")
            return True

        # Create new superuser (role='super_admin' is now set automatically by CustomUserManager)
        user = User.objects.create_superuser(
            username=username,
            email=email,
            password=password,
        )
        
        print(f"✅ Superuser created: {username}")
        return True

    except OperationalError:
        print("⚠️ Database not ready, skipping superuser creation")
        return False
    except Exception as e:
        print(f"❌ Error creating superuser: {e}")
        return False
