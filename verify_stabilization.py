import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from core.services.permission_service import PermissionService
from client.models import Client

User = get_user_model()

def test_permissions():
    # Find a client user
    client_user = User.objects.filter(role='client', is_active=True).first()
    if not client_user:
        print("No client user found for testing")
        return

    print(f"Testing permissions for client user: {client_user.username}")
    
    # Check perm_manage_client_staff
    has_perm = PermissionService.has(client_user, 'perm_manage_client_staff')
    print(f"Has perm_manage_client_staff: {has_perm}")
    
    if not has_perm:
        print("FAILED: Client user should have perm_manage_client_staff implicitly")
    else:
        print("SUCCESS: Client user has perm_manage_client_staff implicitly")

    # Check safe string handling (simulated)
    try:
        from client.services_staff import ClientStaffService
        # This is just to check if it imports and doesn't have syntax errors
        print("ClientStaffService imported successfully")
    except Exception as e:
        print(f"FAILED to import ClientStaffService: {e}")

if __name__ == "__main__":
    test_permissions()
