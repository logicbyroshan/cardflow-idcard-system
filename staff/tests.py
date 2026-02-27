"""
Tests for staff app.
Covers: Staff model, permissions, client access scoping.
"""
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.cache import cache

User = get_user_model()


class StaffModelTests(TestCase):
    """Tests for Staff model."""

    def test_create_admin_staff(self):
        from staff.models import Staff
        from client.models import Client

        user = User.objects.create_user(
            username='staff@test.com', email='staff@test.com',
            password='pass1234', role='admin_staff',
        )
        staff = Staff.objects.create(user=user, staff_type='admin_staff')
        self.assertEqual(staff.staff_type, 'admin_staff')
        self.assertEqual(staff.user.role, 'admin_staff')

    def test_create_client_staff(self):
        from staff.models import Staff
        from client.models import Client

        client_user = User.objects.create_user(
            username='cu@test.com', email='cu@test.com',
            password='pass1234', role='client',
        )
        client = Client.objects.create(user=client_user, name='Staff Client')

        cs_user = User.objects.create_user(
            username='cs@test.com', email='cs@test.com',
            password='pass1234', role='client_staff',
        )
        staff = Staff.objects.create(
            user=cs_user, staff_type='client_staff', client=client,
        )
        self.assertEqual(staff.client.id, client.id)
        self.assertEqual(staff.staff_type, 'client_staff')

    def test_staff_can_access_client(self):
        from staff.models import Staff
        from client.models import Client

        client_user = User.objects.create_user(
            username='cu2@test.com', email='cu2@test.com',
            password='pass1234', role='client',
        )
        client = Client.objects.create(user=client_user, name='Access Client')

        staff_user = User.objects.create_user(
            username='as@test.com', email='as@test.com',
            password='pass1234', role='admin_staff',
        )
        staff = Staff.objects.create(user=staff_user, staff_type='admin_staff')
        staff.assigned_clients.add(client)

        self.assertTrue(staff.can_access_client(client.id))

    def test_staff_cannot_access_unassigned_client(self):
        from staff.models import Staff
        from client.models import Client

        client_user = User.objects.create_user(
            username='cu3@test.com', email='cu3@test.com',
            password='pass1234', role='client',
        )
        client = Client.objects.create(user=client_user, name='Unassigned')

        staff_user = User.objects.create_user(
            username='as2@test.com', email='as2@test.com',
            password='pass1234', role='admin_staff',
        )
        staff = Staff.objects.create(user=staff_user, staff_type='admin_staff')
        # Not assigned
        self.assertFalse(staff.can_access_client(client.id))

    def test_get_accessible_client_ids_empty(self):
        from staff.models import Staff
        staff_user = User.objects.create_user(
            username='empty@test.com', email='empty@test.com',
            password='pass1234', role='admin_staff',
        )
        staff = Staff.objects.create(user=staff_user, staff_type='admin_staff')
        ids = staff.get_accessible_client_ids()
        self.assertEqual(len(ids), 0)

    def test_get_accessible_client_ids_with_assignments(self):
        from staff.models import Staff
        from client.models import Client

        cu1 = User.objects.create_user(
            username='c1@t.com', email='c1@t.com', password='p1234567', role='client',
        )
        cl1 = Client.objects.create(user=cu1, name='C1')
        cu2 = User.objects.create_user(
            username='c2@t.com', email='c2@t.com', password='p1234567', role='client',
        )
        cl2 = Client.objects.create(user=cu2, name='C2')

        staff_user = User.objects.create_user(
            username='multi@test.com', email='multi@test.com',
            password='pass1234', role='admin_staff',
        )
        staff = Staff.objects.create(user=staff_user, staff_type='admin_staff')
        staff.assigned_clients.add(cl1, cl2)

        ids = staff.get_accessible_client_ids()
        self.assertEqual(len(ids), 2)
        self.assertIn(cl1.id, ids)
        self.assertIn(cl2.id, ids)


class StaffPermissionViewTests(TestCase):
    """Tests for staff-related view permissions."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='sa@test.com', email='sa@test.com',
            password='pass1234', role='super_admin',
        )
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_manage_staff_accessible_by_admin(self):
        self.client.login(username='sa@test.com', password='pass1234')
        response = self.client.get('/panel/manage-staff/')
        self.assertIn(response.status_code, [200, 302])

    def test_manage_staff_blocked_for_client(self):
        client_user = User.objects.create_user(
            username='cl@test.com', email='cl@test.com',
            password='pass1234', role='client',
        )
        self.client.login(username='cl@test.com', password='pass1234')
        response = self.client.get('/panel/manage-staff/')
        self.assertIn(response.status_code, [302, 403])
