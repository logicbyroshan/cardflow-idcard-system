"""
Backward-compatible shim.
Canonical location: client/services_client_core.py

New code should import directly from client.services_client_core.
"""
from client.services_client_core import ClientService  # noqa: F401
