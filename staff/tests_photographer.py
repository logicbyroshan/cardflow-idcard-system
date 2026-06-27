from django.test import TestCase, RequestFactory
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta

from core.models import User
from staff.models import Staff, PhotographerAssignment
from client.models import Client
from core.services.permission_service import PermissionService
from client.services_access import ClientAccessService
from core.middleware import PermissionValidationMiddleware
from staff.services_staff_core import PhotographerService

UserModel = get_user_model()


class PhotographerTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        
        self.client_user_a = User.objects.create_user(
            username="client_user_a",
            email="client_a@example.com",
            role="client"
        )
        self.client_user_b = User.objects.create_user(
            username="client_user_b",
            email="client_b@example.com",
            role="client"
        )
        
        self.client_a = Client.objects.create(user=self.client_user_a, name="Client A", status="active")
        self.client_b = Client.objects.create(user=self.client_user_b, name="Client B", status="active")

        # Create a photographer user
        self.photographer_user = User.objects.create_user(
            username="test_photo",
            email="test_photo@example.com",
            phone="1234567890",
            role="photographer"
        )
        self.staff_profile = Staff.objects.create(
            user=self.photographer_user,
            staff_type="photographer",
        )

    def test_photographer_role_properties(self):
        """Test that User role property registers correctly."""
        self.assertTrue(self.photographer_user.is_photographer)
        self.assertFalse(self.photographer_user.is_admin_staff)
        self.assertFalse(self.photographer_user.is_client)

        # Test PermissionService detection
        self.assertTrue(PermissionService.is_photographer(self.photographer_user))
        self.assertTrue(PermissionService.is_any_admin(self.photographer_user))

    def test_photographer_permissions(self):
        """Test that a Photographer only has add/view/list permissions and no edit/delete/approve."""
        # Allowed permissions
        self.assertTrue(PermissionService.has(self.photographer_user, "perm_mobile_app"))
        self.assertTrue(PermissionService.has(self.photographer_user, "perm_idcard_add"))
        self.assertTrue(PermissionService.has(self.photographer_user, "perm_idcard_info"))
        self.assertTrue(PermissionService.has(self.photographer_user, "perm_idcard_retrieve"))
        self.assertTrue(PermissionService.has(self.photographer_user, "perm_idcard_pending_list"))
        self.assertTrue(PermissionService.has(self.photographer_user, "perm_idcard_verified_list"))
        self.assertTrue(PermissionService.has(self.photographer_user, "perm_idcard_pool_list"))

        # Forbidden permissions
        self.assertFalse(PermissionService.has(self.photographer_user, "perm_idcard_edit"))
        self.assertFalse(PermissionService.has(self.photographer_user, "perm_idcard_delete"))
        self.assertFalse(PermissionService.has(self.photographer_user, "perm_idcard_approve"))
        self.assertFalse(PermissionService.has(self.photographer_user, "perm_idcard_verify"))

    def test_photographer_client_assignments_and_expiration(self):
        """Test photographer client access scoping and expiration logic."""
        # Non-assigned client access should fail
        self.assertFalse(PermissionService.can_access_client(self.photographer_user, self.client_a.id))

        # Assign Client A with no expiration
        PhotographerAssignment.objects.create(
            photographer=self.staff_profile,
            client=self.client_a,
            expires_at=None
        )
        # Assign Client B with an expiration in the past
        PhotographerAssignment.objects.create(
            photographer=self.staff_profile,
            client=self.client_b,
            expires_at=timezone.now() - timedelta(minutes=5)
        )

        # Clear permission cache to test fresh evaluation
        from core.services.session_revalidation import bump_user_revalidation
        bump_user_revalidation(self.photographer_user.pk)
        if hasattr(self.photographer_user, '_cached_accessible_client_ids'):
            delattr(self.photographer_user, '_cached_accessible_client_ids')

        # Client A should be accessible, Client B should not (expired)
        self.assertTrue(PermissionService.can_access_client(self.photographer_user, self.client_a.id))
        self.assertFalse(PermissionService.can_access_client(self.photographer_user, self.client_b.id))

        # Test get_accessible_client_ids
        accessible_ids = PermissionService.get_accessible_client_ids(self.photographer_user)
        self.assertIn(self.client_a.id, accessible_ids)
        self.assertNotIn(self.client_b.id, accessible_ids)

    def test_middleware_blocks_web_panel_access(self):
        """Test that middleware logs out and redirects photographer accessing desktop web panel."""
        middleware = PermissionValidationMiddleware(lambda req: None)
        
        # Accessing allowed mobile API path
        req_allowed = self.factory.get("/api/mobile/dashboard/")
        req_allowed.user = self.photographer_user
        req_allowed.session = {}
        resp_allowed = middleware._validate_user_access(req_allowed)
        self.assertIsNone(resp_allowed)

        # Accessing blocked desktop panel path
        req_blocked = self.factory.get("/panel/manage-staff/")
        req_blocked.user = self.photographer_user
        req_blocked.session = {}
        
        # We override the logout redirect implementation on the middleware to capture it easily
        redirects = []
        middleware._force_logout = lambda req, msg: ("redirected_out", msg)
        
        resp_blocked = middleware._validate_user_access(req_blocked)
        self.assertIsNotNone(resp_blocked)
        self.assertEqual(resp_blocked[0], "redirected_out")
        self.assertIn("mobile application", resp_blocked[1])

    def test_photographer_service_create_and_update(self):
        """Test the photographer service CRUD logic."""
        # Create photographer via service
        create_data = {
            "name": "New Photographer",
            "email": "new_photo@example.com",
            "phone": "5551234567",
            "address": "456 Lens View",
            "is_active": "true",
            "assigned_clients": [
                {"client_id": self.client_a.id, "expires_at": None},
                {"client_id": self.client_b.id, "expires_at": (timezone.now() + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")}
            ]
        }
        res = PhotographerService.create(create_data)
        self.assertTrue(res.success)
        staff_id = res.data["staff"]["id"]
        
        new_staff = Staff.objects.get(id=staff_id)
        self.assertEqual(new_staff.user.get_full_name(), "New Photographer")
        self.assertEqual(new_staff.photographer_assignments.count(), 2)

        # Update photographer via service (remove Client B)
        update_data = {
            "name": "New Photographer Updated",
            "email": "new_photo@example.com",
            "phone": "5559876543",
            "is_active": "true",
            "assigned_clients": [
                {"client_id": self.client_a.id, "expires_at": (timezone.now() + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M")}
            ]
        }
        res_update = PhotographerService.update(staff_id, update_data)
        self.assertTrue(res_update.success)
        
        refreshed_staff = Staff.objects.get(id=staff_id)
        self.assertEqual(refreshed_staff.photographer_assignments.count(), 1)
        self.assertIsNotNone(refreshed_staff.photographer_assignments.first().expires_at)
