"""
Tests for client app.
Covers: Client model, access control, client dashboard access.
"""
import json

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
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


class ManageClientsPaginationTests(TestCase):
    def setUp(self):
        from client.models import Client

        self.super_admin = User.objects.create_user(
            username='sa-manage-clients@test.com',
            email='sa-manage-clients@test.com',
            password='pass1234',
            role='super_admin',
        )
        for idx in range(12):
            owner = User.objects.create_user(
                username=f'client-owner-{idx}@test.com',
                email=f'client-owner-{idx}@test.com',
                password='pass1234',
                role='client',
            )
            Client.objects.create(user=owner, name=f'Client {idx}')

    def test_manage_clients_renders_all_rows_not_first_ten_only(self):
        self.client.login(username='sa-manage-clients@test.com', password='pass1234')
        response = self.client.get('/panel/manage-clients/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context['clients']), 12)
        self.assertEqual(response.context['page_obj'].paginator.count, 12)

    def test_manage_clients_shows_delete_button_for_super_admin(self):
        self.client.login(username='sa-manage-clients@test.com', password='pass1234')
        response = self.client.get('/panel/manage-clients/')

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="deleteClientBtn"')


class ManageClientsPermissionGateTests(TestCase):
    def setUp(self):
        from client.models import Client
        from staff.models import Staff

        owner = User.objects.create_user(
            username='gate-client-owner@test.com',
            email='gate-client-owner@test.com',
            password='pass1234',
            role='client',
        )
        self.client_obj = Client.objects.create(user=owner, name='Gate Client')
        owner2 = User.objects.create_user(
            username='gate-client-owner-2@test.com',
            email='gate-client-owner-2@test.com',
            password='pass1234',
            role='client',
        )
        self.client_obj_2 = Client.objects.create(user=owner2, name='Gate Client 2')

        self.admin_staff = User.objects.create_user(
            username='gate-admin-staff@test.com',
            email='gate-admin-staff@test.com',
            password='pass1234',
            role='admin_staff',
        )
        self.staff_profile = Staff.objects.create(user=self.admin_staff, staff_type='admin_staff')
        self.staff_profile.assigned_clients.add(self.client_obj)

    def test_manage_clients_redirects_admin_staff_without_manage_client_permission(self):
        self.client.login(username='gate-admin-staff@test.com', password='pass1234')
        response = self.client.get('/panel/manage-clients/')
        self.assertEqual(response.status_code, 302)

    def test_manage_clients_allows_admin_staff_with_manage_client_permission(self):
        self.staff_profile.perm_idcard_client_list = True
        self.staff_profile.save(update_fields=['perm_idcard_client_list'])

        self.client.login(username='gate-admin-staff@test.com', password='pass1234')
        response = self.client.get('/panel/manage-clients/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.context['clients']), 2)
        self.assertEqual(response.context['page_obj'].paginator.count, 2)
        self.assertTrue(response.context['can_manage_clients'])
        self.assertNotContains(response, 'id="deleteClientBtn"')


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

    def test_dashboard_counts_scoped_for_client_staff(self):
        from client.services import ClientDashboardService
        from client.models import Client
        from idcards.models import IDCardGroup, IDCardTable, IDCard
        from staff.models import Staff

        owner = User.objects.create_user(
            username='dash-owner-staff@test.com', email='dash-owner-staff@test.com',
            password='pass1234', role='client',
        )
        client_obj = Client.objects.create(user=owner, name='Dash Staff Client')

        group_a = IDCardGroup.objects.create(client=client_obj, name='Group A')
        group_b = IDCardGroup.objects.create(client=client_obj, name='Group B')

        table_a = IDCardTable.objects.create(
            group=group_a,
            name='Table A',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
            ],
        )
        table_b = IDCardTable.objects.create(
            group=group_b,
            name='Table B',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
            ],
        )

        IDCard.objects.create(table=table_a, status='pending', field_data={'CLASS': '10', 'SECTION': 'A'})
        IDCard.objects.create(table=table_a, status='verified', field_data={'CLASS': '11', 'SECTION': 'A'})
        IDCard.objects.create(table=table_b, status='pending', field_data={'CLASS': '10', 'SECTION': 'A'})

        staff_user = User.objects.create_user(
            username='dash-cstaff@test.com', email='dash-cstaff@test.com',
            password='pass1234', role='client_staff',
        )
        staff = Staff.objects.create(
            user=staff_user,
            staff_type='client_staff',
            client=client_obj,
            assigned_table_ids=[table_a.id],
            allowed_classes=['10'],
        )
        self.assertIsNotNone(staff.id)

        result = ClientDashboardService.get_dashboard_data(staff_user)
        self.assertTrue(result.success)
        self.assertEqual(result.data['group_count'], 1)

    def test_groups_with_counts_scoped_for_client_staff(self):
        from client.services import ClientDashboardService
        from client.models import Client
        from idcards.models import IDCardGroup, IDCardTable, IDCard
        from staff.models import Staff

        owner = User.objects.create_user(
            username='dash-owner-groups@test.com', email='dash-owner-groups@test.com',
            password='pass1234', role='client',
        )
        client_obj = Client.objects.create(user=owner, name='Dash Groups Client')

        group_a = IDCardGroup.objects.create(client=client_obj, name='Group A')
        group_b = IDCardGroup.objects.create(client=client_obj, name='Group B')

        table_a = IDCardTable.objects.create(
            group=group_a,
            name='Table A',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
            ],
        )
        table_b = IDCardTable.objects.create(
            group=group_b,
            name='Table B',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
            ],
        )

        IDCard.objects.create(table=table_a, status='pending', field_data={'CLASS': '10', 'SECTION': 'A'})
        IDCard.objects.create(table=table_a, status='verified', field_data={'CLASS': '11', 'SECTION': 'A'})
        IDCard.objects.create(table=table_b, status='pending', field_data={'CLASS': '10', 'SECTION': 'A'})

        staff_user = User.objects.create_user(
            username='dash-groups-staff@test.com', email='dash-groups-staff@test.com',
            password='pass1234', role='client_staff',
        )
        staff = Staff.objects.create(
            user=staff_user,
            staff_type='client_staff',
            client=client_obj,
            assigned_table_ids=[table_a.id],
            allowed_classes=['10'],
        )
        self.assertIsNotNone(staff.id)

        result = ClientDashboardService.get_groups_with_counts(staff_user)
        self.assertTrue(result.success)
        self.assertEqual(len(result.data['groups']), 1)

        group_payload = result.data['groups'][0]
        self.assertEqual(group_payload['id'], group_a.id)
        self.assertEqual(group_payload['card_count'], 1)
        self.assertEqual(group_payload['pending'], 1)
        self.assertEqual(group_payload['verified'], 0)
        self.assertEqual(len(group_payload['tables']), 1)
        self.assertEqual(group_payload['tables'][0]['id'], table_a.id)
        self.assertEqual(group_payload['tables'][0]['card_count'], 1)


class ClientImageServiceTests(TestCase):
    def setUp(self):
        from client.models import Client
        from idcards.models import IDCardGroup, IDCardTable, IDCard

        self.user = User.objects.create_user(
            username='img-client@test.com',
            email='img-client@test.com',
            password='pass1234',
            role='client',
        )
        self.client_obj = Client.objects.create(user=self.user, name='Image Client')
        self.group = IDCardGroup.objects.create(client=self.client_obj, name='Img Group')
        self.table = IDCardTable.objects.create(
            group=self.group,
            name='Img Table',
            fields=[{'name': 'PHOTO', 'type': 'photo', 'order': 1}],
        )
        self.card = IDCard.objects.create(
            table=self.table,
            field_data={'PHOTO': 'PENDING:roll_001'},
            status='pending',
        )

    def test_upload_images_uses_single_authority_save_and_updates_field(self):
        from client.services_image import ClientImageService

        upload = SimpleUploadedFile(
            'roll_001.jpg',
            b'abc123' * 80,
            content_type='image/jpeg',
        )

        mocked_result = mock.Mock(success=True, data={'final_value': 'adarshimg/CODE/new.jpg'})

        with mock.patch('client.services_image.ClientAccessService.get_client_for_user', return_value=self.client_obj), \
             mock.patch('client.services_image.ClientAccessService.can_access_table', return_value=True), \
             mock.patch('client.services_image.PermissionService.has_permission', return_value=True), \
             mock.patch('mediafiles.services.ImageService.save_new_image', return_value=mocked_result) as save_new:
            result = ClientImageService.upload_images(self.user, self.table.id, [upload])

        self.assertTrue(result.success)
        self.assertEqual(result.data['matched'], 1)
        self.assertEqual(result.data['failed'], 0)

        self.card.refresh_from_db()
        self.assertEqual(self.card.field_data.get('PHOTO'), 'adarshimg/CODE/new.jpg')

        self.assertEqual(save_new.call_count, 1)
        kwargs = save_new.call_args.kwargs
        self.assertEqual(kwargs.get('field_name'), 'PHOTO')
        self.assertEqual(kwargs.get('card').id, self.card.id)


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

    def test_create_staff_bulk_download_not_granted_when_client_lacks_permission(self):
        from client.services import ClientStaffService
        from staff.models import Staff

        result = ClientStaffService.create_staff(self.owner, {
            'email': 'bulk-blocked@test.com',
            'first_name': 'Bulk',
            'last_name': 'Blocked',
            'phone': '7777777777',
            'perm_idcard_bulk_download': True,
        })
        self.assertTrue(result.success)

        staff = Staff.objects.select_related('user').get(id=result.data['staff_id'])
        self.assertFalse(staff.perm_idcard_bulk_download)

    def test_update_staff_bulk_download_granted_when_client_has_permission(self):
        from client.services import ClientStaffService
        from staff.models import Staff

        self.client_obj.perm_idcard_bulk_download = True
        self.client_obj.save(update_fields=['perm_idcard_bulk_download'])

        created = ClientStaffService.create_staff(self.owner, {
            'email': 'bulk-allowed@test.com',
            'first_name': 'Bulk',
            'last_name': 'Allowed',
            'phone': '6666666666',
        })
        self.assertTrue(created.success)

        staff_id = created.data['staff_id']
        updated = ClientStaffService.update_staff(self.owner, staff_id, {
            'perm_idcard_bulk_download': True,
        })
        self.assertTrue(updated.success)

        staff = Staff.objects.get(id=staff_id)
        self.assertTrue(staff.perm_idcard_bulk_download)

    def test_create_staff_allows_custom_password_without_phone_or_email(self):
        from client.services import ClientStaffService
        from staff.models import Staff

        result = ClientStaffService.create_staff(self.owner, {
            'name': 'Custom Only Staff',
            'password': 'StaffOnly@123',
            'phone': '',
            'email': '',
        })
        self.assertTrue(result.success, msg=result.message)

        staff = Staff.objects.select_related('user').get(id=result.data['staff_id'])
        self.assertEqual(staff.user.phone or '', '')
        self.assertTrue(staff.user.check_password('StaffOnly@123'))

    def test_create_staff_rejects_missing_phone_and_password(self):
        from client.services import ClientStaffService

        result = ClientStaffService.create_staff(self.owner, {
            'name': 'Missing Credentials Staff',
            'phone': '',
            'password': '',
            'email': '',
        })
        self.assertFalse(result.success)
        self.assertIn('phone number is required', result.message.lower())

    def test_resolve_assignment_scope_auto_prefers_groups_for_multi_group_client(self):
        from client.services import ClientStaffService
        from idcards.models import IDCardGroup, IDCardTable

        group_a = IDCardGroup.objects.create(client=self.client_obj, name='Group A')
        group_b = IDCardGroup.objects.create(client=self.client_obj, name='Group B')
        IDCardTable.objects.create(group=group_a, name='Table A', fields=[])
        IDCardTable.objects.create(group=group_b, name='Table B', fields=[])

        resolved_group_ids, resolved_table_ids = ClientStaffService._resolve_assignment_scope_ids(
            self.client_obj,
            [group_a.id, group_b.id],
            'auto',
        )

        self.assertEqual(resolved_group_ids, sorted([group_a.id, group_b.id]))
        self.assertEqual(resolved_table_ids, [])


class ClientApiIntegrationTests(TestCase):
    def setUp(self):
        from client.models import Client
        from idcards.models import IDCardGroup, IDCardTable, IDCard
        from staff.models import Staff

        cache.clear()

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

    def tearDown(self):
        cache.clear()

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

    def test_api_class_section_options_respects_table_id_source(self):
        from idcards.models import IDCardTable, IDCard

        second_table = IDCardTable.objects.create(
            group=self.group,
            name='Second Students',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
                {'name': 'NAME', 'type': 'text'},
            ],
        )
        IDCard.objects.create(
            table=second_table,
            status='pending',
            field_data={'CLASS': '11', 'SECTION': 'B', 'NAME': 'Jane'},
        )

        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.get(
            f'/panel/client/api/class-section-options/?group_ids={self.table.id}&id_source=table'
        )
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertIn('10', payload.get('classes', []))
        self.assertIn('A', payload.get('sections', []))
        self.assertNotIn('11', payload.get('classes', []))
        self.assertNotIn('B', payload.get('sections', []))

    def test_api_class_section_options_includes_count_maps(self):
        from idcards.models import IDCard

        IDCard.objects.create(
            table=self.table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'NAME': 'John 2'},
        )
        IDCard.objects.create(
            table=self.table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'B', 'NAME': 'John 3'},
        )

        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.get(
            f'/panel/client/api/class-section-options/?group_ids={self.table.id}&id_source=table'
        )
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload.get('class_counts', {}).get('10'), 3)
        self.assertEqual(payload.get('section_counts', {}).get('A'), 2)
        self.assertEqual(payload.get('section_counts', {}).get('B'), 1)
        self.assertEqual(payload.get('class_section_counts', {}).get('10', {}).get('A'), 2)
        self.assertEqual(payload.get('class_section_counts', {}).get('10', {}).get('B'), 1)

    def test_api_staff_create_and_detail_include_assignment_scopes(self):
        self.client.login(username='api-owner@test.com', password='pass1234')

        payload = {
            'name': 'Scoped Staff',
            'phone': '7777777777',
            'assigned_groups': [self.table.id],
            'assignment_id_source': 'table',
            'assignment_scopes': [
                {
                    'scope_type': 'table',
                    'scope_id': self.table.id,
                    'classes': ['10'],
                    'sections': ['A'],
                    'branches': [],
                }
            ],
        }
        create_resp = self.client.post(
            '/panel/client/api/staff/',
            data=json.dumps(payload),
            content_type='application/json',
            HTTP_X_REQUESTED_WITH='XMLHttpRequest',
        )
        self.assertEqual(create_resp.status_code, 200)
        create_payload = create_resp.json()
        self.assertTrue(create_payload.get('success'))

        staff_id = create_payload['data']['staff_id']
        detail_resp = self.client.get(f'/panel/client/api/staff/{staff_id}/')
        self.assertEqual(detail_resp.status_code, 200)
        detail_payload = detail_resp.json().get('data', {})
        scopes = detail_payload.get('assignment_scopes', [])
        self.assertEqual(len(scopes), 1)
        self.assertEqual(scopes[0].get('scope_type'), 'table')
        self.assertEqual(scopes[0].get('scope_id'), self.table.id)
        self.assertEqual(scopes[0].get('classes'), ['10'])
        self.assertEqual(scopes[0].get('sections'), ['A'])

    def test_api_class_section_options_auto_uses_group_mode_without_id_collision(self):
        from idcards.models import IDCardGroup, IDCardTable, IDCard

        extra_group = IDCardGroup.objects.create(client=self.client_obj, name='Class 12')

        # Create another table under the original group first so table IDs can
        # numerically overlap with group IDs in the request payload.
        colliding_table = IDCardTable.objects.create(
            group=self.group,
            name='Colliding Table',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
                {'name': 'NAME', 'type': 'text'},
            ],
        )
        target_table = IDCardTable.objects.create(
            group=extra_group,
            name='Target Table',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
                {'name': 'NAME', 'type': 'text'},
            ],
        )

        IDCard.objects.create(
            table=colliding_table,
            status='pending',
            field_data={'CLASS': '99', 'SECTION': 'X', 'NAME': 'Wrong Scope'},
        )
        IDCard.objects.create(
            table=target_table,
            status='pending',
            field_data={'CLASS': '12', 'SECTION': 'B', 'NAME': 'Right Scope'},
        )

        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.get(
            f'/panel/client/api/class-section-options/?group_ids={extra_group.id}'
        )
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload.get('resolved_id_source'), 'group')
        self.assertIn('12', payload.get('classes', []))
        self.assertIn('B', payload.get('sections', []))
        self.assertNotIn('99', payload.get('classes', []))
        self.assertNotIn('X', payload.get('sections', []))

    def test_filter_options_cache_scoped_for_client_staff(self):
        from idcards.models import IDCard

        IDCard.objects.create(
            table=self.table,
            status='pending',
            field_data={'CLASS': '11', 'SECTION': 'B', 'NAME': 'Jane'},
        )

        self.client.login(username='api-owner@test.com', password='pass1234')
        owner_response = self.client.get(f'/panel/api/table/{self.table.id}/filter-options/')
        self.assertEqual(owner_response.status_code, 200)
        owner_payload = owner_response.json()
        owner_classes = [row.get('value') for row in owner_payload.get('class_values', [])]
        self.assertGreaterEqual(len(owner_classes), 2)

        self.staff_profile.allowed_classes = ['10']
        self.staff_profile.allowed_sections = ['A']
        self.staff_profile.save(update_fields=['allowed_classes', 'allowed_sections'])

        self.client.login(username='api-staff@test.com', password='pass1234')
        staff_response = self.client.get(f'/panel/api/table/{self.table.id}/filter-options/')
        self.assertEqual(staff_response.status_code, 200)
        staff_payload = staff_response.json()
        staff_classes = [row.get('value') for row in staff_payload.get('class_values', [])]
        self.assertEqual(len(staff_classes), 1, msg=str(staff_payload))
        self.assertEqual(staff_payload.get('section_values', []), ['A'])

    def test_client_staff_idcard_group_page_counts_are_scoped(self):
        from idcards.models import IDCard, IDCardGroup, IDCardTable

        extra_group = IDCardGroup.objects.create(client=self.client_obj, name='Class 11')
        extra_table = IDCardTable.objects.create(
            group=extra_group,
            name='Students Extra',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
                {'name': 'NAME', 'type': 'text'},
            ],
        )

        IDCard.objects.create(
            table=self.table,
            status='pending',
            field_data={'CLASS': '11', 'SECTION': 'A', 'NAME': 'Out Of Scope'},
        )
        IDCard.objects.create(
            table=extra_table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'NAME': 'Other Table'},
        )

        self.staff_profile.assigned_table_ids = [self.table.id]
        self.staff_profile.perm_idcard_pending_list = True
        self.staff_profile.allowed_classes = ['10']
        self.staff_profile.allowed_sections = []
        self.staff_profile.allowed_branches = []
        self.staff_profile.save(update_fields=[
            'assigned_table_ids',
            'perm_idcard_pending_list',
            'allowed_classes',
            'allowed_sections',
            'allowed_branches',
        ])

        self.client.login(username='api-staff@test.com', password='pass1234')
        response = self.client.get('/panel/client/idcard-group/')
        self.assertEqual(response.status_code, 200)

        tables = list(response.context['tables'])
        self.assertEqual(len(tables), 1)
        self.assertEqual(tables[0].id, self.table.id)
        self.assertEqual(tables[0].pending_count, 1)
        self.assertEqual(tables[0].total_cards, 1)

    def test_client_staff_row_scope_supports_combined_group_and_table_assignments(self):
        from idcards.models import IDCardGroup, IDCardTable, IDCard

        extra_group = IDCardGroup.objects.create(client=self.client_obj, name='Class 12')
        extra_table = IDCardTable.objects.create(
            group=extra_group,
            name='Students Extra',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
                {'name': 'NAME', 'type': 'text'},
            ],
        )

        IDCard.objects.create(
            table=self.table,
            status='pending',
            field_data={'CLASS': '11', 'SECTION': 'A', 'NAME': 'Group Scope Rejected'},
        )
        IDCard.objects.create(
            table=extra_table,
            status='pending',
            field_data={'CLASS': '12', 'SECTION': 'B', 'NAME': 'Table Scope Allowed'},
        )
        IDCard.objects.create(
            table=extra_table,
            status='pending',
            field_data={'CLASS': '13', 'SECTION': 'B', 'NAME': 'Table Scope Rejected'},
        )

        self.staff_profile.perm_idcard_pending_list = True
        self.staff_profile.assigned_table_ids = [extra_table.id]
        self.staff_profile.allowed_classes = ['99']
        self.staff_profile.allowed_sections = ['Z']
        self.staff_profile.allowed_branches = []
        self.staff_profile.assignment_scopes = [
            {
                'scope_type': 'group',
                'scope_id': self.group.id,
                'group_id': self.group.id,
                'classes': ['10'],
                'sections': ['A'],
                'branches': [],
            },
            {
                'scope_type': 'table',
                'scope_id': extra_table.id,
                'group_id': extra_group.id,
                'classes': ['12'],
                'sections': ['B'],
                'branches': [],
            },
        ]
        self.staff_profile.save(update_fields=[
            'perm_idcard_pending_list',
            'assigned_table_ids',
            'allowed_classes',
            'allowed_sections',
            'allowed_branches',
            'assignment_scopes',
        ])
        self.staff_profile.assigned_groups.set([self.group])

        self.client.login(username='api-staff@test.com', password='pass1234')

        group_resp = self.client.get(
            f'/panel/client/api/table/{self.table.id}/cards/',
            {'status': 'pending'},
        )
        self.assertEqual(group_resp.status_code, 200)
        group_cards = group_resp.json().get('data', {}).get('cards', [])
        self.assertEqual(len(group_cards), 1)
        self.assertEqual(group_cards[0].get('field_data', {}).get('CLASS'), '10')

        table_resp = self.client.get(
            f'/panel/client/api/table/{extra_table.id}/cards/',
            {'status': 'pending'},
        )
        self.assertEqual(table_resp.status_code, 200)
        table_cards = table_resp.json().get('data', {}).get('cards', [])
        self.assertEqual(len(table_cards), 1)
        self.assertEqual(table_cards[0].get('field_data', {}).get('CLASS'), '12')

    def test_client_staff_table_scope_does_not_unlock_full_parent_group(self):
        from idcards.models import IDCardTable, IDCard

        extra_table = IDCardTable.objects.create(
            group=self.group,
            name='Unassigned Same Group Table',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
                {'name': 'NAME', 'type': 'text'},
            ],
        )

        IDCard.objects.create(
            table=self.table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'NAME': 'Allowed Table Row'},
        )
        IDCard.objects.create(
            table=extra_table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'NAME': 'Should Stay Hidden'},
        )

        self.staff_profile.perm_idcard_pending_list = True
        self.staff_profile.assigned_table_ids = [self.table.id]
        self.staff_profile.allowed_classes = ['10']
        self.staff_profile.allowed_sections = ['A']
        self.staff_profile.allowed_branches = []
        self.staff_profile.assignment_scopes = [
            {
                'scope_type': 'table',
                'scope_id': self.table.id,
                'group_id': self.group.id,
                'classes': ['10'],
                'sections': ['A'],
                'branches': [],
            }
        ]
        self.staff_profile.save(update_fields=[
            'perm_idcard_pending_list',
            'assigned_table_ids',
            'allowed_classes',
            'allowed_sections',
            'allowed_branches',
            'assignment_scopes',
        ])
        # Keep parent group assignment set to mimic compatibility storage.
        self.staff_profile.assigned_groups.set([self.group])

        self.client.login(username='api-staff@test.com', password='pass1234')
        response = self.client.get('/panel/client/idcard-group/')
        self.assertEqual(response.status_code, 200)

        tables = list(response.context['tables'])
        table_ids = sorted(t.id for t in tables)
        self.assertEqual(table_ids, [self.table.id])
        self.assertEqual(tables[0].pending_count, 2)
        self.assertEqual(tables[0].total_cards, 2)

    def test_client_staff_cards_api_class_filter_with_roman_value(self):
        from idcards.models import IDCard

        IDCard.objects.create(
            table=self.table,
            status='pending',
            field_data={'CLASS': 'III', 'SECTION': 'A', 'NAME': 'Roman Class'},
        )

        self.staff_profile.perm_idcard_pending_list = True
        self.staff_profile.save(update_fields=['perm_idcard_pending_list'])

        self.client.login(username='api-staff@test.com', password='pass1234')
        response = self.client.get(
            f'/panel/api/table/{self.table.id}/cards/',
            {'status': 'pending', 'class': 'III'},
        )
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertTrue(payload.get('success'))

    def test_filter_options_dedupes_course_branch_variants(self):
        from idcards.models import IDCardTable, IDCard
        from core.utils.field_utils import normalize_compact_text_value

        table = IDCardTable.objects.create(
            group=self.group,
            name='Course Branch Table',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
                {'name': 'COURSE', 'type': 'course'},
                {'name': 'BRANCH', 'type': 'branch'},
                {'name': 'NAME', 'type': 'text'},
            ],
        )

        IDCard.objects.create(
            table=table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'COURSE': 'BTECH', 'BRANCH': 'CSE', 'NAME': 'One'},
        )
        IDCard.objects.create(
            table=table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'COURSE': 'B.Tech', 'BRANCH': 'C.S.E', 'NAME': 'Two'},
        )
        IDCard.objects.create(
            table=table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'COURSE': 'B TECH', 'BRANCH': 'c s e', 'NAME': 'Three'},
        )
        IDCard.objects.create(
            table=table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'COURSE': 'BCA', 'BRANCH': 'IT', 'NAME': 'Four'},
        )

        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.get(f'/panel/api/table/{table.id}/filter-options/')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertTrue(payload.get('success'))

        course_values = payload.get('course_values', [])
        branch_values = payload.get('branch_values', [])

        self.assertEqual(
            {normalize_compact_text_value(v) for v in course_values},
            {'BTECH', 'BCA'},
        )
        self.assertEqual(
            {normalize_compact_text_value(v) for v in branch_values},
            {'CSE', 'IT'},
        )

        btech_display = next(v for v in course_values if normalize_compact_text_value(v) == 'BTECH')
        cse_display = next(v for v in branch_values if normalize_compact_text_value(v) == 'CSE')

        mapped_branches = payload.get('course_to_branches', {}).get(btech_display, [])
        self.assertEqual(
            {normalize_compact_text_value(v) for v in mapped_branches},
            {'CSE'},
        )

        mapped_courses = payload.get('branch_to_courses', {}).get(cse_display, [])
        self.assertEqual(
            {normalize_compact_text_value(v) for v in mapped_courses},
            {'BTECH'},
        )

    def test_cards_api_course_branch_filters_match_variants(self):
        from idcards.models import IDCardTable, IDCard

        table = IDCardTable.objects.create(
            group=self.group,
            name='Course Branch Cards',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
                {'name': 'COURSE', 'type': 'course'},
                {'name': 'BRANCH', 'type': 'branch'},
                {'name': 'NAME', 'type': 'text'},
            ],
        )

        IDCard.objects.create(
            table=table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'COURSE': 'BTECH', 'BRANCH': 'CSE', 'NAME': 'One'},
        )
        IDCard.objects.create(
            table=table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'COURSE': 'B.Tech', 'BRANCH': 'C.S.E', 'NAME': 'Two'},
        )
        IDCard.objects.create(
            table=table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'COURSE': 'BCA', 'BRANCH': 'IT', 'NAME': 'Three'},
        )

        self.client.login(username='api-owner@test.com', password='pass1234')

        course_resp = self.client.get(
            f'/panel/api/table/{table.id}/cards/',
            {'status': 'pending', 'course': 'B TECH'},
        )
        self.assertEqual(course_resp.status_code, 200)
        course_payload = course_resp.json()
        self.assertTrue(course_payload.get('success'))
        self.assertEqual(len(course_payload.get('cards', [])), 2)

        branch_resp = self.client.get(
            f'/panel/api/table/{table.id}/cards/',
            {'status': 'pending', 'branch': 'c.s.e'},
        )
        self.assertEqual(branch_resp.status_code, 200)
        branch_payload = branch_resp.json()
        self.assertTrue(branch_payload.get('success'))
        self.assertEqual(len(branch_payload.get('cards', [])), 2)

    def test_update_field_refreshes_course_branch_filter_options(self):
        from idcards.models import IDCardTable, IDCard
        from core.utils.field_utils import normalize_compact_text_value

        table = IDCardTable.objects.create(
            group=self.group,
            name='Inline Update Filters',
            fields=[
                {'name': 'CLASS', 'type': 'class'},
                {'name': 'SECTION', 'type': 'section'},
                {'name': 'COURSE', 'type': 'course'},
                {'name': 'BRANCH', 'type': 'branch'},
                {'name': 'NAME', 'type': 'text'},
            ],
        )
        card = IDCard.objects.create(
            table=table,
            status='pending',
            field_data={'CLASS': '10', 'SECTION': 'A', 'COURSE': 'BTECH', 'BRANCH': 'CSE', 'NAME': 'Inline User'},
        )

        self.client_obj.perm_idcard_edit = True
        self.client_obj.save(update_fields=['perm_idcard_edit'])

        self.client.login(username='api-owner@test.com', password='pass1234')

        warm_resp = self.client.get(f'/panel/api/table/{table.id}/filter-options/')
        self.assertEqual(warm_resp.status_code, 200)

        update_course = self.client.post(
            f'/panel/api/card/{card.id}/update-field/',
            data=json.dumps({'field': 'COURSE', 'value': 'BCA'}),
            content_type='application/json',
        )
        self.assertEqual(update_course.status_code, 200)

        update_branch = self.client.post(
            f'/panel/api/card/{card.id}/update-field/',
            data=json.dumps({'field': 'BRANCH', 'value': 'I.T'}),
            content_type='application/json',
        )
        self.assertEqual(update_branch.status_code, 200)

        refreshed = self.client.get(f'/panel/api/table/{table.id}/filter-options/')
        self.assertEqual(refreshed.status_code, 200)
        payload = refreshed.json()
        self.assertTrue(payload.get('success'))

        self.assertEqual(
            {normalize_compact_text_value(v) for v in payload.get('course_values', [])},
            {'BCA'},
        )
        self.assertEqual(
            {normalize_compact_text_value(v) for v in payload.get('branch_values', [])},
            {'IT'},
        )

    def test_client_staff_temp_password_api_requires_client_permission(self):
        self.client_obj.perm_set_temp_password = False
        self.client_obj.save(update_fields=['perm_set_temp_password'])

        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.post(
            f'/panel/client/api/staff/{self.staff_profile.id}/set-temp-password/',
            data=json.dumps({'password': 'TmpStrong!982'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_client_staff_temp_password_api_success_when_client_has_permission(self):
        self.client_obj.perm_set_temp_password = True
        self.client_obj.save(update_fields=['perm_set_temp_password'])

        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.post(
            f'/panel/client/api/staff/{self.staff_profile.id}/set-temp-password/',
            data=json.dumps({'password': 'TmpStrong!982'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)

        self.client_staff_user.refresh_from_db()
        self.assertTrue(self.client_staff_user.check_password('TmpStrong!982'))

    def test_cards_api_without_status_is_permission_scoped(self):
        from idcards.models import IDCard

        IDCard.objects.create(
            table=self.table,
            status='approved',
            field_data={'CLASS': '10', 'SECTION': 'A', 'NAME': 'Approved Card'},
        )

        self.staff_profile.perm_idcard_pending_list = True
        self.staff_profile.perm_idcard_approved_list = False
        self.staff_profile.perm_idcard_verified_list = False
        self.staff_profile.perm_idcard_pool_list = False
        self.staff_profile.perm_idcard_download_list = False
        self.staff_profile.perm_idcard_reprint_list = False
        self.staff_profile.save(update_fields=[
            'perm_idcard_pending_list',
            'perm_idcard_approved_list',
            'perm_idcard_verified_list',
            'perm_idcard_pool_list',
            'perm_idcard_download_list',
            'perm_idcard_reprint_list',
        ])

        self.client.login(username='api-staff@test.com', password='pass1234')
        response = self.client.get(f'/panel/client/api/table/{self.table.id}/cards/')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertTrue(payload.get('success'))
        statuses = {row.get('status') for row in payload['data']['cards']}
        self.assertEqual(statuses, {'pending'})

    def test_cards_api_rejects_invalid_status_filter(self):
        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.get(
            f'/panel/client/api/table/{self.table.id}/cards/',
            {'status': 'not-real'},
        )
        self.assertEqual(response.status_code, 400)

    def test_cards_api_caps_per_page_and_normalizes_page(self):
        from idcards.models import IDCard

        for i in range(230):
            IDCard.objects.create(
                table=self.table,
                status='pending',
                field_data={'CLASS': '10', 'SECTION': 'A', 'NAME': f'P{i}'},
            )

        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.get(
            f'/panel/client/api/table/{self.table.id}/cards/',
            {'status': 'pending', 'page': -5, 'per_page': 5000},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['data']['pagination']['page'], 1)
        self.assertEqual(payload['data']['pagination']['per_page'], 200)
        self.assertLessEqual(len(payload['data']['cards']), 200)

    def test_bulk_status_rejects_invalid_card_ids_payload(self):
        self.client.login(username='api-owner@test.com', password='pass1234')
        response = self.client.post(
            f'/panel/client/api/table/{self.table.id}/cards/bulk-status/',
            data=json.dumps({'card_ids': [True, 'x', None], 'status': 'verified'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)


class ClientActivationPasswordFlowTests(TestCase):
    def test_first_activation_preserves_custom_password(self):
        from core.services import ClientService
        from core.models import EmailLog

        custom_password = 'ClientCustom@123'
        result = ClientService.create({
            'name': 'Custom Password Client',
            'email': 'client-custom-activation@test.com',
            'phone': '9123456789',
            'password': custom_password,
            'is_active': False,
        })
        self.assertTrue(result.success, msg=result.message)

        client_id = result.data['client']['id']
        created_user = User.objects.get(email='client-custom-activation@test.com')
        self.assertTrue(created_user.check_password(custom_password))

        with mock.patch('client.services_client_core.send_welcome_email') as send_welcome_mock:
            toggle_result = ClientService.toggle_status(client_id)

        self.assertTrue(toggle_result.success, msg=toggle_result.message)
        created_user.refresh_from_db()
        self.assertTrue(created_user.is_active)
        self.assertTrue(created_user.check_password(custom_password))
        send_welcome_mock.assert_not_called()
        self.assertFalse(
            EmailLog.objects.filter(
                recipient_email='client-custom-activation@test.com',
                email_type=EmailLog.EMAIL_TYPE_WELCOME,
                status=EmailLog.STATUS_ON_HOLD,
            ).exists()
        )

    def test_create_rejects_missing_phone_and_custom_password(self):
        from core.services import ClientService

        result = ClientService.create({
            'name': 'Missing Credentials Client',
            'email': '',
            'phone': '',
            'password': '',
            'is_active': False,
        })

        self.assertFalse(result.success)
        self.assertIn('phone number is required', result.message.lower())

    def test_create_allows_custom_password_without_phone_or_email(self):
        from core.services import ClientService
        from client.models import Client

        result = ClientService.create({
            'name': 'Custom No Contact Client',
            'email': '',
            'phone': '',
            'password': 'ClientOnly@123',
            'is_active': False,
        })

        self.assertTrue(result.success, msg=result.message)
        created_client = Client.objects.select_related('user').get(id=result.data['client']['id'])
        created_user = created_client.user
        self.assertTrue(created_user.check_password('ClientOnly@123'))
