import pytest

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
