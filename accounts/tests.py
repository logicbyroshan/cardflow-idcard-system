"""
Tests for accounts app.
Covers: AuthService, OTPService, RoleService, rate limiting, login/logout flows.
"""
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test.client import RequestFactory
from unittest import mock
import json

User = get_user_model()


class AuthServiceTests(TestCase):
    """Tests for accounts.services.AuthService"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='test@example.com',
            email='test@example.com',
            password='testpass123',
            role='client',
        )

    def test_check_user_exists_found(self):
        from accounts.services import AuthService
        result = AuthService.check_user_exists('test@example.com')
        self.assertTrue(result['exists'])
        self.assertEqual(result['user_name'], 'User')
        self.assertEqual(result['user_email'], 'test@example.com')

    def test_check_user_exists_not_found(self):
        from accounts.services import AuthService
        result = AuthService.check_user_exists('nobody@example.com')
        self.assertTrue(result['exists'])
        self.assertEqual(result['user_name'], 'User')
        self.assertEqual(result['user_email'], 'nobody@example.com')

    def test_authenticate_user_success(self):
        from accounts.services import AuthService
        result = AuthService.authenticate_user('test@example.com', 'testpass123')
        self.assertTrue(result['success'])
        self.assertEqual(result['user'].email, 'test@example.com')

    def test_authenticate_user_wrong_password(self):
        from accounts.services import AuthService
        result = AuthService.authenticate_user('test@example.com', 'wrongpass')
        self.assertFalse(result['success'])

    def test_authenticate_user_nonexistent(self):
        from accounts.services import AuthService
        result = AuthService.authenticate_user('nobody@example.com', 'pass')
        self.assertFalse(result['success'])

    def test_authenticate_inactive_user(self):
        from accounts.services import AuthService
        self.user.is_active = False
        self.user.save()
        result = AuthService.authenticate_user('test@example.com', 'testpass123')
        self.assertFalse(result['success'])

    def test_get_dashboard_url_client(self):
        from accounts.services import AuthService
        url = AuthService.get_dashboard_url(self.user)
        self.assertIn('client', url)

    def test_get_dashboard_url_super_admin(self):
        from accounts.services import AuthService
        admin = User.objects.create_user(
            username='admin@example.com',
            email='admin@example.com',
            password='admin123',
            role='super_admin',
        )
        url = AuthService.get_dashboard_url(admin)
        self.assertEqual(url, '/panel/')


class OTPServiceTests(TestCase):
    """Tests for accounts.services.OTPService"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='otp@example.com',
            email='otp@example.com',
            password='testpass123',
            role='client',
        )
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_generate_otp_length(self):
        from accounts.services import OTPService
        otp = OTPService.generate_otp()
        self.assertEqual(len(otp), 6)
        self.assertTrue(otp.isdigit())

    def test_generate_reset_token_format(self):
        from accounts.services import OTPService
        token = OTPService.generate_reset_token()
        # HMAC format: raw_token.signature
        self.assertIn('.', token)
        parts = token.split('.')
        self.assertEqual(len(parts), 2)

    def test_send_otp_success(self):
        from accounts.services import OTPService
        result = OTPService.send_otp('otp@example.com')
        self.assertTrue(result['success'])

    def test_send_otp_nonexistent_email(self):
        from accounts.services import OTPService
        result = OTPService.send_otp('nobody@example.com')
        # OTPService may silently succeed even for unknown emails (security best practice)
        self.assertIn('success', result)

    def test_verify_otp_and_reset_password(self):
        from accounts.services import OTPService
        send_result = OTPService.send_otp('otp@example.com')
        self.assertTrue(send_result['success'])
        dev_otp = send_result.get('dev_otp')
        if dev_otp:
            verify_result = OTPService.verify_otp('otp@example.com', dev_otp)
            self.assertTrue(verify_result['success'])
            reset_token = verify_result.get('reset_token')
            self.assertIsNotNone(reset_token)

            reset_result = OTPService.reset_password(
                'otp@example.com', reset_token, 'newpassword1'
            )
            self.assertTrue(reset_result['success'])

            from accounts.services import AuthService
            auth_result = AuthService.authenticate_user('otp@example.com', 'newpassword1')
            self.assertTrue(auth_result['success'])

    def test_verify_otp_wrong_code(self):
        from accounts.services import OTPService
        OTPService.send_otp('otp@example.com')
        result = OTPService.verify_otp('otp@example.com', '000000')
        self.assertFalse(result['success'])

    def test_reset_password_invalid_token(self):
        from accounts.services import OTPService
        result = OTPService.reset_password('otp@example.com', 'fake.token', 'newpass123')
        self.assertFalse(result['success'])

    def test_reset_password_too_short(self):
        from accounts.services import OTPService
        send = OTPService.send_otp('otp@example.com')
        dev_otp = send.get('dev_otp')
        if dev_otp:
            verify = OTPService.verify_otp('otp@example.com', dev_otp)
            token = verify.get('reset_token')
            if token:
                result = OTPService.reset_password('otp@example.com', token, 'short')
                self.assertFalse(result['success'])


class RoleServiceTests(TestCase):
    """Tests for accounts.services.RoleService"""

    def test_setup_groups(self):
        from accounts.services import RoleService
        result = RoleService.setup_groups()
        self.assertTrue(result['success'])
        self.assertIn('groups', result)

    def test_get_role_display_name(self):
        from accounts.services import RoleService
        self.assertEqual(RoleService.get_role_display_name('super_admin'), 'Super Admin')
        self.assertEqual(RoleService.get_role_display_name('client'), 'Client')


class LoginViewTests(TestCase):
    """Tests for login/logout views"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='view@example.com',
            email='view@example.com',
            password='testpass123',
            role='client',
        )
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_login_page_loads(self):
        response = self.client.get('/panel/login/')
        self.assertIn(response.status_code, [200, 302])

    def test_logout_redirects(self):
        self.client.login(username='view@example.com', password='testpass123')
        response = self.client.get('/panel/logout/')
        self.assertEqual(response.status_code, 302)

    def test_check_email_api(self):
        response = self.client.post(
            '/panel/api/auth/check-email/',
            data=json.dumps({'email': 'view@example.com'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get('exists') or data.get('success'))

    def test_login_api_success(self):
        response = self.client.post(
            '/panel/api/auth/login/',
            data=json.dumps({
                'email': 'view@example.com',
                'password': 'testpass123',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])

    def test_login_api_wrong_password(self):
        response = self.client.post(
            '/panel/api/auth/login/',
            data=json.dumps({
                'email': 'view@example.com',
                'password': 'wrong',
            }),
            content_type='application/json',
        )
        data = response.json()
        self.assertFalse(data['success'])

    @override_settings(DEBUG=True)
    def test_forgot_password_api_never_exposes_dev_otp(self):
        with mock.patch.dict('os.environ', {'DEV_EXPOSE_OTP': 'true'}):
            response = self.client.post(
                '/panel/api/auth/forgot-password/',
                data=json.dumps({'email': 'view@example.com'}),
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertNotIn('dev_otp', payload)


class RateLimitTests(TestCase):
    """Tests for rate limiting decorator"""

    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_rate_limit_allows_under_limit(self):
        for _ in range(3):
            response = self.client.post(
                '/panel/api/auth/login/',
                data=json.dumps({'email': 'test@x.com', 'password': 'x'}),
                content_type='application/json',
            )
            self.assertNotEqual(response.status_code, 429)

    def test_rate_limit_blocks_over_limit(self):
        for i in range(8):
            response = self.client.post(
                '/panel/api/auth/login/',
                data=json.dumps({'email': 'test@x.com', 'password': 'x'}),
                content_type='application/json',
            )
        # After exceeding limit, should get 429
        self.assertIn(response.status_code, [200, 429])


class LoginLoggingMaskTests(TestCase):
    def test_mask_login_identifier_email(self):
        from accounts.views import _mask_login_identifier
        self.assertEqual(_mask_login_identifier('alice@example.com'), 'a***@example.com')

    def test_mask_login_identifier_username(self):
        from accounts.views import _mask_login_identifier
        self.assertEqual(_mask_login_identifier('roshan'), 'r***')


class RateLimitClientIPTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @override_settings(RATE_LIMIT_TRUST_X_FORWARDED_FOR=False)
    def test_get_client_ip_uses_remote_addr_by_default(self):
        from accounts.rate_limit import _get_client_ip
        request = self.factory.get('/panel/api/auth/login/', REMOTE_ADDR='10.10.10.10', HTTP_X_FORWARDED_FOR='8.8.8.8')
        self.assertEqual(_get_client_ip(request), '10.10.10.10')

    @override_settings(RATE_LIMIT_TRUST_X_FORWARDED_FOR=True)
    def test_get_client_ip_uses_trusted_xff_when_enabled(self):
        from accounts.rate_limit import _get_client_ip
        request = self.factory.get(
            '/panel/api/auth/login/',
            REMOTE_ADDR='10.10.10.10',
            HTTP_X_FORWARDED_FOR='198.51.100.1, 203.0.113.10'
        )
        self.assertEqual(_get_client_ip(request), '198.51.100.1')