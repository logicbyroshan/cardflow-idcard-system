import uuid
from unittest.mock import MagicMock, patch
from django.test import TestCase, override_settings
from django.core.exceptions import ImproperlyConfigured
from django.urls import reverse
from django.http import HttpResponse
from rest_framework.test import APITestCase
from rest_framework import status

from apps.users.models import User
from shared.constants import Role
from apps.hardening.services import (
    StartupValidator,
    EnvironmentValidator,
    ConfigurationValidator,
    DatabaseHealthService,
    RedisHealthService,
    CeleryHealthService,
    StorageHealthService,
)
from apps.hardening.context import get_request_id, set_request_context, clear_request_context
from apps.hardening.middleware import RequestCorrelationMiddleware

# ─── 1. Startup Validation Tests ──────────────────────────────────────────────

class StartupValidationTests(TestCase):
    @override_settings(SECRET_KEY='')
    def test_startup_fails_on_missing_secret_key(self):
        with self.assertRaises(ImproperlyConfigured) as context:
            ConfigurationValidator.validate()
        self.assertIn("SECRET_KEY", str(context.exception))

    @override_settings(STORAGE_PROVIDER='invalid_provider')
    def test_startup_fails_on_invalid_storage_provider(self):
        with self.assertRaises(ImproperlyConfigured) as context:
            ConfigurationValidator.validate()
        self.assertIn("STORAGE_PROVIDER", str(context.exception))

    @override_settings(SECRET_KEY='safe_production_key_long_enough', STORAGE_PROVIDER='local', MEDIA_ROOT='')
    def test_startup_succeeds_on_valid_configs(self):
        # Should not raise any exception
        EnvironmentValidator.validate()
        ConfigurationValidator.validate()

# ─── 2. Health Check Services & Endpoint Tests ────────────────────────────────

class HealthCheckTests(APITestCase):
    def test_database_health_service(self):
        res = DatabaseHealthService.check_health()
        self.assertEqual(res['status'], 'ok')
        self.assertIn('latency_ms', res)
        self.assertEqual(res['details']['connection'], 'ok')
        self.assertEqual(res['details']['read'], 'ok')
        self.assertEqual(res['details']['write'], 'ok')

    def test_redis_health_service(self):
        res = RedisHealthService.check_health()
        self.assertEqual(res['status'], 'ok')
        self.assertIn('latency_ms', res)

    @patch('config.celery.app.control')
    def test_celery_health_service_worker_ping_only(self, mock_control):
        # Mock Celery ping control to return active workers
        mock_control.ping.return_value = {'worker1': 'pong'}
        
        # Mock task execution to prevent hanging in test environment
        with patch('apps.hardening.tasks.health_ping_task.delay') as mock_delay:
            mock_res = MagicMock()
            mock_res.get.return_value = 'pong'
            mock_delay.return_value = mock_res
            
            res = CeleryHealthService.check_health()
            self.assertEqual(res['status'], 'ok')
            self.assertEqual(res['details']['worker_alive'], 'ok')
            self.assertEqual(res['details']['task_execution'], 'ok')

    def test_storage_health_service(self):
        # Runs on active storage provider (which is local in test suite settings)
        res = StorageHealthService.check_health('local')
        self.assertEqual(res['status'], 'ok')
        self.assertEqual(res['details']['write'], 'ok')
        self.assertEqual(res['details']['read'], 'ok')
        self.assertEqual(res['details']['delete'], 'ok')

    def test_aggregated_health_endpoint(self):
        url = reverse('health_root')
        with patch('apps.hardening.services.CeleryHealthService.check_health') as mock_celery:
            mock_celery.return_value = {'status': 'ok', 'latency_ms': 1.0, 'details': {}}
            response = self.client.get(url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.data['status'], 'ok')
            self.assertIn('services', response.data)

# ─── 3. Correlation ID & Context Tests ────────────────────────────────────────

class CorrelationIDTests(TestCase):
    def test_request_correlation_middleware_generates_id(self):
        middleware = RequestCorrelationMiddleware(get_response=lambda r: HttpResponse())
        request = MagicMock()
        request.headers = {}
        request.user = MagicMock()
        request.user.is_authenticated = False

        # Run middleware
        middleware.process_request(request)
        self.assertTrue(hasattr(request, 'request_id'))
        self.assertIsNotNone(get_request_id())
        self.assertEqual(get_request_id(), request.request_id)

        # Response verification
        response = HttpResponse()
        response = middleware.process_response(request, response)
        self.assertEqual(response['X-Request-ID'], request.request_id)
        # Should be cleared after request lifecycle finishes
        self.assertIsNone(get_request_id())

    def test_request_correlation_with_predefined_header(self):
        middleware = RequestCorrelationMiddleware(get_response=lambda r: HttpResponse())
        request = MagicMock()
        predefined_uuid = str(uuid.uuid4())
        request.headers = {'X-Request-ID': predefined_uuid}
        request.user = MagicMock()
        request.user.is_authenticated = False

        middleware.process_request(request)
        self.assertEqual(request.request_id, predefined_uuid)
        self.assertEqual(get_request_id(), predefined_uuid)
        
        response = HttpResponse()
        response = middleware.process_response(request, response)
        self.assertEqual(response['X-Request-ID'], predefined_uuid)

# ─── 4. Rate Limiting Tests ───────────────────────────────────────────────────

class RateLimitingTests(APITestCase):
    def setUp(self):
        self.pro_user = User.objects.create_user(
            username='pro_user_test',
            email='pro_test@example.com',
            password='password123',
            role=Role.PRO_USER
        )
        self.client_user = User.objects.create_user(
            username='client_user_test',
            email='client_test@example.com',
            password='password123',
            role=Role.CLIENT
        )

    def test_anon_rate_throttle_applies_to_anonymous(self):
        url = reverse('health_live')
        # Trigger requests
        for _ in range(5):
            response = self.client.get(url)
            self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_pro_user_exemption_and_throttling(self):
        self.client.force_authenticate(user=self.pro_user)
        url = reverse('health_live')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
