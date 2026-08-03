import os
import sys
import time
import json
import hashlib
import zipfile
import shutil
import ctypes
import logging
from io import BytesIO
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils import timezone
from django.db import connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.core.cache import cache
from celery import Celery

from apps.pro.models import BackupSession, BackupArtifact
from apps.pro.constants import BackupStatus, ProAuditEvent
from apps.auditlogs.models import AuditLog, AuditEvent
from apps.operations.models import BackupVerificationResult, DiskHealthSnapshot, MemoryHealthSnapshot
from apps.mediafiles.storage.factory import StorageFactory

logger = logging.getLogger(__name__)

# Helper to log operations audit logs
def _ops_audit(event_type, details=None):
    try:
        # Resolve a default system user if possible, or leave as null (system actor)
        from apps.users.models import User
        system_user = User.objects.filter(is_superuser=True).first()
        AuditLog.objects.create(
            event_type=event_type,
            actor=system_user,
            details=details or {}
        )
    except Exception as e:
        logger.error(f"Failed to log operations audit: {e}")

# ─── 1. Backup Verification Service ───────────────────────────────────────────

class BackupVerificationService:
    @staticmethod
    def verify_backup(artifact_id) -> dict:
        start_time = timezone.now()
        error_details = []
        status_str = "success"
        
        try:
            artifact = BackupArtifact.objects.select_related('backup_session').get(id=artifact_id)
        except BackupArtifact.DoesNotExist:
            return {'status': 'failed', 'error': 'Backup artifact not found.'}
            
        try:
            storage = StorageFactory.get_storage()
            
            # 1. Verify exists
            if not storage.exists(artifact.stored_path):
                error_details.append(f"File not found in storage at: {artifact.stored_path}")
                
            # 2. Verify size
            # Retrieve bytes to verify size and checksum
            zip_bytes = storage.read(artifact.stored_path)
            actual_size = len(zip_bytes)
            if actual_size <= 0:
                error_details.append("Backup size is 0.")
            if actual_size != artifact.file_size:
                error_details.append(f"Size mismatch: expected {artifact.file_size}, got {actual_size}.")
                
            # 3. Verify checksum
            computed_checksum = hashlib.sha256(zip_bytes).hexdigest()
            if computed_checksum != artifact.checksum:
                error_details.append(f"Checksum mismatch: expected {artifact.checksum}, got {computed_checksum}.")
                
            # 4. Verify accessibility / zip integrity
            with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
                bad_file = zf.testzip()
                if bad_file:
                    error_details.append(f"Corrupt zip structure detected at file: {bad_file}")
                    
        except Exception as e:
            error_details.append(f"Verification process error: {str(e)}")
            
        if error_details:
            status_str = "failed"
            
        error_msg = "; ".join(error_details) if error_details else None
        
        # Save verification result
        result = BackupVerificationResult.objects.create(
            backup_artifact=artifact,
            status=status_str,
            error_details=error_msg
        )
        
        # Log Audit event
        audit_event = AuditEvent.BACKUP_VERIFIED if status_str == 'success' else AuditEvent.BACKUP_FAILED
        _ops_audit(
            audit_event,
            details={
                'backup_session_id': str(artifact.backup_session.id),
                'file_name': artifact.file_name,
                'verification_id': str(result.id),
                'error': error_msg
            }
        )
        
        return {
            'verification_time': start_time,
            'status': status_str,
            'error_details': error_msg
        }

    @staticmethod
    def verify_all_backups() -> list:
        artifacts = BackupArtifact.objects.all()
        results = []
        for art in artifacts:
            results.append(BackupVerificationService.verify_backup(art.id))
        return results

# ─── 2. Backup Retention Policy ───────────────────────────────────────────────

class BackupRetentionPolicy:
    @staticmethod
    def run_retention_cleanup() -> dict:
        """
        Grandfather-Father-Son retention policy.
        - Daily backups: Keep all backups created in the last 7 days.
        - Weekly backups: Keep Sunday backups created in the last 28 days (4 weeks).
        - Monthly backups: Keep 1st of month backups created in the last 365 days (12 months).
        - Delete all other backups.
        """
        now = timezone.now()
        backups = BackupSession.objects.filter(status=BackupStatus.COMPLETED).prefetch_related('artifact')
        
        deleted_count = 0
        retained_count = 0
        
        storage = StorageFactory.get_storage()
        
        for backup in backups:
            created = backup.created_at
            age_days = (now - created).days
            
            retain = False
            
            # Rule 1: Daily backups (last 7 days)
            if age_days <= 7:
                retain = True
            # Rule 2: Weekly backups (Sunday backups created in last 28 days)
            elif age_days <= 28 and created.weekday() == 6:  # 6 is Sunday in Python's datetime.weekday()
                retain = True
            # Rule 3: Monthly backups (1st of month backups created in last 365 days)
            elif age_days <= 365 and created.day == 1:
                retain = True
                
            if retain:
                retained_count += 1
            else:
                # Delete backup artifact from storage and session from DB
                try:
                    if hasattr(backup, 'artifact'):
                        storage.delete(backup.artifact.stored_path)
                    backup.delete()
                    deleted_count += 1
                except Exception as e:
                    logger.error(f"Failed to delete backup session {backup.id} during retention: {e}")
                    
        return {
            'deleted_count': deleted_count,
            'retained_count': retained_count
        }

# ─── 3. Restore Simulation Service ────────────────────────────────────────────

class RestoreSimulationService:
    @staticmethod
    def simulate_restore(artifact_id) -> dict:
        """
        Dry-run / restore simulation. Does NOT affect database or production records.
        Downloads zip, opens files, validates structure and integrity of models.
        """
        report = {'status': 'success', 'errors': []}
        
        try:
            artifact = BackupArtifact.objects.select_related('backup_session').get(id=artifact_id)
        except BackupArtifact.DoesNotExist:
            return {'status': 'failed', 'errors': ['Backup artifact not found.']}
            
        try:
            storage = StorageFactory.get_storage()
            zip_bytes = storage.read(artifact.stored_path)
            
            # Checksum
            computed_checksum = hashlib.sha256(zip_bytes).hexdigest()
            if computed_checksum != artifact.checksum:
                report['errors'].append("Artifact checksum mismatch.")
                
            # Zip reading
            with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
                required_files = [
                    'organizations.json',
                    'tables.json',
                    'fields.json',
                    'cards.json',
                    'imports.json',
                    'exports.json'
                ]
                
                # Check file presence
                namelist = zf.namelist()
                for rf in required_files:
                    if rf not in namelist:
                        report['errors'].append(f"Required file {rf} is missing from backup package.")
                        
                # Parse JSON files and validate basic layout
                for filename in namelist:
                    if filename.endswith('.json'):
                        try:
                            content = zf.read(filename).decode('utf-8')
                            data = json.loads(content)
                            if not isinstance(data, list):
                                report['errors'].append(f"{filename} does not contain a JSON list.")
                        except json.JSONDecodeError as jde:
                            report['errors'].append(f"Corrupt JSON format in file {filename}: {str(jde)}")
                            
        except Exception as e:
            report['errors'].append(f"Simulation execution error: {str(e)}")
            
        if report['errors']:
            report['status'] = 'failed'
            
        # Log Audit Event
        _ops_audit(
            AuditEvent.RESTORE_SIMULATION,
            details={
                'backup_session_id': str(artifact.backup_session.id),
                'file_name': artifact.file_name,
                'status': report['status'],
                'errors': report['errors']
            }
        )
        
        return report

# ─── 4. Environment Diagnostic Service ────────────────────────────────────────

class EnvironmentDiagnosticService:
    @staticmethod
    def _get_system_memory() -> dict:
        """Cross-platform memory parser supporting Windows ctypes and Linux meminfo."""
        # Windows
        if sys.platform == 'win32':
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            try:
                stat = MEMORYSTATUSEX()
                stat.dwLength = ctypes.sizeof(stat)
                ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
                return {
                    'total': stat.ullTotalPhys,
                    'available': stat.ullAvailPhys,
                    'used': stat.ullTotalPhys - stat.ullAvailPhys,
                    'percent_used': stat.dwMemoryLoad,
                }
            except Exception:
                pass
                
        # Linux / Fallback
        if os.path.exists('/proc/meminfo'):
            try:
                meminfo = {}
                with open('/proc/meminfo', 'r') as f:
                    for line in f:
                        parts = line.split()
                        if len(parts) >= 2:
                            meminfo[parts[0].rstrip(':')] = int(parts[1]) * 1024
                total = meminfo.get('MemTotal', 0)
                free = meminfo.get('MemFree', 0)
                available = meminfo.get('MemAvailable', total - free)
                used = total - available
                percent = (used / total * 100) if total > 0 else 0
                return {
                    'total': total,
                    'available': available,
                    'used': used,
                    'percent_used': round(percent, 2),
                }
            except Exception:
                pass
                
        # Basic Fallback
        return {'total': 0, 'available': 0, 'used': 0, 'percent_used': 0}

    @staticmethod
    def run_diagnostics() -> dict:
        diagnostics = {}
        
        # 1. Database Reachability
        try:
            connection.ensure_connection()
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            diagnostics['database'] = 'healthy'
        except Exception as e:
            diagnostics['database'] = f'error: {str(e)}'
            
        # 2. Redis Reachability
        try:
            cache.set('diagnostic_ping', 'ok', timeout=5)
            val = cache.get('diagnostic_ping')
            diagnostics['redis'] = 'healthy' if val == 'ok' else 'corrupt'
        except Exception as e:
            diagnostics['redis'] = f'error: {str(e)}'
            
        # 3. Storage Reachability
        try:
            storage = StorageFactory.get_storage()
            storage.save('diagnostic_test.txt', BytesIO(b"diagnostic"))
            if storage.exists('diagnostic_test.txt'):
                storage.delete('diagnostic_test.txt')
                diagnostics['storage'] = 'healthy'
            else:
                diagnostics['storage'] = 'write_failed'
        except Exception as e:
            diagnostics['storage'] = f'error: {str(e)}'
            
        # 4. Celery
        try:
            app = Celery('adarsh')
            app.config_from_object('django.conf:settings', namespace='CELERY')
            workers = app.control.ping(timeout=0.3)
            diagnostics['celery'] = {
                'status': 'healthy' if workers else 'no_active_workers',
                'active_workers': len(workers) if workers else 0
            }
        except Exception as e:
            diagnostics['celery'] = f'error: {str(e)}'
            
        # 5. Disk Space
        try:
            usage = shutil.disk_usage(settings.BASE_DIR)
            diagnostics['disk'] = {
                'total': usage.total,
                'used': usage.used,
                'free': usage.free,
                'percent_used': round((usage.used / usage.total * 100), 2)
            }
        except Exception as e:
            diagnostics['disk'] = f'error: {str(e)}'
            
        # 6. Memory
        diagnostics['memory'] = EnvironmentDiagnosticService._get_system_memory()
        
        # 7. Environment Variables Checks
        essential_vars = [
            'SECRET_KEY', 'DATABASE_URL', 'REDIS_URL', 'STORAGE_PROVIDER'
        ]
        var_checks = {}
        for var in essential_vars:
            var_checks[var] = 'set' if getattr(settings, var, None) or var in os.environ else 'missing'
        diagnostics['environment_vars'] = var_checks
        
        return diagnostics

# ─── 5. Startup Diagnostic Service ────────────────────────────────────────────

class StartupDiagnosticService:
    @staticmethod
    def validate():
        """
        Verify: Database connection, Redis, Storage, folders and Migrations status.
        Raises ImproperlyConfigured to crash startup on critical issues.
        """
        # 1. Database connectivity
        try:
            connection.ensure_connection()
        except Exception as e:
            raise ImproperlyConfigured(f"Startup Blocked: Database is not reachable: {e}")
            
        # 2. Redis connectivity
        try:
            cache.set('startup_test', 'ok', timeout=5)
        except Exception as e:
            raise ImproperlyConfigured(f"Startup Blocked: Cache (Redis) is not reachable: {e}")
            
        # 3. Storage connectivity
        try:
            storage = StorageFactory.get_storage()
            storage.exists('test_startup.txt')
        except Exception as e:
            raise ImproperlyConfigured(f"Startup Blocked: Storage backend is not reachable: {e}")
            
        # 4. Folders existence check
        media_root = getattr(settings, 'MEDIA_ROOT', None)
        if media_root:
            if not os.path.exists(media_root):
                try:
                    os.makedirs(media_root, exist_ok=True)
                except Exception as e:
                    raise ImproperlyConfigured(f"Startup Blocked: MEDIA_ROOT directory does not exist and cannot be created: {e}")
                    
        # 5. Migrations Applied verification
        try:
            executor = MigrationExecutor(connections['default'])
            plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
            if plan:
                unapplied = [str(m[0]) for m in plan]
                raise ImproperlyConfigured(
                    f"Startup Blocked: There are unapplied database migrations: {', '.join(unapplied)}. Run migrations first."
                )
        except ImproperlyConfigured:
            raise
        except Exception as e:
            raise ImproperlyConfigured(f"Startup Blocked: Failed to check migration status: {e}")

# ─── 6. Deployment Validation Service ─────────────────────────────────────────

class DeploymentValidationService:
    @staticmethod
    def validate_deployment() -> dict:
        results = {}
        errors = []
        
        # 1. Static Files
        static_root = getattr(settings, 'STATIC_ROOT', None)
        if static_root and os.path.exists(static_root):
            results['static_files'] = 'ok'
        else:
            results['static_files'] = 'missing_or_uncreated'
            errors.append("Static files directory (STATIC_ROOT) does not exist.")
            
        # 2. Media Files
        media_root = getattr(settings, 'MEDIA_ROOT', None)
        if media_root and os.path.exists(media_root) and os.access(media_root, os.W_OK):
            results['media_files'] = 'ok'
        else:
            results['media_files'] = 'unwritable_or_missing'
            errors.append("Media root directory (MEDIA_ROOT) is missing or unwritable.")
            
        # 3. Celery worker connectivity
        try:
            app = Celery('adarsh')
            app.config_from_object('django.conf:settings', namespace='CELERY')
            workers = app.control.ping(timeout=0.3)
            if workers:
                results['celery_worker'] = 'ok'
            else:
                results['celery_worker'] = 'no_workers_found'
                errors.append("No active Celery workers found.")
        except Exception as e:
            results['celery_worker'] = f'error: {str(e)}'
            errors.append(f"Celery worker check failed: {str(e)}")
            
        # 4. Celery Beat check via heartbeat key in Cache
        beat_heartbeat = cache.get('celery_beat_heartbeat')
        if beat_heartbeat:
            results['celery_beat'] = 'ok'
        else:
            results['celery_beat'] = 'heartbeat_missing'
            errors.append("Celery Beat scheduler heartbeat key not found in cache.")
            
        # 5. Health Endpoints check
        from django.test import Client
        try:
            c = Client()
            response = c.get('/api/v1/health/live/')
            if response.status_code == 200:
                results['health_endpoints'] = 'ok'
            else:
                results['health_endpoints'] = f'failed_status_{response.status_code}'
                errors.append(f"Health endpoints check failed with HTTP {response.status_code}")
        except Exception as e:
            results['health_endpoints'] = f'error: {str(e)}'
            errors.append(f"Health endpoints view crash: {str(e)}")
            
        # Log Audit event
        _ops_audit(
            AuditEvent.DEPLOYMENT_VALIDATION,
            details={
                'results': results,
                'errors': errors,
                'status': 'passed' if not errors else 'failed'
            }
        )
        
        return {
            'status': 'passed' if not errors else 'failed',
            'results': results,
            'errors': errors
        }

# ─── 7. Migration Validation Service ──────────────────────────────────────────

class MigrationValidationService:
    @staticmethod
    def validate_migrations() -> dict:
        errors = []
        try:
            executor = MigrationExecutor(connections['default'])
            plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
            if plan:
                unapplied = [f"{m[0].app_label}.{m[0].name}" for m in plan]
                errors.append(f"Unapplied migrations exist: {', '.join(unapplied)}")
                
            conflicts = executor.loader.detect_conflicts()
            if conflicts:
                for app_label, conf in conflicts.items():
                    errors.append(f"Migration conflict in app '{app_label}' between leaves: {conf}")
        except Exception as e:
            errors.append(f"Migration database resolution error: {str(e)}")
            
        if errors:
            # Audit warning
            _ops_audit(
                AuditEvent.MIGRATION_WARNING,
                details={'errors': errors}
            )
            
        return {
            'status': 'healthy' if not errors else 'warning',
            'errors': errors
        }

# ─── 8. Disk Monitoring Health Service ────────────────────────────────────────

class DiskHealthService:
    @staticmethod
    def check_disk_health() -> dict:
        usage = shutil.disk_usage(settings.BASE_DIR)
        
        total = usage.total
        free = usage.free
        used = usage.used
        percent_free = (free / total) * 100
        
        # Save snapshot
        snapshot = DiskHealthSnapshot.objects.create(
            total_space=total,
            free_space=free,
            used_space=used
        )
        
        # Calculate growth rate (bytes/second) based on previous snapshot
        growth_rate = 0.0
        prev = DiskHealthSnapshot.objects.filter(timestamp__lt=snapshot.timestamp).order_by('-timestamp').first()
        if prev:
            time_diff = (snapshot.timestamp - prev.timestamp).total_seconds()
            if time_diff > 0:
                space_diff = snapshot.used_space - prev.used_space
                growth_rate = space_diff / time_diff # positive means disk is filling up
                
        # Trigger warnings
        # Critical if free space < 5% or free space < 2GB
        is_critical = percent_free < 5.0 or free < (2 * 1024 * 1024 * 1024)
        is_warning = percent_free < 15.0 or free < (10 * 1024 * 1024 * 1024)
        
        status_str = "healthy"
        if is_critical:
            status_str = "critical"
            _ops_audit(AuditEvent.DISK_WARNING, details={'level': 'CRITICAL', 'free_space_bytes': free, 'free_percent': percent_free})
        elif is_warning:
            status_str = "warning"
            _ops_audit(AuditEvent.DISK_WARNING, details={'level': 'WARNING', 'free_space_bytes': free, 'free_percent': percent_free})
            
        return {
            'status': status_str,
            'total_space': total,
            'free_space': free,
            'used_space': used,
            'percent_free': round(percent_free, 2),
            'growth_rate_bytes_per_sec': round(growth_rate, 4),
            'snapshot_id': str(snapshot.id)
        }

# ─── 9. Memory Monitoring Health Service ──────────────────────────────────────

class MemoryHealthService:
    @staticmethod
    def check_memory_health() -> dict:
        mem = EnvironmentDiagnosticService._get_system_memory()
        
        # Save snapshot
        snapshot = MemoryHealthSnapshot.objects.create(
            total_memory=mem['total'],
            available_memory=mem['available'],
            used_memory=mem['used']
        )
        
        status_str = "healthy"
        # Warning if physical memory usage > 90%
        if mem['percent_used'] > 90.0:
            status_str = "warning"
            _ops_audit(AuditEvent.MEMORY_WARNING, details={'percent_used': mem['percent_used'], 'total': mem['total'], 'available': mem['available']})
            
        return {
            'status': status_str,
            'total_memory': mem['total'],
            'available_memory': mem['available'],
            'used_memory': mem['used'],
            'percent_used': mem['percent_used'],
            'snapshot_id': str(snapshot.id)
        }
