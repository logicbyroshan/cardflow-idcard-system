
"""
Django admin integration has been removed project-wide.
This module is intentionally minimal to avoid importing `django.contrib.admin`.
The project's custom panel under `/panel/` provides the admin UI and management.
"""

__all__ = []
from staff.models import Staff

from idcards.models import IDCardGroup, IDCard, IDCardTable

from .models import User, SystemSettings, ExportTemplate, ActivityLog, Notification, NotificationRead

