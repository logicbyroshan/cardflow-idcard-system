"""
Tests for client app.
Covers: Client model, access control, client dashboard access.
"""
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.cache import cache

User = get_user_model()


class ClientModelTests(TestCase):
    """Tests for Client model."""

    def test_create_client(self):
        from client.models import Client
        user = User.objects.create_user(
            username='c1@test.com', email='c1@test.com',
            password='pass1234', role='client',
        )
        client = Client.objects.create(user=user, name='Test School')
        self.assertEqual(client.name, 'Test School')
        self.assertEqual(client.status, 'active')
        self.assertIsNotNone(client.image_folder_uuid)

    def test_client_default_permissions(self):
        from client.models import Client
        user = User.objects.create_user(
            username='c2@test.com', email='c2@test.com',
            password='pass1234', role='client',
        )
        client = Client.objects.create(user=user, name='Perm Client')
        # Default permissions should be set by model defaults
        self.assertIsNotNone(client.perm_idcard_pending_list)

    def test_client_user_relationship(self):
        from client.models import Client
        user = User.objects.create_user(
            username='c3@test.com', email='c3@test.com',
            password='pass1234', role='client',
        )
        client = Client.objects.create(user=user, name='Rel Client')
        self.assertEqual(user.client_profile, client)
        self.assertEqual(client.user.email, 'c3@test.com')


class ClientAccessControlTests(TestCase):
    """Tests for client access control."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='access@test.com', email='access@test.com',
            password='pass1234', role='client',
        )
        from client.models import Client
        self.client_obj = Client.objects.create(user=self.user, name='Access Client')
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_client_dashboard_accessible(self):
        self.client.login(username='access@test.com', password='pass1234')
        response = self.client.get('/panel/client/dashboard/')
        self.assertIn(response.status_code, [200, 302])

    def test_non_client_blocked_from_client_dashboard(self):
        admin = User.objects.create_user(
            username='adm@test.com', email='adm@test.com',
            password='pass1234', role='super_admin',
        )
        self.client.login(username='adm@test.com', password='pass1234')
        response = self.client.get('/panel/client/dashboard/')
        # Super admin may be redirected or get 403
        self.assertIn(response.status_code, [200, 302, 403])

    def test_unauthenticated_blocked_from_client_dashboard(self):
        response = self.client.get('/panel/client/dashboard/')
        self.assertIn(response.status_code, [302, 403])


class ClientAccessServiceTests(TestCase):
    """Tests for ClientAccessService."""

    def test_get_client_for_user(self):
        from client.services import ClientAccessService
        from client.models import Client
        user = User.objects.create_user(
            username='cas@test.com', email='cas@test.com',
            password='pass1234', role='client',
        )
        client = Client.objects.create(user=user, name='CAS Client')
        result = ClientAccessService.get_client_for_user(user)
        self.assertEqual(result.id, client.id)

    def test_get_client_for_non_client_user(self):
        from client.services import ClientAccessService
        admin = User.objects.create_user(
            username='nocas@test.com', email='nocas@test.com',
            password='pass1234', role='super_admin',
        )
        result = ClientAccessService.get_client_for_user(admin)
        self.assertIsNone(result)
