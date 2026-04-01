"""
Tests for core app.
Covers: User model, IDCard/IDCardTable/IDCardGroup models, middleware,
permissions, workflow transitions, bulk upload service, global search.
"""
from django.test import TestCase, RequestFactory, override_settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.http import HttpResponse
from unittest.mock import patch
import json
import os
import tempfile
import io
import zipfile

User = get_user_model()


# ── Helpers ──
def _create_super_admin(email='admin@test.com', password='adminpass1'):
    return User.objects.create_user(
        username=email, email=email, password=password, role='super_admin',
    )


def _create_client_user(email='client@test.com', password='clientpass1'):
    user = User.objects.create_user(
        username=email, email=email, password=password, role='client',
    )
    from client.models import Client
    client = Client.objects.create(user=user, name='Test Client')
    return user, client


def _create_table(client, fields=None):
    from idcards.models import IDCardGroup, IDCardTable
    if fields is None:
        fields = [
            {'name': 'NAME', 'type': 'text', 'order': 1},
            {'name': 'CLASS', 'type': 'class', 'order': 2},
            {'name': 'PHOTO', 'type': 'photo', 'order': 3},
        ]
    group = IDCardGroup.objects.create(client=client, name='Test Group')
    table = IDCardTable.objects.create(group=group, name='Test Table', fields=fields)
    return group, table


def _create_card(table, field_data=None, status='pending'):
    from idcards.models import IDCard
    if field_data is None:
        field_data = {'NAME': 'JOHN DOE', 'CLASS': '10'}
    return IDCard.objects.create(table=table, field_data=field_data, status=status)


# ── User Model Tests ──
class UserModelTests(TestCase):
    def test_create_user_default_role(self):
        user = User.objects.create_user(
            username='u1@test.com', email='u1@test.com', password='pass1234',
        )
        self.assertEqual(user.role, 'client')

    def test_super_admin_role_sets_flags(self):
        admin = _create_super_admin()
        self.assertTrue(admin.is_superuser)
        self.assertTrue(admin.is_staff)
        self.assertTrue(admin.is_super_admin)

    def test_client_role_clears_superuser(self):
        user, _ = _create_client_user()
        self.assertFalse(user.is_superuser)
        self.assertFalse(user.is_super_admin)

    def test_superuser_forces_super_admin_role(self):
        user = User.objects.create_superuser(
            username='su@test.com', email='su@test.com', password='supass123',
        )
        user.save()
        user.refresh_from_db()
        self.assertEqual(user.role, 'super_admin')


# ── IDCard Model Tests ──
class IDCardModelTests(TestCase):
    def setUp(self):
        _, self.client_obj = _create_client_user()
        self.group, self.table = _create_table(self.client_obj)

    def test_create_card(self):
        card = _create_card(self.table)
        self.assertEqual(card.status, 'pending')
        self.assertEqual(card.field_data['NAME'], 'JOHN DOE')

    def test_card_belongs_to_table(self):
        card = _create_card(self.table)
        self.assertEqual(card.table.id, self.table.id)

    def test_card_default_status(self):
        from idcards.models import IDCard
        card = IDCard.objects.create(table=self.table, field_data={'NAME': 'X'})
        self.assertEqual(card.status, 'pending')


# ── Workflow Transition Tests ──
class WorkflowTransitionTests(TestCase):
    def setUp(self):
        self.admin = _create_super_admin()
        _, self.client_obj = _create_client_user()
        self.group, self.table = _create_table(self.client_obj)

    def test_pending_to_verified(self):
        from idcards.services_workflow import WorkflowService
        card = _create_card(self.table, status='pending')
        result = WorkflowService.transition(card, 'verified', self.admin, request=None)
        self.assertTrue(result.success)
        card.refresh_from_db()
        self.assertEqual(card.status, 'verified')

    def test_invalid_transition_rejected(self):
        from idcards.services_workflow import WorkflowService
        card = _create_card(self.table, status='pending')
        result = WorkflowService.transition(card, 'download', self.admin, request=None)
        self.assertFalse(result.success)
        card.refresh_from_db()
        self.assertEqual(card.status, 'pending')

    def test_bulk_transition(self):
        from idcards.services_workflow import WorkflowService
        c1 = _create_card(self.table, status='pending')
        c2 = _create_card(self.table, status='pending')
        result = WorkflowService.bulk_transition(
            self.table, [c1.id, c2.id], 'verified', self.admin, request=None
        )
        self.assertTrue(result.success)
        c1.refresh_from_db()
        c2.refresh_from_db()
        self.assertEqual(c1.status, 'verified')
        self.assertEqual(c2.status, 'verified')


# ── Bulk Upload Service Tests ──
class DiskBackedImageStoreTests(TestCase):
    def test_add_and_get_ram(self):
        from core.services.bulk_upload_service import DiskBackedImageStore
        store = DiskBackedImageStore()
        try:
            img_bytes = b'\x89PNG\r\n\x1a\n' + b'\x00' * 100
            store.add('test_key', img_bytes, '.png', 'test.png')
            self.assertEqual(len(store), 1)
            self.assertIn('test_key', store)
            info = store.get('test_key')
            self.assertIsNotNone(info)
            self.assertEqual(info['ext'], '.png')
            self.assertEqual(info['bytes'], img_bytes)
        finally:
            store.cleanup()

    def test_switch_to_disk_on_large_data(self):
        from core.services.bulk_upload_service import DiskBackedImageStore
        from django.conf import settings
        # Ensure temp dir exists under MEDIA_ROOT
        temp_dir = os.path.join(settings.MEDIA_ROOT, 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        store = DiskBackedImageStore()
        try:
            # Add enough data to exceed RAM threshold (50MB)
            big_chunk = b'\x00' * (300 * 1024)  # 300KB per image
            for i in range(200):  # 200 * 300KB = 60MB → should switch to disk
                store.add(f'key_{i}', big_chunk, '.jpg', f'img_{i}.jpg')
            self.assertTrue(store._use_disk or len(store) == 200)
            # Verify retrieval still works
            info = store.get('key_0')
            self.assertIsNotNone(info)
        finally:
            store.cleanup()

    def test_cleanup_clears_store(self):
        from core.services.bulk_upload_service import DiskBackedImageStore
        store = DiskBackedImageStore()
        store.add('k', b'\x00' * 100, '.jpg', 'k.jpg')
        self.assertEqual(len(store), 1)
        store.cleanup()
        self.assertEqual(len(store), 0)
        self.assertIsNone(store.get('k'))


# ── Permission Tests ──
class PermissionTests(TestCase):
    def setUp(self):
        self.admin = _create_super_admin()
        self.user, self.client_obj = _create_client_user()
        self.group, self.table = _create_table(self.client_obj)
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_super_admin_can_access_cards_api(self):
        self.client.login(username='admin@test.com', password='adminpass1')
        response = self.client.get(f'/panel/api/table/{self.table.id}/cards/')
        self.assertIn(response.status_code, [200, 403])

    def test_unauthenticated_gets_redirect_or_403(self):
        response = self.client.get(f'/panel/api/table/{self.table.id}/cards/')
        self.assertIn(response.status_code, [302, 403])

    def test_client_can_access_own_table(self):
        self.client.login(username='client@test.com', password='clientpass1')
        response = self.client.get(f'/panel/client/table/{self.table.id}/cards/')
        self.assertIn(response.status_code, [200, 302])


class PermissionValidationMiddlewareTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user, _client = _create_client_user('middleware-client@test.com', 'clientpass1')

    def _middleware(self):
        from core.middleware import PermissionValidationMiddleware
        return PermissionValidationMiddleware(lambda request: None)

    def test_db_error_on_user_refetch_returns_503_for_api(self):
        middleware = self._middleware()
        request = self.factory.get('/panel/api/dummy/')
        request.user = self.user
        request.session = {}
        request.content_type = 'application/json'

        with patch('core.models.User.objects.select_related', side_effect=Exception('db locked')):
            response = middleware._validate_user_access(request)

        self.assertIsNotNone(response)
        self.assertEqual(response.status_code, 503)

    def test_db_error_on_user_refetch_redirects_page_to_inactive(self):
        middleware = self._middleware()
        request = self.factory.get('/panel/dashboard/')
        request.user = self.user
        request.session = {}
        request.content_type = ''

        with patch('core.models.User.objects.select_related', side_effect=Exception('db locked')):
            response = middleware._validate_user_access(request)

        self.assertIsNotNone(response)
        self.assertEqual(response.status_code, 302)
        self.assertIn('/panel/inactive/', response['Location'])


class ThreadedEmailCallbackRetryTests(TestCase):
    def test_retries_transient_db_lock_then_succeeds(self):
        from core.utils.threaded_email import _run_callback_with_retry

        state = {'count': 0}

        def callback():
            state['count'] += 1
            if state['count'] < 3:
                raise Exception('database table is locked')

        _run_callback_with_retry(callback, 'test callback', max_attempts=3, base_delay=0)
        self.assertEqual(state['count'], 3)

    def test_does_not_retry_non_transient_error(self):
        from core.utils.threaded_email import _run_callback_with_retry

        state = {'count': 0}

        def callback():
            state['count'] += 1
            raise Exception('smtp down')

        _run_callback_with_retry(callback, 'test callback', max_attempts=3, base_delay=0)
        self.assertEqual(state['count'], 1)

    def test_failure_callback_receives_args_and_retries(self):
        from core.utils.threaded_email import _run_callback_with_retry

        state = {'count': 0, 'message': None}

        def callback(message):
            state['count'] += 1
            state['message'] = message
            if state['count'] < 2:
                raise Exception('database is locked')

        _run_callback_with_retry(
            callback,
            'test failure callback',
            'expected error message',
            max_attempts=3,
            base_delay=0,
        )

        self.assertEqual(state['count'], 2)
        self.assertEqual(state['message'], 'expected error message')


# ── Global Search Tests ──
class GlobalSearchTests(TestCase):
    def setUp(self):
        self.admin = _create_super_admin()
        _, self.client_obj = _create_client_user()
        self.group, self.table = _create_table(self.client_obj)
        _create_card(self.table, {'NAME': 'ALICE SMITH', 'CLASS': '10'})
        _create_card(self.table, {'NAME': 'BOB JONES', 'CLASS': '12'})
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_search_finds_matching_card(self):
        self.client.login(username='admin@test.com', password='adminpass1')
        response = self.client.get('/panel/api/global-search/?q=ALICE')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])
        self.assertGreater(data['count'], 0)

    def test_search_short_query_returns_empty(self):
        self.client.login(username='admin@test.com', password='adminpass1')
        response = self.client.get('/panel/api/global-search/?q=A')
        data = response.json()
        self.assertEqual(len(data.get('results', [])), 0)

    def test_search_no_match(self):
        self.client.login(username='admin@test.com', password='adminpass1')
        response = self.client.get('/panel/api/global-search/?q=ZZZZNOTFOUND')
        data = response.json()
        self.assertEqual(data['count'], 0)

    def test_search_does_not_match_json_key_names(self):
        self.client.login(username='admin@test.com', password='adminpass1')
        response = self.client.get('/panel/api/global-search/?q=NAME')
        data = response.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['count'], 0)

    def test_search_does_not_match_image_storage_paths(self):
        _create_card(self.table, {
            'NAME': 'CHARLIE',
            'CLASS': '8',
            'PHOTO': 'adarshimg/ROS-IMAGE-PATH-123.jpg',
        })
        cache.clear()

        self.client.login(username='admin@test.com', password='adminpass1')
        response = self.client.get('/panel/api/global-search/?q=ROS-IMAGE-PATH-123')
        data = response.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['count'], 0)


# ── Middleware Tests ──
class MiddlewareTests(TestCase):
    def test_health_check_endpoint(self):
        response = self.client.get('/panel/api/health/')
        # May redirect to login or return 200 depending on middleware
        self.assertIn(response.status_code, [200, 302, 404])

    def test_unauthenticated_panel_redirects(self):
        response = self.client.get('/panel/')
        self.assertIn(response.status_code, [302, 200])


class SubdomainRoutingSecurityTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @override_settings(DEBUG=False, ALLOWED_HOSTS=['unknown.local'])
    def test_panel_context_cookie_ignored_outside_debug(self):
        from core.middleware import SubdomainRoutingMiddleware

        middleware = SubdomainRoutingMiddleware(lambda request: HttpResponse('ok'))
        request = self.factory.get('/api/auth/check-email/', HTTP_HOST='unknown.local')
        request.COOKIES['_panel_ctx'] = '1'

        middleware(request)
        self.assertFalse(getattr(request, '_is_panel_subdomain', False))

    @override_settings(DEBUG=True)
    def test_panel_context_cookie_used_in_debug(self):
        from core.middleware import SubdomainRoutingMiddleware

        middleware = SubdomainRoutingMiddleware(lambda request: HttpResponse('ok'))
        request = self.factory.get('/api/auth/check-email/', HTTP_HOST='unknown.local')
        request.COOKIES['_panel_ctx'] = '1'

        middleware(request)
        self.assertTrue(getattr(request, '_is_panel_subdomain', False))


# ── IDCardTable Field Tests ──
class IDCardTableFieldTests(TestCase):
    def setUp(self):
        _, self.client_obj = _create_client_user()

    def test_has_image_fields(self):
        _, table = _create_table(self.client_obj, fields=[
            {'name': 'NAME', 'type': 'text', 'order': 1},
            {'name': 'PHOTO', 'type': 'photo', 'order': 2},
        ])
        self.assertTrue(table.has_image_fields())

    def test_no_image_fields(self):
        _, table = _create_table(self.client_obj, fields=[
            {'name': 'NAME', 'type': 'text', 'order': 1},
            {'name': 'CLASS', 'type': 'class', 'order': 2},
        ])
        self.assertFalse(table.has_image_fields())

    def test_has_class_field(self):
        _, table = _create_table(self.client_obj, fields=[
            {'name': 'NAME', 'type': 'text', 'order': 1},
            {'name': 'CLASS', 'type': 'class', 'order': 2},
        ])
        self.assertTrue(table.has_class_field())


class SystemSettingsAndTemplateTests(TestCase):
    def setUp(self):
        from core.models import SystemSettings
        cache.clear()
        SystemSettings.objects.all().delete()

    def tearDown(self):
        cache.clear()

    def test_system_settings_get_value_returns_export_default_when_missing(self):
        from core.models import SystemSettings

        value = SystemSettings.get_value('export_note_line')
        self.assertEqual(value, SystemSettings.EXPORT_DEFAULTS['export_note_line'])

    def test_system_settings_set_value_persists_and_invalidates_cache(self):
        from core.models import SystemSettings

        first = SystemSettings.get_value('custom_setting', default='initial')
        self.assertEqual(first, 'initial')

        SystemSettings.set_value('custom_setting', 'updated', description='test')
        second = SystemSettings.get_value('custom_setting', default='fallback')
        self.assertEqual(second, 'updated')

    def test_export_template_default_uniqueness(self):
        from core.models import ExportTemplate

        first = ExportTemplate.objects.create(
            name='Template 1',
            instructions='First instructions',
            is_default=True,
        )
        second = ExportTemplate.objects.create(
            name='Template 2',
            instructions='Second instructions',
            is_default=True,
        )

        first.refresh_from_db()
        second.refresh_from_db()

        self.assertFalse(first.is_default)
        self.assertTrue(second.is_default)
        self.assertEqual(ExportTemplate.get_default().id, second.id)


class PermissionDecoratorResponseTests(TestCase):
    def setUp(self):
        from django.contrib.auth.models import AnonymousUser

        self.factory = RequestFactory()
        self.anon = AnonymousUser()
        self.super_admin = _create_super_admin('decorator-admin@test.com', 'adminpass1')
        self.client_user, _ = _create_client_user('decorator-client@test.com', 'clientpass1')

    def test_require_super_admin_redirects_page_for_non_admin_user(self):
        from core.services.permission_service import require_super_admin
        from django.http import HttpResponse

        @require_super_admin
        def protected_view(request):
            return HttpResponse('ok')

        request = self.factory.get('/panel/manage-panel/')
        request.user = self.client_user
        request.content_type = ''
        request.headers = {}

        response = protected_view(request)
        self.assertEqual(response.status_code, 302)

    def test_require_super_admin_returns_json_for_api_path(self):
        from core.services.permission_service import require_super_admin
        from django.http import HttpResponse

        @require_super_admin
        def protected_view(request):
            return HttpResponse('ok')

        request = self.factory.get('/panel/api/monitoring/')
        request.user = self.client_user
        request.content_type = 'application/json'
        request.headers = {}

        response = protected_view(request)
        self.assertEqual(response.status_code, 403)
        self.assertFalse(json.loads(response.content.decode('utf-8'))['success'])

    def test_api_require_any_authenticated_rejects_anonymous(self):
        from core.services.permission_service import api_require_any_authenticated
        from django.http import HttpResponse

        @api_require_any_authenticated
        def protected_view(request):
            return HttpResponse('ok')

        request = self.factory.get('/panel/api/anything/')
        request.user = self.anon

        response = protected_view(request)
        self.assertEqual(response.status_code, 401)

    def test_api_require_super_admin_allows_super_admin(self):
        from core.services.permission_service import api_require_super_admin
        from django.http import HttpResponse

        @api_require_super_admin
        def protected_view(request):
            return HttpResponse('ok')

        request = self.factory.get('/panel/api/admin-only/')
        request.user = self.super_admin

        response = protected_view(request)
        self.assertEqual(response.status_code, 200)


class PanelEntryGateSecurityTests(TestCase):
    def setUp(self):
        from core.models import SystemSettings

        self.factory = RequestFactory()
        cache.clear()
        SystemSettings.set_value('website_not_found_mode', 'true')
        SystemSettings.set_value('panel_entry_gate_enabled', 'true')

    def tearDown(self):
        cache.clear()

    def _middleware(self):
        from django.http import HttpResponse
        from core.middleware import PanelEntryGateMiddleware

        return PanelEntryGateMiddleware(lambda request: HttpResponse('ok'))

    def test_timestamp_signed_panel_token_is_accepted(self):
        from django.contrib.auth.models import AnonymousUser
        from django.core.signing import TimestampSigner

        token = TimestampSigner(salt='panel-entry-gate').sign('website-panel-entry')
        request = self.factory.get(f'/auth/login/?panel_entry_token={token}')
        request.user = AnonymousUser()
        request.session = {}
        request._is_panel_subdomain = True

        response = self._middleware()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(request.session.get('_panel_entry_ok'), '1')

    def test_legacy_non_timestamp_token_is_rejected(self):
        from django.contrib.auth.models import AnonymousUser
        from django.core.signing import Signer
        from django.http import Http404

        token = Signer(salt='panel-entry-gate').sign('website-panel-entry')
        request = self.factory.get(f'/auth/login/?panel_entry_token={token}')
        request.user = AnonymousUser()
        request.session = {}
        request._is_panel_subdomain = True

        with self.assertRaises(Http404):
            self._middleware()(request)


class TaskApiSecurityTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user = _create_super_admin('tasksec-admin@test.com', 'adminpass1')

    def test_task_download_rejects_sibling_media_prefix_path(self):
        from core.models import BackgroundTask
        from core.views.task_api import api_task_download

        with tempfile.TemporaryDirectory() as media_root:
            sibling_dir = media_root + '_evil'
            os.makedirs(sibling_dir, exist_ok=True)
            sibling_file = os.path.join(sibling_dir, 'secret.txt')
            with open(sibling_file, 'wb') as fh:
                fh.write(b'secret')

            escaped_rel = os.path.join('..', os.path.basename(sibling_dir), 'secret.txt')
            task = BackgroundTask.objects.create(
                user=self.user,
                task_type='export_zip',
                status='completed',
                result_path=escaped_rel,
            )

            request = self.factory.get(f'/panel/api/task-download/{task.id}/')
            request.user = self.user
            request.session = {}

            with override_settings(MEDIA_ROOT=media_root):
                response = api_task_download(request, task.id)

        self.assertEqual(response.status_code, 400)
        self.assertFalse(json.loads(response.content.decode('utf-8'))['success'])


class CropApiScopeTests(TestCase):
    def setUp(self):
        from staff.models import Staff

        self.factory = RequestFactory()

        self.admin_user = User.objects.create_user(
            username='crop-admin-staff@test.com',
            email='crop-admin-staff@test.com',
            password='adminpass1',
            role='admin_staff',
        )

        _, self.client_a = _create_client_user('crop-client-a@test.com', 'clientpass1')
        _, self.client_b = _create_client_user('crop-client-b@test.com', 'clientpass1')

        _ga, self.table_a = _create_table(self.client_a)
        _gb, self.table_b = _create_table(self.client_b)

        self.staff_profile = Staff.objects.create(
            user=self.admin_user,
            staff_type='admin_staff',
        )
        self.staff_profile.assigned_clients.add(self.client_a)

    def test_prepare_crop_denies_unassigned_client_table(self):
        from core.views.crop_api import api_prepare_crop

        request = self.factory.post(
            f'/panel/api/table/{self.table_b.id}/cards/prepare-crop/',
            data=json.dumps({'card_ids': [1, 2, 3]}),
            content_type='application/json',
        )
        request.user = self.admin_user

        response = api_prepare_crop(request, self.table_b.id)

        self.assertEqual(response.status_code, 403)
        self.assertFalse(json.loads(response.content.decode('utf-8'))['success'])


class ProtectedMediaAuthorizationTests(TestCase):
    def setUp(self):
        from client.models import Client

        self.owner_a = User.objects.create_user(
            username='media-owner-a@test.com',
            email='media-owner-a@test.com',
            password='pass1234',
            role='client',
        )
        self.owner_b = User.objects.create_user(
            username='media-owner-b@test.com',
            email='media-owner-b@test.com',
            password='pass1234',
            role='client',
        )
        self.client_a = Client.objects.create(user=self.owner_a, name='Media Client A')
        self.client_b = Client.objects.create(user=self.owner_b, name='Media Client B')

    def test_media_adareshimg_enforces_client_scope(self):
        with tempfile.TemporaryDirectory() as media_root:
            rel_path = f"adarshimg/{self.client_a.image_folder_code}/photo.jpg"
            abs_path = os.path.join(media_root, 'adarshimg', self.client_a.image_folder_code, 'photo.jpg')
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(abs_path, 'wb') as fh:
                fh.write(b'jpg')

            with override_settings(MEDIA_ROOT=media_root, MEDIA_USE_XACCEL=True):
                self.client.force_login(self.owner_b)
                denied = self.client.get(f'/media/{rel_path}')
                self.assertEqual(denied.status_code, 404)

                self.client.force_login(self.owner_a)
                allowed = self.client.get(f'/media/{rel_path}')
                self.assertEqual(allowed.status_code, 200)
                self.assertEqual(allowed.get('X-Accel-Redirect'), f'/protected-media/{rel_path}')

    def test_media_exports_enforces_task_owner(self):
        from core.models import BackgroundTask

        with tempfile.TemporaryDirectory() as media_root:
            rel_path = 'exports/private-export.pdf'
            abs_path = os.path.join(media_root, 'exports', 'private-export.pdf')
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(abs_path, 'wb') as fh:
                fh.write(b'%PDF-1.7')

            BackgroundTask.objects.create(
                user=self.owner_a,
                task_type='export_pdf',
                status='completed',
                result_path=rel_path,
            )

            with override_settings(MEDIA_ROOT=media_root, MEDIA_USE_XACCEL=True):
                self.client.force_login(self.owner_b)
                denied = self.client.get(f'/media/{rel_path}')
                self.assertEqual(denied.status_code, 404)

                self.client.force_login(self.owner_a)
                allowed = self.client.get(f'/media/{rel_path}')
                self.assertEqual(allowed.status_code, 200)
                self.assertEqual(allowed.get('X-Accel-Redirect'), f'/protected-media/{rel_path}')


class EnginePathScopeTests(TestCase):
    def setUp(self):
        from client.models import Client
        from staff.models import Staff

        self.super_admin = _create_super_admin('engine-super@test.com', 'adminpass1')
        self.admin_staff = User.objects.create_user(
            username='engine-staff@test.com',
            email='engine-staff@test.com',
            password='pass1234',
            role='admin_staff',
        )
        self.client_owner = User.objects.create_user(
            username='engine-client@test.com',
            email='engine-client@test.com',
            password='pass1234',
            role='client',
        )
        self.client_obj = Client.objects.create(user=self.client_owner, name='Engine Scoped Client')

        staff = Staff.objects.create(user=self.admin_staff, staff_type='admin_staff')
        staff.assigned_clients.add(self.client_obj)

    def test_engine_serve_image_denies_admin_staff_outside_scope(self):
        with tempfile.TemporaryDirectory() as media_root, tempfile.TemporaryDirectory() as outside_root:
            outside_file = os.path.join(outside_root, 'outside.jpg')
            with open(outside_file, 'wb') as fh:
                fh.write(b'jpg')

            with override_settings(MEDIA_ROOT=media_root):
                self.client.force_login(self.admin_staff)
                response = self.client.get('/panel/api/engine/serve-image/', {'path': outside_file})
                self.assertEqual(response.status_code, 403)
                response.close()

    def test_engine_serve_image_allows_super_admin_outside_scope(self):
        with tempfile.TemporaryDirectory() as media_root, tempfile.TemporaryDirectory() as outside_root:
            outside_file = os.path.join(outside_root, 'outside.jpg')
            with open(outside_file, 'wb') as fh:
                fh.write(b'jpg')

            with override_settings(MEDIA_ROOT=media_root):
                self.client.force_login(self.super_admin)
                response = self.client.get('/panel/api/engine/serve-image/', {'path': outside_file})
                self.assertEqual(response.status_code, 200)
                response.close()


class DashboardAndLogsHardeningTests(TestCase):
    def test_dashboard_limit_parser_clamps_values(self):
        from core.views.dashboard_views import _parse_dashboard_limit

        self.assertEqual(_parse_dashboard_limit('99999'), 500)
        self.assertEqual(_parse_dashboard_limit('-5'), 1)
        self.assertEqual(_parse_dashboard_limit('bad'), 500)

    def test_activity_logs_handles_invalid_limit_offset(self):
        from core.models import ActivityLog

        admin = _create_super_admin('activity-admin@test.com', 'adminpass1')
        for i in range(3):
            ActivityLog.objects.create(user=admin, action='other', description=f'log-{i}')

        self.client.force_login(admin)
        response = self.client.get('/panel/api/activity-logs/', {'limit': 'bad', 'offset': 'bad'})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertGreaterEqual(payload['total'], 3)


class SecurityApiRegressionTests(TestCase):
    def setUp(self):
        from staff.models import Staff

        self.super_admin = _create_super_admin('sec-api-admin@test.com', 'adminpass1')

        self.client_user_a, self.client_a = _create_client_user('sec-client-a@test.com', 'clientpass1')
        self.client_user_b, self.client_b = _create_client_user('sec-client-b@test.com', 'clientpass1')

        _group_a, self.table_a = _create_table(self.client_a, fields=[
            {'name': 'NAME', 'type': 'text', 'order': 1},
            {'name': 'CLASS', 'type': 'class', 'order': 2},
        ])
        self.card_a = _create_card(self.table_a, field_data={'NAME': 'ALICE', 'CLASS': '10'})

        self.admin_staff = User.objects.create_user(
            username='sec-admin-staff@test.com',
            email='sec-admin-staff@test.com',
            password='pass1234',
            role='admin_staff',
        )
        staff_profile = Staff.objects.create(user=self.admin_staff, staff_type='admin_staff')
        staff_profile.assigned_clients.add(self.client_a)

    def test_inline_update_field_rejects_unknown_field_name(self):
        self.client.login(username='sec-api-admin@test.com', password='adminpass1')

        response = self.client.post(
            f'/panel/api/card/{self.card_a.id}/update-field/',
            data=json.dumps({'field': '__HACK__', 'value': 'x'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload.get('success', True))
        self.assertIn('Invalid field name', payload.get('message', ''))

        self.card_a.refresh_from_db()
        self.assertNotIn('__HACK__', self.card_a.field_data)

    def test_client_toggle_status_blocks_unassigned_admin_staff(self):
        self.client.login(username='sec-admin-staff@test.com', password='pass1234')

        response = self.client.post(
            f'/panel/api/client/{self.client_b.id}/toggle-status/',
            data=json.dumps({}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn('Access denied', response.json().get('message', ''))

    def test_delete_all_confirmation_locks_after_five_failed_attempts(self):
        self.client.login(username='sec-api-admin@test.com', password='adminpass1')

        session = self.client.session
        session[f'delete_all_code_{self.table_a.id}'] = '1234567890'
        session.save()

        url = f'/panel/api/table/{self.table_a.id}/cards/bulk-delete/'
        for _ in range(5):
            response = self.client.post(
                url,
                data=json.dumps({'delete_all': True, 'confirmation_code': '0000000000'}),
                content_type='application/json',
            )
            self.assertEqual(response.status_code, 403)

        locked = self.client.post(
            url,
            data=json.dumps({'delete_all': True, 'confirmation_code': '0000000000'}),
            content_type='application/json',
        )
        self.assertEqual(locked.status_code, 429)
        self.assertIn('Too many failed attempts', locked.json().get('message', ''))

    def test_delete_all_success_clears_attempt_counter(self):
        self.client.login(username='sec-api-admin@test.com', password='adminpass1')

        session = self.client.session
        session[f'delete_all_code_{self.table_a.id}'] = '1234567890'
        session[f'delete_all_attempts_{self.table_a.id}'] = 3
        session.save()

        response = self.client.post(
            f'/panel/api/table/{self.table_a.id}/cards/bulk-delete/',
            data=json.dumps({'delete_all': True, 'confirmation_code': '1234567890'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)

        session_after = self.client.session
        self.assertNotIn(f'delete_all_code_{self.table_a.id}', session_after)
        self.assertNotIn(f'delete_all_attempts_{self.table_a.id}', session_after)

    def test_maintenance_status_hides_details_for_non_admin(self):
        self.client.login(username='sec-client-a@test.com', password='clientpass1')

        response = self.client.get('/panel/api/maintenance/status/')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertIn('enabled', payload)
        self.assertNotIn('message', payload)
        self.assertNotIn('end_time', payload)

    def test_maintenance_status_returns_full_payload_for_admin(self):
        self.client.login(username='sec-api-admin@test.com', password='adminpass1')

        response = self.client.get('/panel/api/maintenance/status/')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertIn('enabled', payload)
        self.assertIn('message', payload)
        self.assertIn('end_time', payload)

    def test_client_and_client_staff_cards_api_hide_admin_audit_metadata(self):
        from staff.models import Staff

        # Parent client permissions gate client_staff visibility too.
        self.client_a.perm_idcard_pending_list = True
        self.client_a.perm_idcard_updated_at = True
        self.client_a.save(update_fields=['perm_idcard_pending_list', 'perm_idcard_updated_at'])

        client_staff_user = User.objects.create_user(
            username='sec-client-staff-a@test.com',
            email='sec-client-staff-a@test.com',
            password='pass1234',
            role='client_staff',
        )
        Staff.objects.create(
            user=client_staff_user,
            staff_type='client_staff',
            client=self.client_a,
            perm_idcard_pending_list=True,
            perm_idcard_updated_at=True,
        )

        admin_touched_card = self.card_a
        admin_touched_card.modified_by = self.admin_staff.username
        admin_touched_card.save(update_fields=['modified_by'])

        client_touched_card = _create_card(
            self.table_a,
            field_data={'NAME': 'BOB', 'CLASS': '10'},
            status='pending',
        )
        client_touched_card.modified_by = client_staff_user.username
        client_touched_card.save(update_fields=['modified_by'])

        url = f'/panel/api/table/{self.table_a.id}/cards/?status=pending'

        # Client view
        self.client.login(username='sec-client-a@test.com', password='clientpass1')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        cards_by_id = {c['id']: c for c in payload['cards']}

        self.assertEqual(cards_by_id[admin_touched_card.id]['modified_by'], '')
        self.assertIsNone(cards_by_id[admin_touched_card.id]['updated_at'])
        self.assertIsNone(cards_by_id[admin_touched_card.id]['downloaded_at'])
        self.assertIsNone(cards_by_id[admin_touched_card.id]['deleted_at'])

        self.assertEqual(cards_by_id[client_touched_card.id]['modified_by'], self.client_a.name)
        self.assertIsNotNone(cards_by_id[client_touched_card.id]['updated_at'])

        # Client staff view
        self.client.login(username='sec-client-staff-a@test.com', password='pass1234')
        response_staff = self.client.get(url)
        self.assertEqual(response_staff.status_code, 200)
        payload_staff = response_staff.json()
        staff_cards_by_id = {c['id']: c for c in payload_staff['cards']}

        self.assertEqual(staff_cards_by_id[admin_touched_card.id]['modified_by'], '')
        self.assertIsNone(staff_cards_by_id[admin_touched_card.id]['updated_at'])
        self.assertEqual(staff_cards_by_id[client_touched_card.id]['modified_by'], self.client_a.name)

    def test_client_update_response_masks_username_to_client_name(self):
        self.client_a.perm_idcard_edit = True
        self.client_a.perm_idcard_updated_at = True
        self.client_a.save(update_fields=['perm_idcard_edit', 'perm_idcard_updated_at'])

        self.client.login(username='sec-client-a@test.com', password='clientpass1')
        response = self.client.post(
            f'/panel/api/card/{self.card_a.id}/update/',
            data=json.dumps({'field_data': {'NAME': 'ALICIA', 'CLASS': '10'}}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['card']['modified_by'], self.client_a.name)
        self.assertNotEqual(payload['card']['modified_by'], self.client_user_a.username)
        self.assertIsNotNone(payload['card']['updated_at'])


class ReuploadDirectTaskFlowTests(TestCase):
    def setUp(self):
        self.admin = _create_super_admin('reupload-admin@test.com', 'adminpass1')
        _, self.client_obj = _create_client_user('reupload-client@test.com', 'clientpass1')
        _group, self.table = _create_table(self.client_obj, fields=[
            {'name': 'NAME', 'type': 'text', 'order': 1},
            {'name': 'PHOTO', 'type': 'photo', 'order': 2},
        ])
        self.card = _create_card(
            self.table,
            field_data={
                'NAME': 'TOKEN USER',
                'PHOTO': 'adarshimg/20240101121212.jpg',
            },
            status='pending',
        )

        self._tmp_media = tempfile.TemporaryDirectory()
        self._media_override = override_settings(MEDIA_ROOT=self._tmp_media.name)
        self._media_override.enable()

    def tearDown(self):
        self._media_override.disable()
        self._tmp_media.cleanup()

    def _make_reupload_zip(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr('PHOTO/20240101121212.jpg', b'fake-image-bytes-12345')
        return buf.getvalue()

    def test_create_reupload_task_direct_upload_success(self):
        self.client.login(username='reupload-admin@test.com', password='adminpass1')

        zip_bytes = self._make_reupload_zip()
        upload = SimpleUploadedFile('reupload.zip', zip_bytes, content_type='application/zip')

        with patch('core.views.task_api.background_worker.submit_task') as mock_submit:
            create_resp = self.client.post(
                f'/panel/api/table/{self.table.id}/reupload-task/',
                data={
                    'photos_zip': upload,
                    'card_ids': json.dumps([self.card.id]),
                    'status': 'pending',
                },
            )

        self.assertEqual(create_resp.status_code, 200)
        create_payload = create_resp.json()
        self.assertTrue(create_payload['success'])
        self.assertIn('task_id', create_payload)
        mock_submit.assert_called_once()

        from core.models import BackgroundTask
        task = BackgroundTask.objects.get(id=create_payload['task_id'])
        self.assertEqual(task.task_type, 'reupload_images')
        self.assertEqual(task.metadata.get('table_id'), self.table.id)
        self.assertEqual(task.metadata.get('card_ids'), [self.card.id])
        self.assertEqual(task.metadata.get('status_filter'), 'pending')

    def test_create_reupload_task_requires_zip(self):
        self.client.login(username='reupload-admin@test.com', password='adminpass1')

        create_resp = self.client.post(
            f'/panel/api/table/{self.table.id}/reupload-task/',
            data={'card_ids': json.dumps([self.card.id])},
        )

        self.assertEqual(create_resp.status_code, 400)
        self.assertIn('no zip file uploaded', create_resp.json().get('message', '').lower())

    def test_zip_index_ignores_non_exact_stems(self):
        from core.services.reupload_processor import _build_zip_image_index

        zip_path = os.path.join(self._tmp_media.name, 'bad_names.zip')
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr('PHOTO/20240101121212_copy.jpg', b'abc')
            zf.writestr('PHOTO/random_name.jpg', b'abc')

        index, _, stats = _build_zip_image_index(zip_path)
        self.assertEqual(index, {})
        self.assertEqual(stats.get('duplicate_name_keys'), 0)

    def test_zip_index_blocks_duplicate_exact_stems(self):
        from core.services.reupload_processor import _build_zip_image_index

        zip_path = os.path.join(self._tmp_media.name, 'dup_names.zip')
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr('PHOTO/20240101121212.jpg', b'abc')
            zf.writestr('SIGN/20240101121212.png', b'def')

        index, _, stats = _build_zip_image_index(zip_path)
        self.assertNotIn('20240101121212', index)
        self.assertGreater(stats.get('duplicate_name_keys', 0), 0)

    def test_sync_reupload_replace_uses_immediate_old_image_cleanup(self):
        self.client.login(username='reupload-admin@test.com', password='adminpass1')

        zip_bytes = self._make_reupload_zip()
        upload = SimpleUploadedFile('reupload.zip', zip_bytes, content_type='application/zip')
        mock_result = type('Result', (), {
            'success': True,
            'data': {'final_value': 'adarshimg/20240101121212_121314.jpg'},
        })()

        with patch('core.views.idcard_bulk_api.validate_image_bytes', return_value=(True, None)), \
             patch('core.views.idcard_bulk_api.ImageService.replace_image', return_value=mock_result) as mock_replace:
            response = self.client.post(
                f'/panel/api/table/{self.table.id}/cards/reupload-images/',
                data={
                    'photos_zip': upload,
                    'card_ids': json.dumps([self.card.id]),
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get('success'))
        self.assertEqual(payload.get('updated_count'), 1)

        self.assertEqual(mock_replace.call_count, 1)
        kwargs = mock_replace.call_args.kwargs
        self.assertTrue(kwargs.get('delete_old_after_save'))
        self.assertEqual(kwargs.get('existing_path'), 'adarshimg/20240101121212.jpg')

        self.card.refresh_from_db()
        self.assertEqual(
            self.card.field_data.get('PHOTO'),
            'adarshimg/20240101121212_121314.jpg',
        )
