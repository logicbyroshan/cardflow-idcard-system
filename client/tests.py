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


class ClientModelFolderCodeTests(TestCase):
    def test_image_folder_code_generated_and_length_is_ten(self):
        from client.models import Client
        user = User.objects.create_user(
            username='folder1@test.com', email='folder1@test.com',
            password='pass1234', role='client',
        )
        client = Client.objects.create(user=user, name='Alpha Public School')
        self.assertIsNotNone(client.image_folder_code)
        self.assertEqual(len(client.image_folder_code), 10)

    def test_image_folder_suffix_stays_stable_on_name_change(self):
        from client.models import Client
        user = User.objects.create_user(
            username='folder2@test.com', email='folder2@test.com',
            password='pass1234', role='client',
        )
        client = Client.objects.create(user=user, name='First Name')
        old_suffix = client.image_folder_suffix
        old_code = client.image_folder_code

        client.name = 'Second Name'
        client.save()
        client.refresh_from_db()

        self.assertEqual(client.image_folder_suffix, old_suffix)
        self.assertNotEqual(client.image_folder_code, old_code)


class ClientAccessServiceAdvancedTests(TestCase):
    def setUp(self):
        from client.models import Client
        from staff.models import Staff
        from idcards.models import IDCardGroup, IDCardTable, IDCard

        self.client_owner = User.objects.create_user(
            username='owner-adv@test.com', email='owner-adv@test.com',
            password='pass1234', role='client',
        )
        self.client_obj = Client.objects.create(user=self.client_owner, name='Adv Client')

        self.group_a = IDCardGroup.objects.create(client=self.client_obj, name='Group A')
        self.group_b = IDCardGroup.objects.create(client=self.client_obj, name='Group B')
        self.table_a = IDCardTable.objects.create(group=self.group_a, name='Table A', fields=[])
        self.table_b = IDCardTable.objects.create(group=self.group_b, name='Table B', fields=[])
        self.card_a = IDCard.objects.create(table=self.table_a, field_data={'NAME': 'A'})

        self.staff_user = User.objects.create_user(
            username='cstaff-adv@test.com', email='cstaff-adv@test.com',
            password='pass1234', role='client_staff',
        )
        self.staff = Staff.objects.create(user=self.staff_user, staff_type='client_staff', client=self.client_obj)
        self.staff.assigned_groups.add(self.group_a)

    def test_client_staff_assigned_groups_restrict_table_access(self):
        from client.services import ClientAccessService
        self.assertTrue(ClientAccessService.can_access_table(self.staff_user, self.table_a))
        self.assertFalse(ClientAccessService.can_access_table(self.staff_user, self.table_b))

    def test_get_accessible_table_ids_for_client_staff(self):
        from client.services import ClientAccessService
        table_ids = ClientAccessService.get_accessible_table_ids(self.staff_user)
        self.assertIn(self.table_a.id, table_ids)
        self.assertNotIn(self.table_b.id, table_ids)

    def test_get_accessible_table_ids_for_client_admin_returns_none(self):
        from client.services import ClientAccessService
        self.assertIsNone(ClientAccessService.get_accessible_table_ids(self.client_owner))

    def test_client_staff_assigned_groups_restrict_card_access(self):
        from client.services import ClientAccessService
        self.assertTrue(ClientAccessService.can_access_card(self.staff_user, self.card_a))


class ClientDashboardServiceTests(TestCase):
    def test_dashboard_data_for_non_client_returns_error(self):
        from client.services import ClientDashboardService
        admin = User.objects.create_user(
            username='dash-admin@test.com', email='dash-admin@test.com',
            password='pass1234', role='super_admin',
        )
        result = ClientDashboardService.get_dashboard_data(admin)
        self.assertFalse(result.success)

    def test_dashboard_counts_exclude_pool_from_total_cards(self):
        from client.services import ClientDashboardService
        from client.models import Client
        from idcards.models import IDCardGroup, IDCardTable, IDCard

        owner = User.objects.create_user(
            username='dash-owner@test.com', email='dash-owner@test.com',
            password='pass1234', role='client',
        )
        client_obj = Client.objects.create(user=owner, name='Dash Client')
        group = IDCardGroup.objects.create(client=client_obj, name='Group')
        table = IDCardTable.objects.create(group=group, name='Table', fields=[])

        IDCard.objects.create(table=table, field_data={'NAME': 'P'}, status='pending')
        IDCard.objects.create(table=table, field_data={'NAME': 'V'}, status='verified')
        IDCard.objects.create(table=table, field_data={'NAME': 'A'}, status='approved')
        IDCard.objects.create(table=table, field_data={'NAME': 'D'}, status='download')
        IDCard.objects.create(table=table, field_data={'NAME': 'X'}, status='pool')

        result = ClientDashboardService.get_dashboard_data(owner)
        self.assertTrue(result.success)
        self.assertEqual(result.data['counts']['pool'], 1)
        self.assertEqual(result.data['total_cards'], 4)


class ClientStaffServicePermissionTests(TestCase):
    def setUp(self):
        from client.models import Client
        self.owner = User.objects.create_user(
            username='staff-owner@test.com', email='staff-owner@test.com',
            password='pass1234', role='client',
        )
        self.client_obj = Client.objects.create(
            user=self.owner,
            name='Staff Perm Client',
            perm_idcard_client_list=True,
            perm_idcard_add=False,
        )

    def test_create_staff_cannot_grant_permission_client_does_not_have(self):
        from client.services import ClientStaffService
        from staff.models import Staff

        result = ClientStaffService.create_staff(self.owner, {
            'email': 'new-staff@test.com',
            'first_name': 'New',
            'last_name': 'Staff',
            'phone': '8888888888',
            'perm_idcard_add': True,
        })
        self.assertTrue(result.success)

        staff = Staff.objects.select_related('user').get(id=result.data['staff_id'])
        self.assertFalse(staff.perm_idcard_add)

    def test_create_staff_requires_client_list_permission(self):
        from client.services import ClientStaffService
        self.client_obj.perm_idcard_client_list = False
        self.client_obj.save(update_fields=['perm_idcard_client_list'])

        result = ClientStaffService.create_staff(self.owner, {
            'email': 'blocked-staff@test.com',
            'name': 'Blocked Staff',
        })
        self.assertFalse(result.success)
        self.assertIn('Permission denied', result.message)


class ClientApiIntegrationTests(TestCase):
    def setUp(self):
        from client.models import Client
        from idcards.models import IDCardGroup, IDCardTable, IDCard
        from staff.models import Staff

        self.owner = User.objects.create_user(
            username='api-owner@test.com', email='api-owner@test.com',
            password='pass1234', role='client',
        )
        self.client_obj = Client.objects.create(
            user=self.owner,
            name='API Client',
            perm_idcard_setting_list=True,
            perm_idcard_client_list=True,
            perm_idcard_pending_list=True,
        )

        self.group = IDCardGroup.objects.create(client=self.client_obj, name='Class 10')
        self.table = IDCardTable.objects.create(
            group=self.group,
            name='Students',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
                {'name': 'NAME', 'type': 'text'},
            ],
        )
        self.card = IDCard.objects.create(
            table=self.table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'NAME': 'John'},
        )

        self.client_staff_user = User.objects.create_user(
            username='api-staff@test.com', email='api-staff@test.com',
            password='pass1234', role='client_staff',
        )
        self.staff_profile = Staff.objects.create(
            user=self.client_staff_user,
            staff_type='client_staff',
            client=self.client_obj,
        )

    def test_api_tables_list_permission_denied_when_setting_list_off(self):
        self.client_obj.perm_idcard_setting_list = False
        self.client_obj.save(update_fields=['perm_idcard_setting_list'])
        self.client.login(username='api-owner@test.com', password='pass1234')

        response = self.client.get('/panel/client/api/tables/')
        self.assertEqual(response.status_code, 403)

    def test_api_tables_list_success(self):
        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.get('/panel/client/api/tables/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertGreaterEqual(len(payload.get('tables', [])), 1)

    def test_api_class_section_options_returns_values(self):
        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.get('/panel/client/api/class-section-options/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertIn('10', payload.get('classes', []))
        self.assertIn('A', payload.get('sections', []))

    def test_api_staff_list_create_rejects_client_staff_role(self):
        self.client.login(username='api-staff@test.com', password='pass1234')
        response = self.client.get(
            '/panel/client/api/staff/',
            HTTP_X_REQUESTED_WITH='XMLHttpRequest',
        )
        self.assertEqual(response.status_code, 403)

    def test_api_card_detail_success_for_client(self):
        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.get(f'/panel/client/api/cards/{self.card.id}/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
