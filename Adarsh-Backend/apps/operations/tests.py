import uuid
import zipfile
import hashlib
from io import BytesIO
from unittest.mock import MagicMock, patch
from django.test import TestCase, override_settings
from django.core.exceptions import ImproperlyConfigured
from django.urls import reverse
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APITestCase
from rest_framework import status

from apps.users.models import User
from shared.constants import Role
from apps.pro.models import BackupSession, BackupArtifact
from apps.pro.constants import BackupStatus
from apps.operations.models import BackupVerificationResult, DiskHealthSnapshot, MemoryHealthSnapshot
from apps.operations.services import (
    BackupVerificationService,
    BackupRetentionPolicy,
    RestoreSimulationService,
    EnvironmentDiagnosticService,
    StartupDiagnosticService,
    DeploymentValidationService,
    MigrationValidationService,
    DiskHealthService,
    MemoryHealthService,
)

# ─── 1. Backup Verification Tests ─────────────────────────────────────────────

class BackupVerificationTests(TestCase):
    def setUp(self):
        self.pro_user = User.objects.create_user(
            username='pro_user_ops',
            email='pro_ops@example.com',
            password='password123',
            role=Role.PRO_USER
        )
        self.session = BackupSession.objects.create(
            scope='CLIENT',
            status=BackupStatus.COMPLETED,
            created_by=self.pro_user
        )
        self.artifact = BackupArtifact.objects.create(
            backup_session=self.session,
            file_name='test_backup.zip',
            stored_path='backups/test_backup.zip',
            file_size=100,
            checksum='mocked_checksum_hash_value_here'
        )

    @patch('apps.mediafiles.storage.factory.StorageFactory.get_storage')
    def test_verify_backup_success(self, mock_get_storage):
        mock_storage = MagicMock()
        mock_storage.exists.return_value = True
        
        # Build valid zip content
        buf = BytesIO()
        with zipfile.ZipFile(buf, 'w') as zf:
            zf.writestr('test.txt', 'data')
        zip_bytes = buf.getvalue()
        
        # Fix check size & checksum matches
        self.artifact.file_size = len(zip_bytes)
        self.artifact.checksum = hashlib.sha256(zip_bytes).hexdigest()
        self.artifact.save()
        
        mock_storage.read.return_value = zip_bytes
        mock_get_storage.return_value = mock_storage

        res = BackupVerificationService.verify_backup(self.artifact.id)
        self.assertEqual(res['status'], 'success')
        self.assertIsNone(res['error_details'])
        
        # Verify db record created
        db_res = BackupVerificationResult.objects.first()
        self.assertIsNotNone(db_res)
        self.assertEqual(db_res.status, 'success')

    @patch('apps.mediafiles.storage.factory.StorageFactory.get_storage')
    def test_verify_backup_missing_file(self, mock_get_storage):
        mock_storage = MagicMock()
        mock_storage.exists.return_value = False
        mock_storage.read.return_value = b''
        mock_get_storage.return_value = mock_storage

        res = BackupVerificationService.verify_backup(self.artifact.id)
        self.assertEqual(res['status'], 'failed')
        self.assertIn("File not found in storage", res['error_details'])

# ─── 2. Retention Tests ───────────────────────────────────────────────────────

class BackupRetentionTests(TestCase):
    def setUp(self):
        self.pro_user = User.objects.create_user(
            username='pro_user_ret',
            email='pro_ret@example.com',
            password='password123',
            role=Role.PRO_USER
        )

    @patch('apps.mediafiles.storage.factory.StorageFactory.get_storage')
    def test_retention_policy_cleanup(self, mock_get_storage):
        mock_storage = MagicMock()
        mock_get_storage.return_value = mock_storage

        now = timezone.now()
        
        # 1. Retained: Daily backup (2 days old)
        b1 = BackupSession.objects.create(status=BackupStatus.COMPLETED, created_by=self.pro_user)
        b1.created_at = now - timedelta(days=2)
        b1.save()
        BackupArtifact.objects.create(backup_session=b1, file_name='b1.zip', stored_path='path1')
        
        # 2. Retained: Weekly backup (Sunday backup, 15 days old)
        b2 = BackupSession.objects.create(status=BackupStatus.COMPLETED, created_by=self.pro_user)
        # Find a Sunday within last 15-20 days
        sunday_date = now - timedelta(days=15)
        while sunday_date.weekday() != 6:
            sunday_date -= timedelta(days=1)
        b2.created_at = sunday_date
        b2.save()
        BackupArtifact.objects.create(backup_session=b2, file_name='b2.zip', stored_path='path2')

        # 3. Deleted: Old random day backup (10 days old, not Sunday or 1st)
        b3 = BackupSession.objects.create(status=BackupStatus.COMPLETED, created_by=self.pro_user)
        non_sunday_date = now - timedelta(days=10)
        while non_sunday_date.weekday() == 6 or non_sunday_date.day == 1:
            non_sunday_date -= timedelta(days=1)
        b3.created_at = non_sunday_date
        b3.save()
        BackupArtifact.objects.create(backup_session=b3, file_name='b3.zip', stored_path='path3')

        res = BackupRetentionPolicy.run_retention_cleanup()
        self.assertEqual(res['deleted_count'], 1)
        self.assertEqual(res['retained_count'], 2)
        
        # Check database records
        self.assertTrue(BackupSession.objects.filter(id=b1.id).exists())
        self.assertTrue(BackupSession.objects.filter(id=b2.id).exists())
        self.assertFalse(BackupSession.objects.filter(id=b3.id).exists())

# ─── 3. Restore Simulation Tests ──────────────────────────────────────────────

class RestoreSimulationTests(TestCase):
    def setUp(self):
        self.pro_user = User.objects.create_user(
            username='pro_user_sim',
            email='pro_sim@example.com',
            password='password123',
            role=Role.PRO_USER
        )
        self.session = BackupSession.objects.create(status=BackupStatus.COMPLETED, created_by=self.pro_user)
        self.artifact = BackupArtifact.objects.create(
            backup_session=self.session,
            file_name='sim.zip',
            stored_path='path_sim.zip',
            file_size=10,
            checksum='checksum_val'
        )

    @patch('apps.mediafiles.storage.factory.StorageFactory.get_storage')
    def test_restore_simulation_success(self, mock_get_storage):
        buf = BytesIO()
        with zipfile.ZipFile(buf, 'w') as zf:
            zf.writestr('organizations.json', '[]')
            zf.writestr('tables.json', '[]')
            zf.writestr('fields.json', '[]')
            zf.writestr('cards.json', '[]')
            zf.writestr('imports.json', '[]')
            zf.writestr('exports.json', '[]')
        zip_bytes = buf.getvalue()
        
        self.artifact.checksum = hashlib.sha256(zip_bytes).hexdigest()
        self.artifact.save()

        mock_storage = MagicMock()
        mock_storage.read.return_value = zip_bytes
        mock_get_storage.return_value = mock_storage

        res = RestoreSimulationService.simulate_restore(self.artifact.id)
        self.assertEqual(res['status'], 'success')
        self.assertEqual(len(res['errors']), 0)

    @patch('apps.mediafiles.storage.factory.StorageFactory.get_storage')
    def test_restore_simulation_corrupt(self, mock_get_storage):
        mock_storage = MagicMock()
        mock_storage.read.return_value = b'corrupted_non_zip_bytes'
        mock_get_storage.return_value = mock_storage

        res = RestoreSimulationService.simulate_restore(self.artifact.id)
        self.assertEqual(res['status'], 'failed')
        self.assertTrue(len(res['errors']) > 0)

# ─── 4. Diagnostics & Startup Tests ───────────────────────────────────────────

class DiagnosticsTests(TestCase):
    @patch('apps.operations.services.Celery.control')
    @patch('django.core.cache.cache.get')
    @patch('django.core.cache.cache.set')
    def test_environment_diagnostic_service(self, mock_set, mock_get, mock_celery_control):
        mock_get.return_value = 'ok'
        mock_celery_control.ping.return_value = {'worker1': 'pong'}

        res = EnvironmentDiagnosticService.run_diagnostics()
        self.assertIn('database', res)
        self.assertIn('redis', res)
        self.assertIn('storage', res)
        self.assertIn('disk', res)
        self.assertIn('memory', res)

    @patch('django.core.cache.cache.set')
    def test_startup_diagnostic_fails_fast_on_missing_db(self, mock_set):
        # Force database error during connectivity check
        with patch('django.db.backends.base.base.BaseDatabaseWrapper.ensure_connection') as mock_conn:
            mock_conn.side_effect = Exception("DB Connection refused")
            with self.assertRaises(ImproperlyConfigured) as context:
                StartupDiagnosticService.validate()
            self.assertIn("Database is not reachable", str(context.exception))

# ─── 5. Migration Validation Tests ────────────────────────────────────────────

class MigrationValidationTests(TestCase):
    def test_migration_validation_healthy(self):
        res = MigrationValidationService.validate_migrations()
        self.assertEqual(res['status'], 'healthy')
        self.assertEqual(len(res['errors']), 0)

# ─── 6. Disk Monitoring Tests ─────────────────────────────────────────────────

class DiskMonitoringTests(TestCase):
    @patch('shutil.disk_usage')
    def test_disk_health_warning_thresholds(self, mock_disk_usage):
        # Mock low free space (free: 1GB out of 100GB -> 1%)
        mock_usage = MagicMock()
        mock_usage.total = 100 * 1024 * 1024 * 1024
        mock_usage.used = 99 * 1024 * 1024 * 1024
        mock_usage.free = 1 * 1024 * 1024 * 1024
        mock_disk_usage.return_value = mock_usage

        res = DiskHealthService.check_disk_health()
        self.assertEqual(res['status'], 'critical')
        self.assertEqual(res['percent_free'], 1.0)
        
        # Verify db snapshot is logged
        db_snap = DiskHealthSnapshot.objects.first()
        self.assertIsNotNone(db_snap)
        self.assertEqual(db_snap.free_space, mock_usage.free)

# ─── 7. Memory Monitoring Tests ───────────────────────────────────────────────

class MemoryMonitoringTests(TestCase):
    @patch('apps.operations.services.EnvironmentDiagnosticService._get_system_memory')
    def test_memory_health_warning(self, mock_get_memory):
        # Mock high memory usage: 95%
        mock_get_memory.return_value = {
            'total': 16000000000,
            'available': 800000000,
            'used': 15200000000,
            'percent_used': 95.0
        }
        
        res = MemoryHealthService.check_memory_health()
        self.assertEqual(res['status'], 'warning')
        
        # Verify db snapshot logged
        db_snap = MemoryHealthSnapshot.objects.first()
        self.assertIsNotNone(db_snap)
        self.assertEqual(db_snap.used_memory, 15200000000)

# ─── 8. Deployment Validation Tests ───────────────────────────────────────────

class DeploymentValidationTests(TestCase):
    @patch('apps.operations.services.Celery.control')
    @patch('django.core.cache.cache.get')
    def test_deployment_validation(self, mock_cache_get, mock_celery_control):
        mock_cache_get.return_value = 'alive'
        mock_celery_control.ping.return_value = {'worker1': 'pong'}

        res = DeploymentValidationService.validate_deployment()
        self.assertIn('status', res)
        self.assertIn('results', res)

# ─── 9. API Operations Dashboard Tests ────────────────────────────────────────

class OperationsAPIDashboardTests(APITestCase):
    def setUp(self):
        self.pro_user = User.objects.create_user(
            username='pro_dashboard_user',
            email='pro_dash@example.com',
            password='password123',
            role=Role.PRO_USER
        )
        self.client_user = User.objects.create_user(
            username='client_user_ops',
            email='client_ops@example.com',
            password='password123',
            role=Role.CLIENT
        )
        
        # Create some stats snapshot
        self.session = BackupSession.objects.create(status=BackupStatus.COMPLETED, created_by=self.pro_user)
        self.art = BackupArtifact.objects.create(
            backup_session=self.session,
            file_name='test.zip',
            stored_path='path',
            file_size=10,
            checksum='hash'
        )

    def test_operations_dashboard_unauthorized_for_client(self):
        self.client.force_authenticate(user=self.client_user)
        url = reverse('operations_dashboard')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @patch('apps.operations.services.Celery.control')
    @patch('django.core.cache.cache.get')
    def test_operations_dashboard_authorized_for_pro_user(self, mock_get, mock_celery):
        mock_get.return_value = 'alive'
        mock_celery.ping.return_value = {'worker1': 'pong'}

        self.client.force_authenticate(user=self.pro_user)
        url = reverse('operations_dashboard')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('backup_status', response.data)
        self.assertIn('disk_usage', response.data)
        self.assertIn('migration_status', response.data)

    @patch('apps.mediafiles.storage.factory.StorageFactory.get_storage')
    def test_operations_dashboard_post_actions(self, mock_storage):
        # Mock storage
        mock_store = MagicMock()
        mock_store.exists.return_value = True
        
        buf = BytesIO()
        with zipfile.ZipFile(buf, 'w') as zf:
            zf.writestr('organizations.json', '[]')
            zf.writestr('tables.json', '[]')
            zf.writestr('fields.json', '[]')
            zf.writestr('cards.json', '[]')
            zf.writestr('imports.json', '[]')
            zf.writestr('exports.json', '[]')
        zip_bytes = buf.getvalue()
        
        self.art.file_size = len(zip_bytes)
        self.art.checksum = hashlib.sha256(zip_bytes).hexdigest()
        self.art.save()
        mock_store.read.return_value = zip_bytes
        mock_storage.return_value = mock_store

        self.client.force_authenticate(user=self.pro_user)
        url = reverse('operations_dashboard')
        
        # Test verify_backups trigger
        response = self.client.post(url, {'action': 'verify_backups'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'completed')
        
        # Test simulate_restore trigger
        response = self.client.post(url, {
            'action': 'simulate_restore',
            'artifact_id': str(self.art.id)
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'success')
