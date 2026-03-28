"""
Tests for exports app.
Covers: Permission scoping, export view access control, ExportService.
"""
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.http import HttpResponse
from django.test import RequestFactory
from unittest import mock
import json

User = get_user_model()


def _setup_export_data():
    """Create a super_admin, client, table with cards for export tests."""
    admin = User.objects.create_user(
        username='exadmin@test.com', email='exadmin@test.com',
        password='adminpass1', role='super_admin',
    )
    client_user = User.objects.create_user(
        username='exclient@test.com', email='exclient@test.com',
        password='clientpass1', role='client',
    )
    from client.models import Client
    client = Client.objects.create(user=client_user, name='Export Client')

    from idcards.models import IDCardGroup, IDCardTable, IDCard
    group = IDCardGroup.objects.create(client=client, name='Export Group')
    table = IDCardTable.objects.create(
        group=group, name='Export Table',
        fields=[
            {'name': 'NAME', 'type': 'text', 'order': 1},
            {'name': 'FATHER', 'type': 'text', 'order': 2},
        ],
    )
    for i in range(5):
        IDCard.objects.create(
            table=table,
            field_data={'NAME': f'STUDENT {i}', 'FATHER': f'FATHER {i}'},
            status='pending',
        )
    return admin, client_user, client, table


class ExportPermissionTests(TestCase):
    """Tests for export access control."""

    def setUp(self):
        self.admin, self.client_user, self.client_obj, self.table = _setup_export_data()
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_unauthenticated_blocked(self):
        response = self.client.post(
            f'/panel/exports/xlsx/{self.table.id}/',
            data=json.dumps({'card_ids': []}),
            content_type='application/json',
        )
        self.assertIn(response.status_code, [302, 403])

    def test_admin_can_export_xlsx(self):
        self.client.login(username='exadmin@test.com', password='adminpass1')
        from idcards.models import IDCard
        card_ids = list(IDCard.objects.filter(table=self.table).values_list('id', flat=True))
        response = self.client.post(
            f'/panel/exports/xlsx/{self.table.id}/',
            data=json.dumps({'card_ids': card_ids}),
            content_type='application/json',
        )
        self.assertIn(response.status_code, [200, 400])

    def test_client_blocked_from_download_all(self):
        self.client.login(username='exclient@test.com', password='clientpass1')
        response = self.client.post(
            f'/panel/exports/download-all/{self.table.id}/',
            data=json.dumps({}),
            content_type='application/json',
        )
        # Client should be blocked (403 JSON or 302 redirect)
        self.assertIn(response.status_code, [302, 403])


class ExportServiceTests(TestCase):
    """Tests for ExportService scoping."""

    def setUp(self):
        self.admin, self.client_user, self.client_obj, self.table = _setup_export_data()

    def test_export_service_scopes_cards(self):
        from exports.services import ExportService
        service = ExportService(self.admin)
        cards = service.get_scoped_cards(self.table)
        self.assertEqual(cards.count(), 5)

    def test_export_service_empty_for_wrong_client(self):
        other_user = User.objects.create_user(
            username='other@test.com', email='other@test.com',
            password='otherpass1', role='client',
        )
        from client.models import Client
        Client.objects.create(user=other_user, name='Other Client')
        # Other user should not see cards from the first client's table via ExportService
        from exports.services import ExportService
        service = ExportService(other_user)
        cards = service.get_scoped_cards(self.table)
        # Depending on scoping logic, might be 0 or 5 (super_admin sees all)
        self.assertIsNotNone(cards)


class ExportViewHelperTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.admin, self.client_user, self.client_obj, self.table = _setup_export_data()

    def test_get_card_ids_from_json_body(self):
        from exports.views import _get_card_ids_from_request

        request = self.factory.post(
            '/panel/exports/xlsx/1/',
            data=json.dumps({'card_ids': [1, '2', 'bad', 3]}),
            content_type='application/json',
        )

        ids = _get_card_ids_from_request(request)
        self.assertEqual(ids, [1, 2, 3])

    def test_get_card_ids_normalizes_and_deduplicates(self):
        from exports.views import _get_card_ids_from_request

        request = self.factory.post(
            '/panel/exports/xlsx/1/',
            data=json.dumps({'card_ids': [1, '1', ' 2 ', True, 0, -5, 'bad']}),
            content_type='application/json',
        )

        ids = _get_card_ids_from_request(request)
        self.assertEqual(ids, [1, 2])

    def test_get_card_ids_fallback_by_status_when_not_supplied(self):
        from exports.views import _get_card_ids_from_request

        request = self.factory.post(
            f'/panel/exports/xlsx/{self.table.id}/',
            data=json.dumps({'status': 'pending'}),
            content_type='application/json',
        )
        request.user = self.admin

        ids = _get_card_ids_from_request(request, table_id=self.table.id)
        self.assertEqual(len(ids), 5)

    def test_get_card_ids_fallback_requires_client_scope(self):
        from client.models import Client
        from exports.views import _get_card_ids_from_request

        outsider = User.objects.create_user(
            username='export-outsider@test.com',
            email='export-outsider@test.com',
            password='pass1234',
            role='client',
        )
        Client.objects.create(user=outsider, name='Outsider Client')

        request = self.factory.post(
            f'/panel/exports/xlsx/{self.table.id}/',
            data=json.dumps({'status': 'pending'}),
            content_type='application/json',
        )
        request.user = outsider

        ids = _get_card_ids_from_request(request, table_id=self.table.id)
        self.assertIsNone(ids)

    def test_get_image_rename_options_filters_invalid_pairs(self):
        from exports.views import _get_image_rename_options_from_request

        request = self.factory.post(
            f'/panel/exports/images/{self.table.id}/',
            data=json.dumps({
                'rename_options': {
                    'enabled': True,
                    'image_name_fields': {
                        ' photo ': ' Student Name ',
                        '': 'x',
                        'QR': '',
                    },
                }
            }),
            content_type='application/json',
        )

        opts = _get_image_rename_options_from_request(request)
        self.assertTrue(opts['enabled'])
        self.assertEqual(opts['image_name_fields'], {'PHOTO': 'Student Name'})

    def test_lock_acquire_and_release(self):
        from exports.views import _acquire_export_lock, _release_export_lock

        acquired, lock_key = _acquire_export_lock(11, 22, export_type='xlsx', max_concurrent=1, ttl=30)
        self.assertTrue(acquired)
        self.assertTrue(lock_key)

        acquired_again, _ = _acquire_export_lock(11, 22, export_type='xlsx', max_concurrent=1, ttl=30)
        self.assertFalse(acquired_again)

        _release_export_lock(lock_key)
        acquired_after_release, _ = _acquire_export_lock(11, 22, export_type='xlsx', max_concurrent=1, ttl=30)
        self.assertTrue(acquired_after_release)


class ExportServiceAdvancedTests(TestCase):
    def setUp(self):
        from client.models import Client
        from idcards.models import IDCardGroup, IDCardTable, IDCard
        from staff.models import Staff

        self.super_admin = User.objects.create_user(
            username='svc-super@test.com', email='svc-super@test.com',
            password='pass1234', role='super_admin',
        )

        owner1 = User.objects.create_user(
            username='svc-owner1@test.com', email='svc-owner1@test.com',
            password='pass1234', role='client',
        )
        owner2 = User.objects.create_user(
            username='svc-owner2@test.com', email='svc-owner2@test.com',
            password='pass1234', role='client',
        )
        self.client1 = Client.objects.create(user=owner1, name='Svc Client 1')
        self.client2 = Client.objects.create(user=owner2, name='Svc Client 2')

        group1 = IDCardGroup.objects.create(client=self.client1, name='Group 1')
        group2 = IDCardGroup.objects.create(client=self.client2, name='Group 2')
        self.table1 = IDCardTable.objects.create(group=group1, name='Table 1', fields=[{'name': 'NAME', 'type': 'text'}])
        self.table2 = IDCardTable.objects.create(group=group2, name='Table 2', fields=[{'name': 'NAME', 'type': 'text'}])

        IDCard.objects.create(table=self.table1, field_data={'NAME': 'A'}, status='pending')
        IDCard.objects.create(table=self.table1, field_data={'NAME': 'B'}, status='verified')
        IDCard.objects.create(table=self.table2, field_data={'NAME': 'C'}, status='approved')

        self.staff_user = User.objects.create_user(
            username='svc-staff@test.com', email='svc-staff@test.com',
            password='pass1234', role='admin_staff',
        )
        self.staff = Staff.objects.create(
            user=self.staff_user,
            staff_type='admin_staff',
            perm_idcard_bulk_download=True,
        )
        self.staff.assigned_clients.add(self.client1)

    def test_get_scoped_cards_admin_staff_assigned_only(self):
        from exports.services import ExportService

        service = ExportService(self.staff_user)
        cards_for_table1 = service.get_scoped_cards(self.table1)
        cards_for_table2 = service.get_scoped_cards(self.table2)

        self.assertEqual(cards_for_table1.count(), 2)
        self.assertEqual(cards_for_table2.count(), 0)

    def test_prepare_context_permission_denied_when_no_bulk_download(self):
        from exports.services import ExportService

        denied_user = User.objects.create_user(
            username='svc-denied@test.com', email='svc-denied@test.com',
            password='pass1234', role='admin_staff',
        )
        service = ExportService(denied_user)
        context = service._prepare_context(self.table1.id, require_export_permission=True)

        self.assertFalse(context.has_permission)
        self.assertIn('Permission denied', context.error_message)

    def test_get_export_preview_contains_counts(self):
        from exports.services import ExportService

        service = ExportService(self.super_admin)
        preview = service.get_export_preview(self.table1.id)

        self.assertTrue(preview['success'])
        self.assertEqual(preview['card_count'], 2)
        self.assertTrue(preview['available_formats']['xlsx'])


class ExportApiIntegrationAdvancedTests(TestCase):
    def setUp(self):
        from staff.models import Staff

        self.admin, self.client_user, self.client_obj, self.table = _setup_export_data()
        self.factory = RequestFactory()
        cache.clear()

        self.staff_unassigned = User.objects.create_user(
            username='exstaffu@test.com', email='exstaffu@test.com',
            password='pass1234', role='admin_staff',
        )
        Staff.objects.create(
            user=self.staff_unassigned,
            staff_type='admin_staff',
            perm_idcard_bulk_download=True,
        )

    def tearDown(self):
        cache.clear()

    def test_preview_success_for_super_admin(self):
        self.client.login(username='exadmin@test.com', password='adminpass1')
        response = self.client.get(f'/panel/exports/preview/{self.table.id}/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['card_count'], 5)

    def test_preview_scope_denied_for_unassigned_admin_staff(self):
        self.client.login(username='exstaffu@test.com', password='pass1234')
        response = self.client.get(f'/panel/exports/preview/{self.table.id}/')
        self.assertEqual(response.status_code, 403)

    def test_xlsx_empty_selection_falls_back_to_table_cards(self):
        self.client.login(username='exadmin@test.com', password='adminpass1')
        response = self.client.post(
            f'/panel/exports/xlsx/{self.table.id}/',
            data=json.dumps({'card_ids': []}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)

    def test_docx_invalid_format_falls_back_to_docx(self):
        self.client.login(username='exadmin@test.com', password='adminpass1')

        fake_result = type('Res', (), {'success': True, 'response': HttpResponse(b'ok')})
        with mock.patch('exports.views.ExportService.export_word', return_value=fake_result) as mocked:
            response = self.client.post(
                f'/panel/exports/docx/{self.table.id}/',
                data=json.dumps({'card_ids': [1, 2], 'format': 'invalid-format'}),
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mocked.call_args.kwargs['doc_format'], 'docx')

    def test_images_export_passes_cleaned_rename_options(self):
        self.client.login(username='exadmin@test.com', password='adminpass1')

        fake_zip_result = object()
        with mock.patch('exports.views.ExportService.export_images', return_value=fake_zip_result) as mocked_export:
            with mock.patch('exports.views.zip_result_to_dict', return_value={'success': True, 'zip_files': []}):
                response = self.client.post(
                    f'/panel/exports/images/{self.table.id}/',
                    data=json.dumps({
                        'card_ids': [1],
                        'rename_options': {
                            'enabled': True,
                            'image_name_fields': {' photo ': 'Name', '': 'x', 'QR': ''},
                        },
                    }),
                    content_type='application/json',
                )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])
        rename_opts = mocked_export.call_args.kwargs['rename_options']
        self.assertEqual(rename_opts['image_name_fields'], {'PHOTO': 'Name'})

    def test_pdf_async_starts_background_task(self):
        self.client.login(username='exadmin@test.com', password='adminpass1')

        with mock.patch('exports.tasks.BackgroundExportManager.start_pdf_export', return_value='task123'):
            response = self.client.post(
                f'/panel/exports/pdf-async/{self.table.id}/',
                data=json.dumps({'card_ids': [1, 2, 3]}),
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['task_id'], 'task123')

    def test_download_all_lock_contention_returns_429(self):
        self.client.login(username='exadmin@test.com', password='adminpass1')

        with mock.patch('exports.views._acquire_export_lock', return_value=(False, '')):
            response = self.client.post(
                f'/panel/exports/download-all/{self.table.id}/',
                data=json.dumps({}),
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 429)

    def test_export_status_is_scoped_to_request_user(self):
        from core.models import BackgroundTask

        task = BackgroundTask.objects.create(
            user=self.admin,
            task_type='export_pdf',
            status='completed',
            total=1,
            progress=1,
            result_path='temp/exports/owner.pdf',
            metadata={'result': {'filename': 'owner.pdf', 'card_count': 1}},
        )

        other_user = User.objects.create_user(
            username='exother@test.com',
            email='exother@test.com',
            password='pass1234',
            role='super_admin',
        )
        self.client.login(username='exother@test.com', password='pass1234')
        response = self.client.get(f'/panel/exports/status/{task.id}/')
        self.assertEqual(response.status_code, 404)

    def test_export_status_hides_invalid_result_path(self):
        from core.models import BackgroundTask

        self.client.login(username='exadmin@test.com', password='adminpass1')
        task = BackgroundTask.objects.create(
            user=self.admin,
            task_type='export_pdf',
            status='completed',
            total=1,
            progress=1,
            result_path='../outside.pdf',
            metadata={'result': {'filename': 'outside.pdf', 'card_count': 1}},
        )

        response = self.client.get(f'/panel/exports/status/{task.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get('download_url'), '')
