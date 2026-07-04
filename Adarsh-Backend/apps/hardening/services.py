import os
import time
import uuid
import logging
from io import BytesIO
from django.db import connection, transaction
from django.core.cache import cache
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from celery import Celery

logger = logging.getLogger(__name__)

# ─── Database Health Service ──────────────────────────────────────────────────

class DatabaseHealthService:
    @staticmethod
    def check_health() -> dict:
        start_time = time.monotonic()
        details = {}
        try:
            # 1. Connection check
            connection.ensure_connection()
            details['connection'] = 'ok'
            
            # 2. Transaction, Read, Write check via temporary operations
            with transaction.atomic():
                with connection.cursor() as cursor:
                    # Create a temporary table check
                    cursor.execute("CREATE TEMPLATE TABLE..." if False else "CREATE TEMP TABLE django_health_temp (val VARCHAR(10))")
                    cursor.execute("INSERT INTO django_health_temp (val) VALUES ('ok')")
                    cursor.execute("SELECT val FROM django_health_temp")
                    row = cursor.fetchone()
                    if not row or row[0] != 'ok':
                        raise ValueError("Read/Write integrity check failed.")
                    cursor.execute("DROP TABLE django_health_temp")
            
            details['read'] = 'ok'
            details['write'] = 'ok'
            details['transaction'] = 'ok'
            
            latency = (time.monotonic() - start_time) * 1000
            return {
                'status': 'ok',
                'latency_ms': latency,
                'details': details
            }
        except Exception as e:
            latency = (time.monotonic() - start_time) * 1000
            logger.error(f"Database health check failed: {e}", exc_info=True)
            return {
                'status': 'error',
                'latency_ms': latency,
                'details': {**details, 'error': str(e)}
            }

# ─── Redis Health Service ─────────────────────────────────────────────────────

class RedisHealthService:
    @staticmethod
    def check_health() -> dict:
        start_time = time.monotonic()
        key = f"health_redis_{uuid.uuid4().hex}"
        try:
            # Connection + Write check
            cache.set(key, 'ok', timeout=5)
            # Read check
            val = cache.get(key)
            # Delete check
            cache.delete(key)
            
            if val != 'ok':
                raise ValueError("Cache read value did not match written value.")
                
            latency = (time.monotonic() - start_time) * 1000
            return {
                'status': 'ok',
                'latency_ms': latency,
                'details': {
                    'connection': 'ok',
                    'read': 'ok',
                    'write': 'ok',
                }
            }
        except Exception as e:
            latency = (time.monotonic() - start_time) * 1000
            logger.error(f"Redis health check failed: {e}", exc_info=True)
            return {
                'status': 'error',
                'latency_ms': latency,
                'details': {'error': str(e)}
            }

# ─── Celery Health Service ────────────────────────────────────────────────────

class CeleryHealthService:
    @staticmethod
    def check_health() -> dict:
        start_time = time.monotonic()
        details = {}
        try:
            from config.celery import app
            
            # 1. Worker Alive (ping check)
            ping_data = app.control.ping(timeout=0.3)
            if not ping_data:
                details['worker_alive'] = 'failed'
                details['worker_count'] = 0
            else:
                details['worker_alive'] = 'ok'
                details['worker_count'] = len(ping_data)
            
            # 2. End-to-end task execution & result retrieval test
            # Import task dynamically to avoid circular references
            from apps.hardening.tasks import health_ping_task
            
            task_start = time.monotonic()
            result = health_ping_task.delay()
            
            # Wait for execution and result retrieval
            val = result.get(timeout=2.0)
            if val != 'pong':
                raise ValueError(f"Unexpected task result: {val}")
                
            details['queue_access'] = 'ok'
            details['task_execution'] = 'ok'
            details['task_result_retrieval'] = 'ok'
            details['task_latency_ms'] = (time.monotonic() - task_start) * 1000
            
            latency = (time.monotonic() - start_time) * 1000
            return {
                'status': 'ok',
                'latency_ms': latency,
                'details': details
            }
        except Exception as e:
            latency = (time.monotonic() - start_time) * 1000
            logger.error(f"Celery health check failed: {e}", exc_info=True)
            return {
                'status': 'error',
                'latency_ms': latency,
                'details': {**details, 'error': str(e)}
            }

# ─── Storage Health Service ───────────────────────────────────────────────────

class StorageHealthService:
    @staticmethod
    def check_health(provider_type: str = None) -> dict:
        from apps.mediafiles.storage.factory import StorageFactory
        
        start_time = time.monotonic()
        provider_type = provider_type or getattr(settings, 'STORAGE_PROVIDER', 'local')
        details = {'provider': provider_type}
        
        test_filename = f"health_check_test_{uuid.uuid4().hex}.txt"
        test_content = b"health_check_content"
        
        try:
            storage = StorageFactory.get_storage(provider_type)
            
            # 1. Write Check
            storage.save(test_filename, BytesIO(test_content))
            details['write'] = 'ok'
            
            # Exists Check
            if not storage.exists(test_filename):
                raise FileNotFoundError("Storage save succeeded but file exists check failed.")
                
            # 2. Read Check
            # Read method might be named read() or we fetch it
            if hasattr(storage, 'read'):
                content = storage.read(test_filename)
                if content != test_content:
                    raise ValueError("File content read mismatch.")
                details['read'] = 'ok'
            else:
                details['read'] = 'skipped (read method not implemented on provider)'
                
            # 3. Signed URL Check
            url = storage.url(test_filename)
            if not url or not isinstance(url, str):
                raise ValueError("Failed to generate a valid signed/public URL.")
            details['signed_url'] = 'ok'
            
            # 4. Delete Check
            storage.delete(test_filename)
            details['delete'] = 'ok'
            
            # Verify deleted
            if storage.exists(test_filename):
                raise ValueError("Delete succeeded but file still exists.")
                
            latency = (time.monotonic() - start_time) * 1000
            return {
                'status': 'ok',
                'latency_ms': latency,
                'details': details
            }
        except Exception as e:
            latency = (time.monotonic() - start_time) * 1000
            logger.error(f"Storage ({provider_type}) health check failed: {e}", exc_info=True)
            
            # Cleanup just in case
            try:
                storage = StorageFactory.get_storage(provider_type)
                storage.delete(test_filename)
            except Exception:
                pass
                
            return {
                'status': 'error',
                'latency_ms': latency,
                'details': {**details, 'error': str(e)}
            }

# ─── Startup Validation ────────────────────────────────────────────────────────

class EnvironmentValidator:
    @staticmethod
    def validate():
        """Ensure all required environment variables are set."""
        required = [
            'SECRET_KEY',
            'DATABASE_URL',
            'REDIS_URL',
            'STORAGE_PROVIDER',
            'CELERY_BROKER_URL'
        ]
        missing = []
        for var in required:
            # We check via settings or os.environ
            if not getattr(settings, var, None):
                # Check if it exists in environment directly
                if var not in os.environ:
                    missing.append(var)
        if missing:
            raise ImproperlyConfigured(
                f"Missing critical environment variables: {', '.join(missing)}. "
                "Ensure these are defined in your .env file or host environment."
            )

class ConfigurationValidator:
    @staticmethod
    def validate():
        """Ensure all configuration settings are correct."""
        # 1. SECRET_KEY security check
        secret_key = getattr(settings, 'SECRET_KEY', '')
        if not secret_key or len(secret_key) < 16 or 'unsafe' in secret_key.lower():
            raise ImproperlyConfigured("SECRET_KEY is insecure or too short.")
            
        # 2. STORAGE_PROVIDER check
        provider = getattr(settings, 'STORAGE_PROVIDER', '').lower()
        if provider not in ['local', 'r2', 'minio']:
            raise ImproperlyConfigured(
                f"Invalid STORAGE_PROVIDER: '{provider}'. Must be one of: local, r2, minio."
            )
            
        # 3. Required Directories existence check
        # Check media directory
        media_root = getattr(settings, 'MEDIA_ROOT', None)
        if not media_root:
            # Try to build default media path if missing
            media_root = os.path.join(settings.BASE_DIR, 'media')
            
        try:
            os.makedirs(media_root, exist_ok=True)
            if not os.access(media_root, os.W_OK):
                raise PermissionError()
        except Exception as e:
            raise ImproperlyConfigured(
                f"Required directory MEDIA_ROOT at '{media_root}' is not writable or cannot be created: {e}"
            )

class StartupValidator:
    @staticmethod
    def validate():
        """Execute all validators on startup."""
        EnvironmentValidator.validate()
        ConfigurationValidator.validate()
        logger.info("Startup validation completed successfully. All envs and directories validated.")
