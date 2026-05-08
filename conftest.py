import os
import sys

# CRITICAL: Set RUNNING_TESTS BEFORE DJANGO IMPORTS
os.environ['RUNNING_TESTS'] = '1'
os.environ['DEBUG'] = 'True'  # Force settings to think we're in DEBUG mode for checks, but exclude debug_toolbar

# Now import pytest
import pytest

# Configure Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Import Django and setup AFTER env vars are set
import django
django.setup()

# After Django setup, remove debug_toolbar from MIDDLEWARE and INSTALLED_APPS if present
from django.conf import settings
if 'debug_toolbar' in settings.INSTALLED_APPS:
    settings.INSTALLED_APPS = tuple(
        app for app in settings.INSTALLED_APPS if app != 'debug_toolbar'
    )
if 'debug_toolbar.middleware.DebugToolbarMiddleware' in settings.MIDDLEWARE:
    settings.MIDDLEWARE = tuple(
        m for m in settings.MIDDLEWARE if m != 'debug_toolbar.middleware.DebugToolbarMiddleware'
    )

# Marker lanes are applied centrally so we don't need to touch hundreds of test files.
SLOW_NODEID_PREFIXES = (
    "mobile_app/tests.py::",
    "exports/tests.py::",
)

VERY_SLOW_NODEID_CONTAINS = (
    "mobile_app/tests.py::MobileAppPhase1SmokeAndVisualTests::",
)

IMPORTANT_NODEID_CONTAINS = (
    "SecurityApiRegressionTests",
    "OfficeWork",
    "ReprintApiIntegrationTests",
    "ClientApiIntegrationTests",
    "ExportApiIntegrationAdvancedTests",
    "ExportDeepLimitAndRoleTests",
)


def pytest_collection_modifyitems(items):
    for item in items:
        nodeid = item.nodeid

        if nodeid.startswith(SLOW_NODEID_PREFIXES):
            item.add_marker(pytest.mark.slow)

        if any(token in nodeid for token in VERY_SLOW_NODEID_CONTAINS):
            item.add_marker(pytest.mark.very_slow)

        if any(token in nodeid for token in IMPORTANT_NODEID_CONTAINS):
            item.add_marker(pytest.mark.important)
