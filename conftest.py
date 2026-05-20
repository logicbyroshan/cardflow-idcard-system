import os
import sys

# CRITICAL: Set RUNNING_TESTS BEFORE DJANGO IMPORTS
os.environ['RUNNING_TESTS'] = '1'
os.environ['DEBUG'] = 'True'  # Force settings to think we're in DEBUG mode for checks, but exclude debug_toolbar

# Now import pytest
import pytest

# Configure Django BEFORE setup
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Import settings BEFORE django.setup() so we can override them
from django.conf import settings

# Override database to use in-memory SQLite for tests to avoid file-locking contention
# MUST be done BEFORE django.setup() to take effect
settings.DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
        'ATOMIC_REQUESTS': True,
        'OPTIONS': {
            'timeout': 20,
        }
    }
}

# Now setup Django with the overridden settings
import django
django.setup()

# After Django setup, remove debug_toolbar from MIDDLEWARE and INSTALLED_APPS if present
if 'debug_toolbar' in settings.INSTALLED_APPS:
    settings.INSTALLED_APPS = tuple(
        app for app in settings.INSTALLED_APPS if app != 'debug_toolbar'
    )
if 'debug_toolbar.middleware.DebugToolbarMiddleware' in settings.MIDDLEWARE:
    settings.MIDDLEWARE = tuple(
        m for m in settings.MIDDLEWARE if m != 'debug_toolbar.middleware.DebugToolbarMiddleware'
    )

# Run migrations on the in-memory database immediately after Django setup
# REMOVED: call_command at module level causes RuntimeError with pytest-django
# Will run migrations via pytest_configure hook instead

def pytest_configure(config):
	"""Initialize test database with migrations."""
	from django.core.management import call_command
	call_command('migrate', verbosity=0, interactive=False)

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
    # OfficeWork app removed; keep marker list focused on active suites
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

