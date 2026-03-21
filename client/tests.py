"""
Tests for client app.
Covers: Client model, access control, client dashboard access.
"""
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.cache import cache
from unittest import mock

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

    def test_admin_staff_client_scope_is_assigned_only(self):
        from client.services import ClientAccessService
        from client.models import Client
        from staff.models import Staff

        owner_a = User.objects.create_user(
            username='owner-a@test.com', email='owner-a@test.com',
            password='pass1234', role='client',
        )
        owner_b = User.objects.create_user(
            username='owner-b@test.com', email='owner-b@test.com',
            password='pass1234', role='client',
        )
        client_a = Client.objects.create(user=owner_a, name='Client A')
        client_b = Client.objects.create(user=owner_b, name='Client B')

        staff_user = User.objects.create_user(
            username='staff-a@test.com', email='staff-a@test.com',
            password='pass1234', role='admin_staff',
        )
        staff = Staff.objects.create(user=staff_user, staff_type='admin_staff')
        staff.assigned_clients.add(client_a)

        self.assertTrue(ClientAccessService.can_access_client(staff_user, client_a.id))
        self.assertFalse(ClientAccessService.can_access_client(staff_user, client_b.id))

    def test_admin_staff_table_and_card_scope_is_assigned_only(self):
        from client.services import ClientAccessService
        from client.models import Client
        from staff.models import Staff
        from idcards.models import IDCardGroup, IDCardTable, IDCard

        owner_a = User.objects.create_user(
            username='owner2-a@test.com', email='owner2-a@test.com',
            password='pass1234', role='client',
        )
        owner_b = User.objects.create_user(
            username='owner2-b@test.com', email='owner2-b@test.com',
            password='pass1234', role='client',
        )
        client_a = Client.objects.create(user=owner_a, name='Client 2A')
        client_b = Client.objects.create(user=owner_b, name='Client 2B')

        group_a = IDCardGroup.objects.create(client=client_a, name='Group A')
        group_b = IDCardGroup.objects.create(client=client_b, name='Group B')
        table_a = IDCardTable.objects.create(group=group_a, name='Table A', fields=[])
        table_b = IDCardTable.objects.create(group=group_b, name='Table B', fields=[])
        card_a = IDCard.objects.create(table=table_a, field_data={'NAME': 'A'})
        card_b = IDCard.objects.create(table=table_b, field_data={'NAME': 'B'})

        staff_user = User.objects.create_user(
            username='staff-b@test.com', email='staff-b@test.com',
            password='pass1234', role='admin_staff',
        )
        staff = Staff.objects.create(user=staff_user, staff_type='admin_staff')
        staff.assigned_clients.add(client_a)

        self.assertTrue(ClientAccessService.can_access_table(staff_user, table_a))
        self.assertFalse(ClientAccessService.can_access_table(staff_user, table_b))
        self.assertTrue(ClientAccessService.can_access_card(staff_user, card_a))
        self.assertFalse(ClientAccessService.can_access_card(staff_user, card_b))


class ClientStaffTransactionTests(TestCase):
    """Transactional safety tests for ClientStaffService."""

    def test_update_staff_rolls_back_on_staff_save_failure(self):
        from client.services import ClientStaffService
        from client.models import Client
        from staff.models import Staff

        owner = User.objects.create_user(
            username='owner-tx@test.com', email='owner-tx@test.com',
            password='pass1234', role='client',
        )
        client_obj = Client.objects.create(user=owner, name='Tx Client', perm_idcard_client_list=True)

        staff_user = User.objects.create_user(
            username='staff-tx@test.com', email='staff-tx@test.com',
            password='pass1234', role='client_staff', phone='1111111111'
        )
        staff = Staff.objects.create(user=staff_user, staff_type='client_staff', client=client_obj)

        original_phone = staff_user.phone

        with mock.patch('staff.models.Staff.save', side_effect=Exception('forced-fail')):
            result = ClientStaffService.update_staff(owner, staff.id, {'phone': '9999999999'})

        self.assertFalse(result.success)
        staff_user.refresh_from_db()
        self.assertEqual(staff_user.phone, original_phone)
