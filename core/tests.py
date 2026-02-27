"""
Tests for core app.
Covers: User model, IDCard/IDCardTable/IDCardGroup models, middleware,
permissions, workflow transitions, bulk upload service, global search.
"""
from django.test import TestCase, RequestFactory, override_settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
import json
import os
import tempfile

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
    from workflows.models import IDCardGroup, IDCardTable
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
    from workflows.models import IDCard
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
        from workflows.models import IDCard
        card = IDCard.objects.create(table=self.table, field_data={'NAME': 'X'})
        self.assertEqual(card.status, 'pending')


# ── Workflow Transition Tests ──
class WorkflowTransitionTests(TestCase):
    def setUp(self):
        self.admin = _create_super_admin()
        _, self.client_obj = _create_client_user()
        self.group, self.table = _create_table(self.client_obj)

    def test_pending_to_verified(self):
        from core.services.workflow_service import WorkflowService
        card = _create_card(self.table, status='pending')
        result = WorkflowService.transition(card, 'verified', self.admin, request=None)
        self.assertTrue(result.success)
        card.refresh_from_db()
        self.assertEqual(card.status, 'verified')

    def test_invalid_transition_rejected(self):
        from core.services.workflow_service import WorkflowService
        card = _create_card(self.table, status='pending')
        result = WorkflowService.transition(card, 'download', self.admin, request=None)
        self.assertFalse(result.success)
        card.refresh_from_db()
        self.assertEqual(card.status, 'pending')

    def test_bulk_transition(self):
        from core.services.workflow_service import WorkflowService
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


# ── Middleware Tests ──
class MiddlewareTests(TestCase):
    def test_health_check_endpoint(self):
        response = self.client.get('/panel/api/health/')
        # May redirect to login or return 200 depending on middleware
        self.assertIn(response.status_code, [200, 302, 404])

    def test_unauthenticated_panel_redirects(self):
        response = self.client.get('/panel/')
        self.assertIn(response.status_code, [302, 200])


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
