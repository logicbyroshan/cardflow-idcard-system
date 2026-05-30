"""
Tests for staff app.
Covers: Staff model, permissions, client access scoping.
"""
import json
from unittest import mock

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

    def test_manage_staff_renders_all_rows_not_first_ten_only(self):
        from staff.models import Staff

        for idx in range(12):
            u = User.objects.create_user(
                username=f'admin{idx}@test.com',
                email=f'admin{idx}@test.com',
                password='pass1234',
                role='admin_staff',
            )
            Staff.objects.create(user=u, staff_type='admin_staff')

        self.client.login(username='sa@test.com', password='pass1234')
        response = self.client.get('/panel/manage-staff/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context['staff_list']), 12)
        self.assertEqual(response.context['page_obj'].paginator.count, 12)

    def test_manage_staff_drawer_renders_client_assignment_section(self):
        self.client.login(username='sa@test.com', password='pass1234')
        response = self.client.get('/panel/manage-staff/')

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="client-assignment-section"')
        self.assertContains(response, 'Assign Clients')


class AdminStaffPermissionServiceTests(TestCase):
    def test_assign_permissions_rejects_invalid_codename(self):
        from staff.services import AdminStaffPermissionService

        staff_user = User.objects.create_user(
            username='permstaff@test.com', email='permstaff@test.com',
            password='pass1234', role='admin_staff',
        )

        result = AdminStaffPermissionService.assign_permissions_to_staff(
            staff_user,
            ['can_view_clients', 'not_a_real_permission'],
        )

        self.assertFalse(result['success'])
        self.assertIn('Invalid permissions', result['error'])

    def test_assign_permissions_and_get_user_permissions(self):
        from staff.services import AdminStaffPermissionService

        staff_user = User.objects.create_user(
            username='permok@test.com', email='permok@test.com',
            password='pass1234', role='admin_staff',
        )

        result = AdminStaffPermissionService.assign_permissions_to_staff(
            staff_user,
            ['can_view_clients', 'can_export_data'],
        )

        self.assertTrue(result['success'])
        permissions = AdminStaffPermissionService.get_user_permissions(staff_user)
        self.assertIn('can_view_clients', permissions)
        self.assertIn('can_export_data', permissions)

    def test_assign_permissions_does_not_delete_global_permission_rows(self):
        from django.contrib.auth.models import Permission
        from staff.services import AdminStaffPermissionService

        AdminStaffPermissionService.ensure_permissions_exist()

        staff_user_1 = User.objects.create_user(
            username='permkeep1@test.com', email='permkeep1@test.com',
            password='pass1234', role='admin_staff',
        )
        staff_user_2 = User.objects.create_user(
            username='permkeep2@test.com', email='permkeep2@test.com',
            password='pass1234', role='admin_staff',
        )

        view_perm = Permission.objects.get(codename='can_view_clients')
        staff_user_1.user_permissions.add(view_perm)
        staff_user_2.user_permissions.add(view_perm)

        result = AdminStaffPermissionService.assign_permissions_to_staff(
            staff_user_1,
            ['can_export_data'],
        )

        self.assertTrue(result['success'])
        self.assertTrue(Permission.objects.filter(codename='can_view_clients').exists())
        self.assertTrue(
            staff_user_2.user_permissions.filter(codename='can_view_clients').exists()
        )


class AdminStaffCreationServiceTests(TestCase):
    def setUp(self):
        from client.models import Client

        self.super_admin = User.objects.create_user(
            username='owner@test.com', email='owner@test.com',
            password='pass1234', role='super_admin',
        )
        self.client_owner = User.objects.create_user(
            username='clientowner@test.com', email='clientowner@test.com',
            password='pass1234', role='client',
        )
        self.client_obj = Client.objects.create(user=self.client_owner, name='ACME School')

    def test_create_admin_staff_requires_super_admin(self):
        from staff.services import AdminStaffCreationService

        non_admin = User.objects.create_user(
            username='normal@test.com', email='normal@test.com',
            password='pass1234', role='client',
        )

        result = AdminStaffCreationService.create_admin_staff(
            created_by=non_admin,
            first_name='No',
            last_name='Access',
            email='noaccess@test.com',
            password='StrongPass@123',
        )

        self.assertFalse(result['success'])
        self.assertIn('Only Super Admin', result['error'])

    def test_create_admin_staff_rejects_case_insensitive_duplicate_email(self):
        from staff.services import AdminStaffCreationService

        User.objects.create_user(
            username='existing@email.com',
            email='Existing@Email.com',
            password='pass1234',
            role='admin_staff',
        )

        result = AdminStaffCreationService.create_admin_staff(
            created_by=self.super_admin,
            first_name='Dupe',
            last_name='Email',
            email='existing@email.com',
            password='StrongPass@123',
        )

        self.assertFalse(result['success'])
        self.assertIn('already exists', result['error'])

    def test_create_admin_staff_success_creates_expected_records(self):
        from core.models import EmailLog
        from staff.models import Staff
        from staff.services import AdminStaffCreationService

        result = AdminStaffCreationService.create_admin_staff(
            created_by=self.super_admin,
            first_name='Jane',
            last_name='Manager',
            email='jane.manager@test.com',
            phone='9999999999',
            assigned_client_ids=[self.client_obj.id],
            permission_codenames=['can_view_clients'],
            password='StrongPass@123',
        )

        self.assertTrue(result['success'])
        staff = Staff.objects.select_related('user').get(user__email='jane.manager@test.com')
        self.assertFalse(staff.user.is_active)
        self.assertEqual(staff.staff_type, 'admin_staff')
        self.assertTrue(staff.assigned_clients.filter(id=self.client_obj.id).exists())
        self.assertTrue(
            EmailLog.objects.filter(
                recipient_email='jane.manager@test.com',
                status=EmailLog.STATUS_ON_HOLD,
                email_type=EmailLog.EMAIL_TYPE_WELCOME,
            ).exists()
        )

    def test_toggle_status_first_activation_marks_welcome_sent(self):
        from core.models import EmailLog
        from staff.models import Staff
        from staff.services import AdminStaffCreationService

        create_result = AdminStaffCreationService.create_admin_staff(
            created_by=self.super_admin,
            first_name='Toggle',
            last_name='User',
            email='toggle.user@test.com',
            phone='8888888888',
            password='StrongPass@123',
        )
        self.assertTrue(create_result['success'])
        staff = Staff.objects.select_related('user').get(user__email='toggle.user@test.com')

        def fake_send_welcome_email(**kwargs):
            on_success = kwargs.get('on_success')
            if callable(on_success):
                on_success()
            return True, 'ok'

        with mock.patch('staff.services.generate_secure_password', return_value='TempPass@123'):
            with mock.patch('staff.services.send_welcome_email', side_effect=fake_send_welcome_email):
                result = AdminStaffCreationService.toggle_status(self.super_admin, staff.id)

        self.assertTrue(result['success'])
        self.assertTrue(result['is_active'])

        staff.user.refresh_from_db()
        self.assertTrue(staff.user.is_active)
        self.assertTrue(staff.user.welcome_email_sent)
        self.assertTrue(
            EmailLog.objects.filter(
                recipient_email='toggle.user@test.com',
                status=EmailLog.STATUS_SENT,
                email_type=EmailLog.EMAIL_TYPE_WELCOME,
            ).exists()
        )

    def test_reset_password_requires_super_admin(self):
        from staff.models import Staff
        from staff.services import AdminStaffCreationService

        staff_user = User.objects.create_user(
            username='staffreset@test.com', email='staffreset@test.com',
            password='pass1234', role='admin_staff',
        )
        staff = Staff.objects.create(user=staff_user, staff_type='admin_staff')

        non_admin = User.objects.create_user(
            username='nonadminreset@test.com', email='nonadminreset@test.com',
            password='pass1234', role='client',
        )
        result = AdminStaffCreationService.reset_password(non_admin, staff.id)

        self.assertFalse(result['success'])
        self.assertIn('Only Super Admin', result['error'])

    def test_update_admin_staff_rejects_invalid_permissions(self):
        from staff.models import Staff
        from staff.services import AdminStaffCreationService

        staff_user = User.objects.create_user(
            username='updatestaff@test.com',
            email='updatestaff@test.com',
            password='pass1234',
            role='admin_staff',
        )
        staff = Staff.objects.create(user=staff_user, staff_type='admin_staff')

        result = AdminStaffCreationService.update_admin_staff(
            updated_by=self.super_admin,
            staff_id=staff.id,
            permission_codenames=['not_a_real_permission'],
        )

        self.assertFalse(result['success'])
        self.assertIn('Invalid permissions', result['error'])


class StaffActivationPasswordFlowTests(TestCase):
    def test_first_activation_preserves_custom_password(self):
        from core.services import StaffService
        from core.models import EmailLog

        custom_password = 'StaffCustom@123'
        result = StaffService.create(
            {
                'name': 'Custom Staff',
                'email': 'staff-custom-activation@test.com',
                'phone': '9234567890',
                'password': custom_password,
                'is_active': False,
            },
            staff_type='admin_staff',
        )
        self.assertTrue(result.success, msg=result.message)

        staff_id = result.data['staff']['id']
        staff_user = User.objects.get(email='staff-custom-activation@test.com')
        self.assertTrue(staff_user.check_password(custom_password))

        def _fake_send_welcome_email(**kwargs):
            on_success = kwargs.get('on_success')
            if callable(on_success):
                on_success()
            return True, 'Welcome email queued for delivery.'

        with mock.patch('staff.services_staff_core.send_welcome_email', side_effect=_fake_send_welcome_email) as send_welcome_mock:
            toggle_result = StaffService.toggle_status(staff_id)

        self.assertTrue(toggle_result.success, msg=toggle_result.message)
        staff_user.refresh_from_db()
        self.assertTrue(staff_user.is_active)
        self.assertTrue(staff_user.check_password(custom_password))
        send_welcome_mock.assert_called_once()
        self.assertFalse(
            EmailLog.objects.filter(
                recipient_email='staff-custom-activation@test.com',
                email_type=EmailLog.EMAIL_TYPE_WELCOME,
                status=EmailLog.STATUS_ON_HOLD,
            ).exists()
        )

    def test_create_active_staff_sends_welcome_email(self):
        from core.services import StaffService
        from core.models import EmailLog

        def _fake_send_welcome_email(**kwargs):
            on_success = kwargs.get('on_success')
            if callable(on_success):
                on_success()
            return True, 'Welcome email queued for delivery.'

        with mock.patch('staff.services_staff_core.send_welcome_email', side_effect=_fake_send_welcome_email) as send_welcome_mock:
            result = StaffService.create(
                {
                    'name': 'Active Staff Email',
                    'email': 'active-staff-email@test.com',
                    'phone': '9123456789',
                    'password': '',
                    'is_active': True,
                },
                staff_type='admin_staff',
            )

        self.assertTrue(result.success, msg=result.message)
        self.assertTrue(result.data.get('email_sent'))
        send_welcome_mock.assert_called_once()

        created_user = User.objects.get(email='active-staff-email@test.com')
        self.assertTrue(created_user.welcome_email_sent)
        self.assertTrue(
            EmailLog.objects.filter(
                recipient_email='active-staff-email@test.com',
                email_type=EmailLog.EMAIL_TYPE_WELCOME,
                status=EmailLog.STATUS_SENT,
            ).exists()
        )

    def test_create_inactive_staff_keeps_welcome_email_on_hold(self):
        from core.services import StaffService
        from core.models import EmailLog

        with mock.patch('staff.services_staff_core.send_welcome_email') as send_welcome_mock:
            result = StaffService.create(
                {
                    'name': 'Inactive Staff Email',
                    'email': 'inactive-staff-email@test.com',
                    'phone': '9234567890',
                    'password': '',
                    'is_active': False,
                },
                staff_type='admin_staff',
            )

        self.assertTrue(result.success, msg=result.message)
        self.assertFalse(result.data.get('email_sent'))
        send_welcome_mock.assert_not_called()
        self.assertTrue(
            EmailLog.objects.filter(
                recipient_email='inactive-staff-email@test.com',
                email_type=EmailLog.EMAIL_TYPE_WELCOME,
                status=EmailLog.STATUS_ON_HOLD,
            ).exists()
        )

    def test_create_rejects_missing_phone_and_custom_password(self):
        from core.services import StaffService

        result = StaffService.create(
            {
                'name': 'Missing Credentials Staff',
                'email': '',
                'phone': '',
                'password': '',
                'is_active': False,
            },
            staff_type='admin_staff',
        )

        self.assertFalse(result.success)
        self.assertIn('phone number is required', result.message.lower())

    def test_create_allows_custom_password_without_phone_or_email(self):
        from core.services import StaffService
        from staff.models import Staff

        result = StaffService.create(
            {
                'name': 'Custom No Contact Staff',
                'email': '',
                'phone': '',
                'password': 'StaffOnly@123',
                'is_active': False,
            },
            staff_type='admin_staff',
        )

        self.assertTrue(result.success, msg=result.message)
        created_staff = Staff.objects.select_related('user').get(id=result.data['staff']['id'])
        staff_user = created_staff.user
        self.assertTrue(staff_user.check_password('StaffOnly@123'))


class StaffApiIntegrationTests(TestCase):
    def setUp(self):
        from client.models import Client
        from django.contrib.auth.models import Permission
        from staff.models import Staff
        from staff.services import AdminStaffPermissionService

        self.super_admin = User.objects.create_user(
            username='superapi@test.com', email='superapi@test.com',
            password='pass1234', role='super_admin',
        )
        self.admin_staff_user = User.objects.create_user(
            username='adminstaffapi@test.com', email='adminstaffapi@test.com',
            password='pass1234', role='admin_staff',
        )
        self.client_user = User.objects.create_user(
            username='clientapi@test.com', email='clientapi@test.com',
            password='pass1234', role='client',
        )
        self.client_obj = Client.objects.create(user=self.client_user, name='Scoped Client')

        self.another_client_user = User.objects.create_user(
            username='otherclient@test.com', email='otherclient@test.com',
            password='pass1234', role='client',
        )
        self.another_client = Client.objects.create(user=self.another_client_user, name='Other Client')

        self.staff_profile = Staff.objects.create(user=self.admin_staff_user, staff_type='admin_staff')
        self.staff_profile.assigned_clients.add(self.client_obj)

        AdminStaffPermissionService.ensure_permissions_exist()
        self.view_clients_perm = Permission.objects.get(codename='can_view_clients')
        self.view_idcard_perm = Permission.objects.get(codename='can_view_idcard_data')

    def test_client_cannot_access_super_admin_admin_staff_api(self):
        self.client.force_login(self.client_user)
        response = self.client.get('/panel/staff/api/admin-staff/')
        self.assertEqual(response.status_code, 403)

    def test_super_admin_create_api_invalid_json_returns_400(self):
        self.client.force_login(self.super_admin)
        response = self.client.post(
            '/panel/staff/api/admin-staff/',
            data='this is not json',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_super_admin_create_api_non_object_json_returns_400(self):
        self.client.force_login(self.super_admin)
        response = self.client.post(
            '/panel/staff/api/admin-staff/',
            data='[]',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_super_admin_create_api_success(self):
        from staff.models import Staff

        self.client.force_login(self.super_admin)
        payload = {
            'first_name': 'API',
            'last_name': 'Created',
            'email': 'api.created@test.com',
            'phone': '7777777777',
            'designation': 'Manager',
            'department': 'Ops',
            'password': 'StrongPass@123',
            'assigned_clients': [self.client_obj.id],
            'permissions': ['can_view_clients'],
        }
        response = self.client.post(
            '/panel/staff/api/admin-staff/',
            data=json.dumps(payload),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(Staff.objects.filter(user__email='api.created@test.com').exists())

    def test_super_admin_update_api_non_object_json_returns_400(self):
        from staff.models import Staff

        self.client.force_login(self.super_admin)
        update_user = User.objects.create_user(
            username='apiupdate@test.com',
            email='apiupdate@test.com',
            password='pass1234',
            role='admin_staff',
        )
        update_staff = Staff.objects.create(user=update_user, staff_type='admin_staff')

        response = self.client.put(
            f'/panel/staff/api/admin-staff/{update_staff.id}/',
            data='[]',
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)

    def test_my_permissions_returns_scope_for_admin_staff(self):
        self.admin_staff_user.user_permissions.add(self.view_clients_perm)
        self.client.force_login(self.admin_staff_user)

        response = self.client.get('/panel/staff/api/my/permissions/')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['user']['role'], 'admin_staff')
        self.assertIn(self.client_obj.id, payload['scope']['accessible_client_ids'])

    def test_scoped_clients_requires_permission(self):
        self.client.force_login(self.admin_staff_user)
        denied = self.client.get('/panel/staff/api/clients/')
        self.assertEqual(denied.status_code, 403)

        self.admin_staff_user.user_permissions.add(self.view_clients_perm)
        allowed = self.client.get('/panel/staff/api/clients/')
        self.assertEqual(allowed.status_code, 200)

        clients = allowed.json()['clients']
        returned_ids = {item['id'] for item in clients}
        self.assertIn(self.client_obj.id, returned_ids)
        self.assertNotIn(self.another_client.id, returned_ids)

    def test_client_idcard_groups_enforces_scope(self):
        self.admin_staff_user.user_permissions.add(self.view_idcard_perm)
        self.client.force_login(self.admin_staff_user)

        forbidden = self.client.get(f'/panel/staff/api/clients/{self.another_client.id}/idcard-groups/')
        self.assertEqual(forbidden.status_code, 403)

        allowed = self.client.get(f'/panel/staff/api/clients/{self.client_obj.id}/idcard-groups/')
        self.assertEqual(allowed.status_code, 200)
        self.assertTrue(allowed.json()['success'])
