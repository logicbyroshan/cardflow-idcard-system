import json
import hashlib
from unittest import mock
from datetime import timedelta
from pathlib import Path
from io import StringIO

from django.contrib.auth import get_user_model
from django.contrib.sessions.backends.db import SessionStore
from django.test import TestCase, override_settings
from django.core.management.base import CommandError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone

from client.models import Client
from idcards.models import IDCard, IDCardGroup, IDCardTable
from staff.models import Staff
from website.models import PortfolioCategory, PortfolioItem
from mobile_app.models import MobileDevice


User = get_user_model()


class MobileAppBaseTestCase(TestCase):
	def setUp(self):
		# Keep test client aligned with mobile-only server-side gating.
		self.client.defaults['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobile Safari/537.36'

		self.super_admin = User.objects.create_user(
			username='mob-super@test.com',
			email='mob-super@test.com',
			password='pass1234',
			role='super_admin',
		)

		self.pro_user = User.objects.create_user(
			username='mob-pro@test.com',
			email='mob-pro@test.com',
			password='pass1234',
			role='pro_user',
		)

		self.client_user = User.objects.create_user(
			username='mob-client@test.com',
			email='mob-client@test.com',
			password='pass1234',
			role='client',
		)
		self.client_profile = Client.objects.create(
			user=self.client_user,
			name='Mobile Client',
			status='active',
			perm_mobile_app=True,
			perm_idcard_pending_list=True,
			perm_idcard_add=False,
			perm_idcard_edit=False,
			perm_idcard_delete=False,
		)

		self.client_user_with_add_perm = User.objects.create_user(
			username='mob-client-add@test.com',
			email='mob-client-add@test.com',
			password='pass1234',
			role='client',
		)
		self.client_profile_with_add_perm = Client.objects.create(
			user=self.client_user_with_add_perm,
			name='Mobile Client Add',
			status='active',
			perm_mobile_app=True,
			perm_idcard_pending_list=True,
			perm_idcard_add=True,
			perm_idcard_edit=True,
			perm_idcard_delete=True,
		)

		self.admin_staff_user = User.objects.create_user(
			username='mob-admin-staff@test.com',
			email='mob-admin-staff@test.com',
			password='pass1234',
			role='admin_staff',
		)
		self.admin_staff_profile = Staff.objects.create(
			user=self.admin_staff_user,
			staff_type='admin_staff',
			perm_mobile_app=True,
			perm_idcard_pending_list=True,
		)

		self.admin_staff_manage_user = User.objects.create_user(
			username='mob-admin-manage@test.com',
			email='mob-admin-manage@test.com',
			password='pass1234',
			role='admin_staff',
		)
		self.admin_staff_manage_profile = Staff.objects.create(
			user=self.admin_staff_manage_user,
			staff_type='admin_staff',
			perm_mobile_app=True,
			perm_idcard_pending_list=True,
			perm_idcard_client_list=True,
		)

		self.group = IDCardGroup.objects.create(client=self.client_profile, name='Group A')
		self.table = IDCardTable.objects.create(
			group=self.group,
			name='Table A',
			fields=[
				{'name': 'NAME', 'type': 'text', 'order': 0},
				{'name': 'ROLL NO', 'type': 'text', 'order': 1},
			],
			is_active=True,
		)
		self.card = IDCard.objects.create(
			table=self.table,
			field_data={'NAME': 'Student One', 'ROLL NO': '101'},
			status='pending',
		)
		self.admin_staff_manage_profile.assigned_clients.add(self.client_profile)

		self.client_staff_user = User.objects.create_user(
			username='mob-client-staff@test.com',
			email='mob-client-staff@test.com',
			password='pass1234',
			role='client_staff',
		)
		self.client_staff_profile = Staff.objects.create(
			user=self.client_staff_user,
			staff_type='client_staff',
			client=self.client_profile,
			perm_mobile_app=True,
			perm_idcard_pending_list=True,
		)

	def _set_mobile_auth_checkpoint(self):
		session = self.client.session
		session['mobile_auth_ok'] = True
		session.save()

	def _login_mobile_super_admin(self):
		self.client.login(username='mob-super@test.com', password='pass1234')
		self._set_mobile_auth_checkpoint()

	def _login_mobile_pro_user(self):
		self.client.login(username='mob-pro@test.com', password='pass1234')
		self._set_mobile_auth_checkpoint()

	def _login_mobile_client(self):
		self.client.login(username='mob-client@test.com', password='pass1234')
		self._set_mobile_auth_checkpoint()

	def _login_mobile_admin_staff(self):
		self.client.login(username='mob-admin-staff@test.com', password='pass1234')
		self._set_mobile_auth_checkpoint()

	def _login_mobile_admin_staff_manager(self):
		self.client.login(username='mob-admin-manage@test.com', password='pass1234')
		self._set_mobile_auth_checkpoint()

	def _login_mobile_client_with_add_perm(self):
		self.client.login(username='mob-client-add@test.com', password='pass1234')
		self._set_mobile_auth_checkpoint()

	def _login_mobile_client_staff(self):
		self.client.login(username='mob-client-staff@test.com', password='pass1234')
		self._set_mobile_auth_checkpoint()

	def _create_authenticated_session_for_user(self, user, *, surface='desktop', mobile_auth_ok=False, browser_fp=''):
		session = SessionStore()
		session['_auth_user_id'] = str(user.pk)
		session['_auth_user_backend'] = 'django.contrib.auth.backends.ModelBackend'
		session['_auth_user_hash'] = user.get_session_auth_hash()
		session['_auth_login_surface'] = surface
		if browser_fp:
			session['_auth_browser_fp'] = browser_fp
		if mobile_auth_ok or surface == 'mobile':
			session['mobile_auth_ok'] = True
		session.save()
		return session.session_key

	def _enable_mobile_photo_edit_for_all_roles(self):
		"""Ensure every test role can open camera/upload flows on the same table."""
		self.client_profile.perm_idcard_edit = True
		self.client_profile.save(update_fields=['perm_idcard_edit'])

		self.client_staff_profile.perm_idcard_edit = True
		self.client_staff_profile.save(update_fields=['perm_idcard_edit'])
		self.client_staff_profile.assigned_groups.set([self.group])

		self.admin_staff_profile.perm_idcard_edit = True
		self.admin_staff_profile.save(update_fields=['perm_idcard_edit'])
		self.admin_staff_profile.assigned_clients.set([self.client_profile])


class MobileAppPwaAndAuthTests(MobileAppBaseTestCase):
	def test_manifest_endpoint_returns_pwa_payload(self):
		response = self.client.get('/app/manifest.json')
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response['Content-Type'], 'application/manifest+json')
		payload = response.json()
		self.assertEqual(payload['start_url'], '/app/')
		self.assertIn('icons', payload)

	def test_service_worker_endpoint_returns_expected_headers(self):
		response = self.client.get('/app/sw.js')
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response['Service-Worker-Allowed'], '/app/')
		self.assertIn('application/javascript', response['Content-Type'])
		content = response.content.decode('utf-8')
		self.assertIn("const CACHE_GROUP = 'adarsh-mobile';", content)
		self.assertIn('const CACHE_NAMESPACE = ', content)
		self.assertIn('const ONLINE_REQUIRED_PREFIXES = ', content)
		self.assertIn("/static/css/vendor/webfonts/fa-solid-900.woff2", content)

	def test_mobile_page_redirects_without_mobile_auth_checkpoint(self):
		self.client.login(username='mob-super@test.com', password='pass1234')
		response = self.client.get('/app/')
		self.assertEqual(response.status_code, 302)
		self.assertIn('/app/login/', response.url)

	def test_mobile_api_returns_401_without_mobile_auth_checkpoint(self):
		self.client.login(username='mob-super@test.com', password='pass1234')
		response = self.client.get('/app/api/server-info/')
		self.assertEqual(response.status_code, 401)
		self.assertFalse(response.json()['success'])
		self.assertTrue(response.json()['mobile_auth_required'])

	def test_mobile_login_rejects_invalid_json(self):
		response = self.client.post(
			'/app/api/auth/login/',
			data='bad-json',
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)
		self.assertFalse(response.json()['success'])

	@mock.patch('mobile_app.views.ActivityService.log_login')
	@mock.patch('mobile_app.views.AuthService.authenticate_user')
	def test_mobile_login_success_sets_mobile_auth_checkpoint(self, mock_authenticate, mock_log_login):
		mock_authenticate.return_value = {
			'success': True,
			'user': self.client_user,
			'message': 'ok',
		}

		response = self.client.post(
			'/app/api/auth/login/',
			data=json.dumps({'email': 'mob-client@test.com', 'password': 'pass1234', 'role': 'client'}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		self.assertEqual(self.client.session.get('mobile_auth_ok'), True)
		mock_log_login.assert_called_once()

	@mock.patch('mobile_app.views.ActivityService.log_login')
	@mock.patch('mobile_app.views.AuthService.authenticate_user')
	def test_mobile_login_allows_client_when_desktop_session_exists(self, mock_authenticate, mock_log_login):
		self._create_authenticated_session_for_user(self.client_user, surface='desktop')
		mock_authenticate.return_value = {
			'success': True,
			'user': self.client_user,
			'message': 'ok',
		}

		response = self.client.post(
			'/app/api/auth/login/',
			data=json.dumps({'email': 'mob-client@test.com', 'password': 'pass1234'}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		mock_log_login.assert_called_once()

	@mock.patch('mobile_app.views.ActivityService.log_login')
	@mock.patch('mobile_app.views.AuthService.authenticate_user')
	def test_mobile_login_blocks_client_when_mobile_session_limit_reached(self, mock_authenticate, mock_log_login):
		self._create_authenticated_session_for_user(self.client_user, surface='mobile', mobile_auth_ok=True)
		mock_authenticate.return_value = {
			'success': True,
			'user': self.client_user,
			'message': 'ok',
		}

		response = self.client.post(
			'/app/api/auth/login/',
			data=json.dumps({'email': 'mob-client@test.com', 'password': 'pass1234'}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertFalse(response.json()['success'])
		self.assertTrue(response.json().get('session_limit_hit'))
		self.assertTrue(response.json().get('can_force_logout_other'))
		self.assertIn('Maximum 1 active mobile login', response.json().get('message', ''))
		mock_log_login.assert_not_called()

	@mock.patch('mobile_app.views.ActivityService.log_login')
	@mock.patch('mobile_app.views.AuthService.authenticate_user')
	def test_mobile_login_force_logout_other_device_allows_handoff(self, mock_authenticate, mock_log_login):
		from accounts.services import AuthService

		self._create_authenticated_session_for_user(self.client_user, surface='mobile', mobile_auth_ok=True)
		mock_authenticate.return_value = {
			'success': True,
			'user': self.client_user,
			'message': 'ok',
		}

		response = self.client.post(
			'/app/api/auth/login/',
			data=json.dumps({
				'email': 'mob-client@test.com',
				'password': 'pass1234',
				'force_logout_other': True,
			}),
			content_type='application/json',
			HTTP_USER_AGENT='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36',
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])

		inspection = AuthService.inspect_active_sessions_for_user(self.client_user.id)
		surface_counts = inspection.get('surface_counts') or {}
		self.assertEqual(int(surface_counts.get('mobile', 0) or 0), 1)
		mock_log_login.assert_called_once()

	def test_mobile_login_redirects_to_no_access_when_no_active_client_exists(self):
		self._login_mobile_super_admin()
		Client.objects.update(status='inactive')

		home_response = self.client.get('/app/')
		self.assertEqual(home_response.status_code, 302)
		self.assertIn('/app/no-access/?reason=no-client-context', home_response.url)

		login_response = self.client.get('/app/login/', follow=True)
		self.assertGreaterEqual(len(login_response.redirect_chain), 1)
		self.assertEqual(login_response.redirect_chain[0][0], '/app/no-access/?reason=no-client-context')
		self.assertEqual(login_response.status_code, 403)


class MobileAppShellApiTests(MobileAppBaseTestCase):
	def test_mobile_shell_config_returns_policy_payload(self):
		self._login_mobile_client()
		response = self.client.get('/app/api/mobile-shell/config/?app_build=1')

		self.assertEqual(response.status_code, 200)
		body = response.json()
		self.assertTrue(body.get('success'))
		self.assertEqual(body['data']['platform'], 'android')
		self.assertIn('min_supported_build', body['data'])
		self.assertIn('update_url', body['data'])
		self.assertIn('push_enabled', body['data'])
		self.assertFalse(body['data']['push_enabled'])
		self.assertIn('/static/website/apk/adarsh-admin.apk', body['data'].get('update_url', ''))

	@override_settings(MOBILE_SHELL_ANDROID_UPDATE_URL='https://downloads.example.com/adarsh-admin.apk')
	def test_mobile_shell_config_uses_explicit_update_url_when_configured(self):
		self._login_mobile_client()
		response = self.client.get('/app/api/mobile-shell/config/?app_build=10')

		self.assertEqual(response.status_code, 200)
		body = response.json()
		self.assertEqual(
			body['data'].get('update_url'),
			'https://downloads.example.com/adarsh-admin.apk',
		)

	def test_mobile_shell_register_upserts_device(self):
		self._login_mobile_client()
		payload = {
			'platform': 'android',
			'installation_id': 'inst-test-0001',
			'app_build': 12,
			'app_version': '1.2.0',
			'device_model': 'Pixel 7',
			'os_version': '14',
			'device_language': 'en',
		}

		response = self.client.post(
			'/app/api/mobile-shell/device/register/',
			data=json.dumps(payload),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])

		device = MobileDevice.objects.get(user=self.client_user, platform='android', installation_id='inst-test-0001')
		self.assertEqual(device.app_build, 12)
		self.assertEqual(device.app_version, '1.2.0')

		payload['app_build'] = 13
		payload['app_version'] = '1.3.0'
		response2 = self.client.post(
			'/app/api/mobile-shell/device/register/',
			data=json.dumps(payload),
			content_type='application/json',
		)
		self.assertEqual(response2.status_code, 200)
		device.refresh_from_db()
		self.assertEqual(device.app_build, 13)
		self.assertEqual(device.app_version, '1.3.0')

	def test_mobile_shell_ping_creates_record_when_missing(self):
		self._login_mobile_client()
		payload = {
			'installation_id': 'inst-ping-0002',
			'app_build': 3,
			'app_version': '1.0.3',
		}
		response = self.client.post(
			'/app/api/mobile-shell/device/ping/',
			data=json.dumps(payload),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(MobileDevice.objects.filter(user=self.client_user, installation_id='inst-ping-0002').exists())

	def test_mobile_shell_register_rejects_invalid_installation_id(self):
		self._login_mobile_client()
		response = self.client.post(
			'/app/api/mobile-shell/device/register/',
			data=json.dumps({'platform': 'android', 'installation_id': 'bad'}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 400)
		self.assertFalse(response.json()['success'])

	def test_mobile_shell_ping_rejects_invalid_installation_id(self):
		self._login_mobile_client()
		response = self.client.post(
			'/app/api/mobile-shell/device/ping/',
			data=json.dumps({'installation_id': 'short'}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 400)
		self.assertFalse(response.json()['success'])

	@override_settings(
		MOBILE_SHELL_ANDROID_MIN_BUILD=120,
		MOBILE_SHELL_ANDROID_LATEST_BUILD=130,
		MOBILE_SHELL_ANDROID_LATEST_VERSION='1.3.0',
	)
	def test_mobile_shell_config_sets_required_and_recommended_flags(self):
		self._login_mobile_client()

		low_resp = self.client.get('/app/api/mobile-shell/config/?app_build=110')
		low_data = low_resp.json()['data']
		self.assertTrue(low_data['update_required'])
		self.assertTrue(low_data['update_recommended'])

		mid_resp = self.client.get('/app/api/mobile-shell/config/?app_build=125')
		mid_data = mid_resp.json()['data']
		self.assertFalse(mid_data['update_required'])
		self.assertTrue(mid_data['update_recommended'])

		high_resp = self.client.get('/app/api/mobile-shell/config/?app_build=130')
		high_data = high_resp.json()['data']
		self.assertFalse(high_data['update_required'])
		self.assertFalse(high_data['update_recommended'])

	@override_settings(
		MOBILE_SHELL_ANDROID_FORCE_UPDATE=True,
		MOBILE_SHELL_ANDROID_MIN_BUILD=1,
		MOBILE_SHELL_ANDROID_LATEST_BUILD=1,
	)
	def test_mobile_shell_config_force_update_overrides_build_threshold(self):
		self._login_mobile_client()
		response = self.client.get('/app/api/mobile-shell/config/?app_build=9999')
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['data']['update_required'])

	def test_mobile_shell_summary_requires_elevated_role(self):
		self._login_mobile_client()
		response = self.client.get('/app/api/mobile-shell/device/summary/')
		self.assertEqual(response.status_code, 403)

	def test_mobile_shell_summary_returns_rollout_metrics(self):
		self._login_mobile_super_admin()
		now = timezone.now()

		recent = MobileDevice.objects.create(
			user=self.client_user,
			platform='android',
			installation_id='inst-summary-0001',
			app_build=10,
			app_version='1.0.0',
			is_active=True,
		)
		older = MobileDevice.objects.create(
			user=self.client_user,
			platform='android',
			installation_id='inst-summary-0002',
			app_build=9,
			app_version='0.9.0',
			is_active=True,
		)

		MobileDevice.objects.filter(pk=recent.pk).update(last_seen_at=now - timedelta(hours=2))
		MobileDevice.objects.filter(pk=older.pk).update(last_seen_at=now - timedelta(days=45))

		response = self.client.get('/app/api/mobile-shell/device/summary/')
		self.assertEqual(response.status_code, 200)
		body = response.json()
		self.assertTrue(body['success'])
		self.assertGreaterEqual(body['data']['total_devices'], 2)
		self.assertGreaterEqual(body['data']['active_24h'], 1)
		self.assertGreaterEqual(body['data']['stale_30d'], 1)
		self.assertIsInstance(body['data']['top_builds'], list)


class MobileDeviceCleanupCommandTests(MobileAppBaseTestCase):
	def test_cleanup_marks_stale_devices_inactive(self):
		now = timezone.now()
		active_old = MobileDevice.objects.create(
			user=self.client_user,
			platform='android',
			installation_id='cleanup-stale-0001',
			is_active=True,
		)
		MobileDevice.objects.filter(pk=active_old.pk).update(last_seen_at=now - timedelta(days=50))

		out = StringIO()
		call_command('cleanup_mobile_devices', '--stale-days', '30', stdout=out)

		active_old.refresh_from_db()
		self.assertFalse(active_old.is_active)

	def test_cleanup_dry_run_does_not_modify_rows(self):
		now = timezone.now()
		active_old = MobileDevice.objects.create(
			user=self.client_user,
			platform='android',
			installation_id='cleanup-dryrun-0001',
			is_active=True,
		)
		MobileDevice.objects.filter(pk=active_old.pk).update(last_seen_at=now - timedelta(days=45))

		out = StringIO()
		call_command('cleanup_mobile_devices', '--stale-days', '30', '--dry-run', stdout=out)

		active_old.refresh_from_db()
		self.assertTrue(active_old.is_active)

	def test_cleanup_optionally_deletes_old_inactive_rows(self):
		now = timezone.now()
		old_inactive = MobileDevice.objects.create(
			user=self.client_user,
			platform='android',
			installation_id='cleanup-delete-0001',
			is_active=False,
		)
		MobileDevice.objects.filter(pk=old_inactive.pk).update(last_seen_at=now - timedelta(days=180))

		out = StringIO()
		call_command(
			'cleanup_mobile_devices',
			'--stale-days',
			'30',
			'--delete-days',
			'120',
			'--delete-inactive',
			stdout=out,
		)

		self.assertFalse(MobileDevice.objects.filter(pk=old_inactive.pk).exists())


class MobileRolloutGuardCommandTests(MobileAppBaseTestCase):
	def test_rollout_guard_reports_healthy_when_metrics_are_within_threshold(self):
		MobileDevice.objects.create(
			user=self.client_user,
			platform='android',
			installation_id='guard-healthy-0001',
			is_active=True,
			app_build=12,
			app_version='1.2.0',
		)

		out = StringIO()
		call_command(
			'mobile_rollout_guard',
			'--crash-free-sessions',
			'99.6',
			'--anr-rate',
			'0.30',
			'--auth-failure-rate',
			'0.8',
			'--auth-failure-baseline',
			'0.5',
			'--upload-failure-rate',
			'1.4',
			'--upload-failure-baseline',
			'1.0',
			'--max-stale-30d',
			'5',
			stdout=out,
		)

		report = json.loads(out.getvalue())
		self.assertTrue(report.get('healthy'))
		self.assertEqual(report['device_snapshot']['total_devices'], 1)
		self.assertEqual(report['device_snapshot']['stale_30d'], 0)

	def test_rollout_guard_strict_mode_fails_on_bad_metrics(self):
		out = StringIO()
		with self.assertRaises(CommandError):
			call_command(
				'mobile_rollout_guard',
				'--crash-free-sessions',
				'98.1',
				'--anr-rate',
				'0.80',
				'--strict',
				stdout=out,
			)

	def test_rollout_guard_can_include_inactive_devices(self):
		now = timezone.now()
		active = MobileDevice.objects.create(
			user=self.client_user,
			platform='android',
			installation_id='guard-active-0001',
			is_active=True,
		)
		inactive = MobileDevice.objects.create(
			user=self.client_user,
			platform='android',
			installation_id='guard-inactive-0001',
			is_active=False,
		)

		MobileDevice.objects.filter(pk=active.pk).update(last_seen_at=now - timedelta(hours=3))
		MobileDevice.objects.filter(pk=inactive.pk).update(last_seen_at=now - timedelta(days=90))

		out = StringIO()
		call_command('mobile_rollout_guard', '--include-inactive', stdout=out)

		report = json.loads(out.getvalue())
		self.assertEqual(report['device_snapshot']['total_devices'], 2)
		self.assertEqual(report['device_snapshot']['stale_30d'], 1)


@override_settings(
	MOBILE_SHELL_ANDROID_MIN_BUILD=12,
	MOBILE_SHELL_ANDROID_LATEST_BUILD=14,
	MOBILE_SHELL_ANDROID_LATEST_VERSION='1.4.0',
	MOBILE_SHELL_ANDROID_UPDATE_URL='https://panel.adarshbhopal.in/static/website/apk/adarsh-admin.apk',
	MOBILE_SHELL_SUPPORT_URL='https://panel.adarshbhopal.in/support/',
)
class MobileReleasePreflightCommandTests(MobileAppBaseTestCase):
	def test_release_preflight_reports_healthy_for_valid_remote_update_url(self):
		out = StringIO()
		call_command('mobile_release_preflight', stdout=out)

		report = json.loads(out.getvalue())
		self.assertTrue(report.get('healthy'))
		self.assertEqual(report['settings_snapshot']['min_supported_build'], 12)
		self.assertEqual(report['settings_snapshot']['latest_build'], 14)
		self.assertEqual(report['settings_snapshot']['latest_version'], '1.4.0')

	def test_release_preflight_strict_fails_when_build_order_is_invalid(self):
		out = StringIO()
		with self.assertRaises(CommandError):
			with override_settings(
				MOBILE_SHELL_ANDROID_MIN_BUILD=30,
				MOBILE_SHELL_ANDROID_LATEST_BUILD=20,
				MOBILE_SHELL_ANDROID_UPDATE_URL='https://panel.adarshbhopal.in/static/website/apk/adarsh-admin.apk',
			):
				call_command('mobile_release_preflight', '--strict', stdout=out)

	def test_release_preflight_warns_for_missing_local_apk_path_without_strict(self):
		out = StringIO()
		with override_settings(MOBILE_SHELL_ANDROID_UPDATE_URL='/static/website/apk/does-not-exist.apk'):
			call_command('mobile_release_preflight', stdout=out)

		report = json.loads(out.getvalue())
		resolution_check = next(c for c in report['checks'] if c['metric'] == 'update_url_resolves')
		self.assertEqual(resolution_check['status'], 'warn')

	def test_release_preflight_strict_can_require_local_apk_presence(self):
		out = StringIO()
		with self.assertRaises(CommandError):
			with override_settings(MOBILE_SHELL_ANDROID_UPDATE_URL='/static/website/apk/does-not-exist.apk'):
				call_command('mobile_release_preflight', '--strict', '--require-local-apk', stdout=out)


class MobileAppCardApiTests(MobileAppBaseTestCase):
	def test_bulk_status_rejects_non_list_card_ids(self):
		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/bulk-status/',
			data=json.dumps({'card_ids': 'bad', 'status': 'verified'}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)

	def test_bulk_status_rejects_more_than_500_ids(self):
		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/bulk-status/',
			data=json.dumps({'card_ids': list(range(501)), 'status': 'verified'}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)

	def test_card_add_requires_add_permission_for_client_role(self):
		self._login_mobile_client()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/card/add/',
			data={'field_data': json.dumps({'NAME': 'No Perm'})},
		)
		self.assertEqual(response.status_code, 403)

	def test_card_update_requires_edit_permission_for_client_role(self):
		self._login_mobile_client()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/card/{self.card.id}/update/',
			data={'field_data': json.dumps({'NAME': 'Edited'})},
		)
		self.assertEqual(response.status_code, 403)

	def test_card_update_blocks_client_edit_in_pool_status(self):
		self.card.status = 'pool'
		self.card.save(update_fields=['status'])
		self.client_profile.perm_idcard_edit = True
		self.client_profile.save(update_fields=['perm_idcard_edit'])

		self._login_mobile_client()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/card/{self.card.id}/update/',
			data={'field_data': json.dumps({'NAME': 'Edited In Pool'})},
		)

		self.assertEqual(response.status_code, 403)
		self.assertFalse(response.json()['success'])
		self.assertIn('pool status', response.json().get('message', '').lower())
		self.card.refresh_from_db()
		self.assertEqual(self.card.field_data.get('NAME'), 'Student One')

	def test_card_delete_requires_delete_permission_for_client_role(self):
		self._login_mobile_client()
		response = self.client.post(
			f'/app/api/card/{self.card.id}/delete/',
			data=json.dumps({'permanent': False}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 403)

	def test_card_add_success_for_super_admin_creates_card(self):
		self._login_mobile_super_admin()
		before = IDCard.objects.filter(table=self.table).count()

		response = self.client.post(
			f'/app/api/table/{self.table.id}/card/add/',
			data={'field_data': json.dumps({'NAME': 'Created Card', 'ROLL NO': '102'})},
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		after = IDCard.objects.filter(table=self.table).count()
		self.assertEqual(after, before + 1)

	def test_table_update_fields_rejects_too_many_fields(self):
		self._login_mobile_super_admin()
		fields = [{'name': f'F{i}', 'type': 'text'} for i in range(31)]
		response = self.client.post(
			f'/app/api/table/{self.table.id}/update-fields/',
			data=json.dumps({'fields': fields}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)

	def test_table_update_fields_normalizes_names_and_types(self):
		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/update-fields/',
			data=json.dumps({
				'fields': [
					{'name': 'name', 'type': 'invalid_type'},
					{'name': 'roll no', 'type': 'text', 'mandatory': True},
				]
			}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)
		self.table.refresh_from_db()
		self.assertEqual(self.table.fields[0]['name'], 'NAME')
		self.assertEqual(self.table.fields[0]['type'], 'text')
		self.assertEqual(self.table.fields[1]['name'], 'ROLL NO')

	def test_table_update_fields_rejects_non_list_fields_payload(self):
		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/update-fields/',
			data=json.dumps({'fields': {'name': 'bad'}}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)
		self.assertFalse(response.json()['success'])

	def test_table_update_fields_renaming_preserves_existing_values(self):
		self.table.fields = [
			{'name': 'NAME', 'type': 'text', 'order': 0},
			{'name': 'FATHER PHOTO', 'type': 'rel_photo', 'order': 1},
			{'name': 'MOTHER PHOTO', 'type': 'rel_photo', 'order': 2},
		]
		self.table.save(update_fields=['fields'])
		self.card.field_data = {
			'NAME': 'Student One',
			'FATHER PHOTO': 'adarshimg/CODE/father.jpg',
			'MOTHER PHOTO': 'adarshimg/CODE/mother.jpg',
		}
		self.card.save(update_fields=['field_data'])

		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/update-fields/',
			data=json.dumps({
				'fields': [
					{'name': 'NAME', 'type': 'text'},
					{'name': 'REL NO 1 PHOTO', 'type': 'rel_photo'},
					{'name': 'REL NO 2 PHOTO', 'type': 'rel_photo'},
				],
			}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 200)
		self.card.refresh_from_db()
		self.assertEqual(self.card.field_data.get('REL NO 1 PHOTO'), 'adarshimg/CODE/father.jpg')
		self.assertEqual(self.card.field_data.get('REL NO 2 PHOTO'), 'adarshimg/CODE/mother.jpg')

	def test_table_update_fields_type_change_and_rename_preserves_existing_value(self):
		self.table.fields = [
			{'name': 'NAME', 'type': 'text', 'order': 0},
			{'name': 'FATHER PHOTO', 'type': 'rel_photo', 'order': 1},
		]
		self.table.save(update_fields=['fields'])
		self.card.field_data = {
			'NAME': 'Student One',
			'FATHER PHOTO': 'adarshimg/CODE/father.jpg',
		}
		self.card.save(update_fields=['field_data'])

		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/update-fields/',
			data=json.dumps({
				'fields': [
					{'name': 'NAME', 'type': 'text'},
					{'name': 'GUARDIAN IMAGE', 'type': 'text'},
				],
			}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 200)
		self.card.refresh_from_db()
		self.assertEqual(self.card.field_data.get('GUARDIAN IMAGE'), 'adarshimg/CODE/father.jpg')

	def test_table_update_fields_rename_preserves_value_from_rel_alias_key(self):
		self.table.fields = [
			{'name': 'NAME', 'type': 'text', 'order': 0},
			{'name': 'REL NO 1 PHOTO', 'type': 'rel_photo', 'order': 1},
		]
		self.table.save(update_fields=['fields'])
		self.card.field_data = {
			'NAME': 'Student One',
			'REL_1PHOTO': 'adarshimg/CODE/father-from-alias.jpg',
		}
		self.card.save(update_fields=['field_data'])

		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/update-fields/',
			data=json.dumps({
				'fields': [
					{'name': 'NAME', 'type': 'text'},
					{'name': 'REL1', 'type': 'rel_photo'},
				],
			}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 200)
		self.card.refresh_from_db()
		self.assertEqual(self.card.field_data.get('REL1'), 'adarshimg/CODE/father-from-alias.jpg')

	@mock.patch('mobile_app.views._validate_image', return_value=(True, ''))
	def test_upload_photo_rejects_invalid_card_id(self, _mock_validate):
		self._login_mobile_super_admin()
		photo = SimpleUploadedFile('ok.jpg', b'fake', content_type='image/jpeg')
		response = self.client.post(
			f'/app/api/table/{self.table.id}/upload-photo/',
			data={'card_id': 'bad', 'photo': photo},
		)
		self.assertEqual(response.status_code, 400)
		self.assertFalse(response.json()['success'])

	@mock.patch('mobile_app.views._validate_image', return_value=(True, ''))
	def test_upload_photo_rejects_card_table_mismatch(self, _mock_validate):
		self._login_mobile_super_admin()
		other_table = IDCardTable.objects.create(
			group=self.group,
			name='Table B',
			fields=[{'name': 'NAME', 'type': 'text', 'order': 0}],
			is_active=True,
		)
		other_card = IDCard.objects.create(
			table=other_table,
			field_data={'NAME': 'Other Card'},
			status='pending',
		)
		photo = SimpleUploadedFile('ok.jpg', b'fake', content_type='image/jpeg')
		response = self.client.post(
			f'/app/api/table/{self.table.id}/upload-photo/',
			data={'card_id': str(other_card.id), 'photo': photo},
		)
		self.assertEqual(response.status_code, 404)

	@mock.patch('mobile_app.views._validate_image', return_value=(True, ''))
	def test_upload_photo_blocks_client_edit_in_pool_status(self, _mock_validate):
		self.card.status = 'pool'
		self.card.save(update_fields=['status'])
		self.client_profile.perm_idcard_edit = True
		self.client_profile.save(update_fields=['perm_idcard_edit'])

		self._login_mobile_client()
		photo = SimpleUploadedFile('ok.jpg', b'fake', content_type='image/jpeg')
		response = self.client.post(
			f'/app/api/table/{self.table.id}/upload-photo/',
			data={'card_id': str(self.card.id), 'photo': photo},
		)

		self.assertEqual(response.status_code, 403)
		self.assertFalse(response.json()['success'])
		self.assertIn('pool status', response.json().get('message', '').lower())

	@mock.patch('mobile_app.views._validate_image', return_value=(True, ''))
	def test_upload_photo_requires_edit_permission_for_client_role(self, mock_validate):
		self._login_mobile_client()
		photo = SimpleUploadedFile('ok.jpg', b'fake', content_type='image/jpeg')
		response = self.client.post(
			f'/app/api/table/{self.table.id}/upload-photo/',
			data={'card_id': str(self.card.id), 'photo': photo},
		)

		self.assertEqual(response.status_code, 403)
		self.assertFalse(response.json()['success'])
		self.assertIn('permission', response.json().get('message', '').lower())
		mock_validate.assert_not_called()

	@mock.patch('mobile_app.views.ThumbnailService.ensure_thumbnail_exists')
	@mock.patch('mobile_app.views.ImageService.process_image_field')
	def test_upload_photo_normalizes_png_to_jpg_before_storage(self, mock_process_image, _mock_thumb):
		from io import BytesIO
		from PIL import Image

		captured = {}

		def _capture_uploaded_file(**kwargs):
			uploaded = kwargs.get('uploaded_file')
			captured['name'] = getattr(uploaded, 'name', '')
			captured['content_type'] = getattr(uploaded, 'content_type', '')
			captured['size'] = getattr(uploaded, 'size', 0)
			return mock.Mock(success=True, message='ok', data={'final_value': 'adarshimg/TST/student.jpg'})

		mock_process_image.side_effect = _capture_uploaded_file

		self._login_mobile_super_admin()
		buf = BytesIO()
		Image.new('RGB', (1600, 1200), color='orange').save(buf, format='PNG')
		photo = SimpleUploadedFile('iphone-photo.png', buf.getvalue(), content_type='image/png')

		response = self.client.post(
			f'/app/api/table/{self.table.id}/upload-photo/',
			data={'card_id': str(self.card.id), 'photo': photo},
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		self.assertTrue(captured.get('name', '').lower().endswith('.jpg'))
		self.assertEqual(captured.get('content_type'), 'image/jpeg')
		self.assertGreater(captured.get('size', 0), 0)

	def test_pending_list_photo_slots_match_case_insensitive_image_keys(self):
		self.table.fields = [
			{'name': 'PHOTO', 'type': 'photo', 'order': 0},
			{'name': 'FATHER PHOTO', 'type': 'rel_photo', 'order': 1},
			{'name': 'MOTHER PHOTO', 'type': 'rel_photo', 'order': 2},
		]
		self.table.save(update_fields=['fields'])

		self.card.field_data = {
			'NAME': 'Student One',
			'photo': 'adarshimg/CODE/student.jpg',
			'FATHER_PHOTO': 'adarshimg/CODE/father.jpg',
			'mother photo': 'adarshimg/CODE/mother.jpg',
		}
		self.card.save(update_fields=['field_data'])

		self._login_mobile_super_admin()
		response = self.client.get(f'/app/table/{self.table.id}/pending/')

		self.assertEqual(response.status_code, 200)
		students = response.context.get('students', [])
		matched = next((row for row in students if row.get('id') == self.card.id), None)
		self.assertIsNotNone(matched)
		slots = matched.get('photo_slots') or []
		self.assertGreaterEqual(len(slots), 3)

		slot_urls = [slot.get('url') for slot in slots[:3]]
		self.assertEqual(slot_urls[0], '/media/adarshimg/CODE/student.jpg')
		self.assertEqual(slot_urls[1], '/media/adarshimg/CODE/father.jpg')
		self.assertEqual(slot_urls[2], '/media/adarshimg/CODE/mother.jpg')

	@mock.patch('mobile_app.views._validate_image', return_value=(True, ''))
	@mock.patch('mobile_app.views.ThumbnailService.ensure_thumbnail_exists')
	@mock.patch('mobile_app.views.ImageService.process_image_field')
	def test_upload_photo_prefers_primary_photo_field_over_relation_fields(self, mock_process_image, _mock_thumb, _mock_validate):
		self.table.fields = [
			{'name': 'FATHER PHOTO', 'type': 'rel_photo', 'order': 0},
			{'name': 'MOTHER PHOTO', 'type': 'rel_photo', 'order': 1},
			{'name': 'PHOTO', 'type': 'photo', 'order': 2},
		]
		self.table.save(update_fields=['fields'])

		mock_process_image.return_value = mock.Mock(
			success=True,
			message='ok',
			data={'final_value': 'adarshimg/TST/student.jpg'},
		)

		self._login_mobile_super_admin()
		photo = SimpleUploadedFile('ok.jpg', b'fake', content_type='image/jpeg')
		response = self.client.post(
			f'/app/api/table/{self.table.id}/upload-photo/',
			data={'card_id': str(self.card.id), 'photo': photo},
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		self.assertEqual(response.json().get('field_name'), 'PHOTO')
		self.assertEqual(mock_process_image.call_args.kwargs.get('field_name'), 'PHOTO')

		self.card.refresh_from_db()
		self.assertEqual(self.card.field_data.get('PHOTO'), 'adarshimg/TST/student.jpg')

	def test_camera_ui_is_consistent_across_mobile_roles(self):
		self._enable_mobile_photo_edit_for_all_roles()

		role_logins = [
			('super_admin', self._login_mobile_super_admin),
			('pro_user', self._login_mobile_pro_user),
			('admin_staff', self._login_mobile_admin_staff),
			('client', self._login_mobile_client),
			('client_staff', self._login_mobile_client_staff),
		]
		markers = [
			'x-data="cameraApp()"',
			'Capture Photo',
			'@click="retakePhoto()"',
			'@click="savePhoto()"',
		]

		baseline = None
		for role_name, login_fn in role_logins:
			self.client.logout()
			login_fn()
			response = self.client.get(f'/app/camera/{self.table.id}/')
			self.assertEqual(response.status_code, 200, msg=f'{role_name} camera view should load')
			content = response.content.decode('utf-8')
			self.assertNotIn('new Cropper(', content)
			self.assertNotIn('@click="applyCrop()"', content)

			presence = {marker: (marker in content) for marker in markers}
			if baseline is None:
				baseline = presence
			else:
				self.assertEqual(presence, baseline, msg=f'camera UI markers mismatch for {role_name}')

	def test_profile_update_button_is_visible_for_mobile_roles(self):
		self._enable_mobile_photo_edit_for_all_roles()

		role_logins = [
			self._login_mobile_super_admin,
			self._login_mobile_pro_user,
			self._login_mobile_admin_staff,
			self._login_mobile_client,
			self._login_mobile_client_staff,
		]
		for login_fn in role_logins:
			self.client.logout()
			login_fn()
			response = self.client.get('/app/profile/')
			self.assertEqual(response.status_code, 200)
			self.assertIn('Update App', response.content.decode('utf-8'))
			self.assertIn('Permissions Center', response.content.decode('utf-8'))

	def test_permissions_center_page_renders_native_controls(self):
		self._login_mobile_super_admin()
		response = self.client.get('/app/permissions/')

		self.assertEqual(response.status_code, 200)
		content = response.content.decode('utf-8')
		self.assertIn('Permissions Center', content)
		self.assertIn('Allow Camera + Gallery + Storage', content)
		self.assertIn('Allow Notifications', content)
		self.assertIn('openDeviceSettings()', content)

	@mock.patch('mobile_app.views.IDCardService.update_card')
	@mock.patch('mobile_app.views._validate_image', return_value=(True, ''))
	def test_card_update_accepts_multiple_image_field_upload_keys(self, _mock_validate, mock_update_card):
		mock_update_card.return_value = mock.Mock(success=True, message='ok', data={'card': {'id': self.card.id}})

		self.table.fields = [
			{'name': 'NAME', 'type': 'text', 'order': 0},
			{'name': 'PHOTO', 'type': 'photo', 'order': 1},
			{'name': 'MOTHER PHOTO', 'type': 'rel_photo', 'order': 2},
			{'name': 'FATHER PHOTO', 'type': 'rel_photo', 'order': 3},
		]
		self.table.save(update_fields=['fields'])

		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/card/{self.card.id}/update/',
			data={
				'field_data': json.dumps({'NAME': 'Student One Updated'}),
				'image_PHOTO': SimpleUploadedFile('photo.jpg', b'photo-bytes', content_type='image/jpeg'),
				'image_MOTHER PHOTO': SimpleUploadedFile('mother.jpg', b'mother-bytes', content_type='image/jpeg'),
				'image_FATHER PHOTO': SimpleUploadedFile('father.jpg', b'father-bytes', content_type='image/jpeg'),
			},
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		mock_update_card.assert_called_once()
		kwargs = mock_update_card.call_args.kwargs
		self.assertIn('image_PHOTO', kwargs.get('image_files', {}))
		self.assertIn('image_MOTHER PHOTO', kwargs.get('image_files', {}))
		self.assertIn('image_FATHER PHOTO', kwargs.get('image_files', {}))

	@mock.patch('mobile_app.views.IDCardService.update_card')
	@mock.patch('mobile_app.views._validate_image', return_value=(True, ''))
	def test_card_update_accepts_two_image_field_upload_keys(self, _mock_validate, mock_update_card):
		mock_update_card.return_value = mock.Mock(success=True, message='ok', data={'card': {'id': self.card.id}})

		self.table.fields = [
			{'name': 'NAME', 'type': 'text', 'order': 0},
			{'name': 'PHOTO', 'type': 'photo', 'order': 1},
			{'name': 'MOTHER PHOTO', 'type': 'rel_photo', 'order': 2},
		]
		self.table.save(update_fields=['fields'])

		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/card/{self.card.id}/update/',
			data={
				'field_data': json.dumps({'NAME': 'Student Two Images'}),
				'image_PHOTO': SimpleUploadedFile('photo.jpg', b'photo-bytes', content_type='image/jpeg'),
				'image_MOTHER PHOTO': SimpleUploadedFile('mother.jpg', b'mother-bytes', content_type='image/jpeg'),
			},
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		mock_update_card.assert_called_once()
		kwargs = mock_update_card.call_args.kwargs
		self.assertEqual(set(kwargs.get('image_files', {}).keys()), {'image_PHOTO', 'image_MOTHER PHOTO'})

	@mock.patch('mobile_app.views.IDCardService.update_card')
	@mock.patch('mobile_app.views._validate_image', return_value=(True, ''))
	def test_card_add_accepts_multiple_image_field_upload_keys(self, _mock_validate, mock_update_card):
		mock_update_card.return_value = mock.Mock(success=True, message='ok', data={'card': {}})

		self.table.fields = [
			{'name': 'NAME', 'type': 'text', 'order': 0},
			{'name': 'PHOTO', 'type': 'photo', 'order': 1},
			{'name': 'MOTHER PHOTO', 'type': 'rel_photo', 'order': 2},
			{'name': 'FATHER PHOTO', 'type': 'rel_photo', 'order': 3},
		]
		self.table.save(update_fields=['fields'])

		self._login_mobile_super_admin()
		before = IDCard.objects.filter(table=self.table).count()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/card/add/',
			data={
				'field_data': json.dumps({'NAME': 'Multi Image Card'}),
				'image_PHOTO': SimpleUploadedFile('photo.jpg', b'photo-bytes', content_type='image/jpeg'),
				'image_MOTHER PHOTO': SimpleUploadedFile('mother.jpg', b'mother-bytes', content_type='image/jpeg'),
				'image_FATHER PHOTO': SimpleUploadedFile('father.jpg', b'father-bytes', content_type='image/jpeg'),
			},
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		after = IDCard.objects.filter(table=self.table).count()
		self.assertEqual(after, before + 1)
		mock_update_card.assert_called_once()
		kwargs = mock_update_card.call_args.kwargs
		self.assertIn('image_PHOTO', kwargs.get('image_files', {}))
		self.assertIn('image_MOTHER PHOTO', kwargs.get('image_files', {}))
		self.assertIn('image_FATHER PHOTO', kwargs.get('image_files', {}))

	@mock.patch('mobile_app.views.IDCardService.update_card')
	@mock.patch('mobile_app.views._validate_image', return_value=(True, ''))
	def test_card_add_accepts_single_image_field_upload_key(self, _mock_validate, mock_update_card):
		mock_update_card.return_value = mock.Mock(success=True, message='ok', data={'card': {}})

		self.table.fields = [
			{'name': 'NAME', 'type': 'text', 'order': 0},
			{'name': 'PHOTO', 'type': 'photo', 'order': 1},
		]
		self.table.save(update_fields=['fields'])

		self._login_mobile_super_admin()
		before = IDCard.objects.filter(table=self.table).count()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/card/add/',
			data={
				'field_data': json.dumps({'NAME': 'Single Image Card'}),
				'image_PHOTO': SimpleUploadedFile('photo.jpg', b'photo-bytes', content_type='image/jpeg'),
			},
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		after = IDCard.objects.filter(table=self.table).count()
		self.assertEqual(after, before + 1)
		mock_update_card.assert_called_once()
		kwargs = mock_update_card.call_args.kwargs
		self.assertEqual(set(kwargs.get('image_files', {}).keys()), {'image_PHOTO'})

	def _setup_client_staff_row_scope(self):
		self.table.fields = [
			{'name': 'NAME', 'type': 'text', 'order': 0},
			{'name': 'ROLL NO', 'type': 'text', 'order': 1},
			{'name': 'CLASS', 'type': 'class', 'order': 2},
		]
		self.table.save(update_fields=['fields'])

		self.client_profile.perm_idcard_edit = True
		self.client_profile.perm_idcard_delete = True
		self.client_profile.perm_idcard_info = True
		self.client_profile.save(update_fields=['perm_idcard_edit', 'perm_idcard_delete', 'perm_idcard_info'])

		self.client_staff_profile.perm_idcard_edit = True
		self.client_staff_profile.perm_idcard_delete = True
		self.client_staff_profile.perm_idcard_info = True
		self.client_staff_profile.allowed_classes = ['10']
		self.client_staff_profile.allowed_sections = []
		self.client_staff_profile.save(update_fields=[
			'perm_idcard_edit',
			'perm_idcard_delete',
			'perm_idcard_info',
			'allowed_classes',
			'allowed_sections',
		])
		self.client_staff_profile.assigned_groups.set([self.group])

		in_scope_card = IDCard.objects.create(
			table=self.table,
			field_data={'NAME': 'In Scope Student', 'ROLL NO': '201', 'CLASS': '10'},
			status='pending',
		)
		out_of_scope_card = IDCard.objects.create(
			table=self.table,
			field_data={'NAME': 'Out Scope Student', 'ROLL NO': '202', 'CLASS': '11'},
			status='pending',
		)
		return in_scope_card, out_of_scope_card

	def test_client_staff_update_card_blocked_outside_row_scope(self):
		_, out_of_scope_card = self._setup_client_staff_row_scope()

		self._login_mobile_client_staff()
		response = self.client.post(
			f'/app/api/table/{self.table.id}/card/{out_of_scope_card.id}/update/',
			data={'field_data': json.dumps({'NAME': 'Should Not Update'})},
		)

		self.assertEqual(response.status_code, 403)
		self.assertFalse(response.json()['success'])

	def test_client_staff_delete_card_blocked_outside_row_scope(self):
		_, out_of_scope_card = self._setup_client_staff_row_scope()

		self._login_mobile_client_staff()
		response = self.client.post(
			f'/app/api/card/{out_of_scope_card.id}/delete/',
			data=json.dumps({'permanent': False}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 403)
		self.assertFalse(response.json()['success'])

	@mock.patch('mobile_app.views._validate_image', return_value=(True, ''))
	def test_client_staff_upload_photo_blocked_outside_row_scope(self, _mock_validate):
		_, out_of_scope_card = self._setup_client_staff_row_scope()

		self._login_mobile_client_staff()
		photo = SimpleUploadedFile('ok.jpg', b'fake-image', content_type='image/jpeg')
		response = self.client.post(
			f'/app/api/table/{self.table.id}/upload-photo/',
			data={'card_id': str(out_of_scope_card.id), 'photo': photo},
		)

		self.assertEqual(response.status_code, 403)
		self.assertFalse(response.json()['success'])

	def test_camera_picker_filters_cards_outside_client_staff_row_scope(self):
		in_scope_card, out_of_scope_card = self._setup_client_staff_row_scope()

		self._login_mobile_client_staff()
		response = self.client.get(f'/app/camera/{self.table.id}/')
		self.assertEqual(response.status_code, 200)

		card_ids = [row['id'] for row in response.context.get('all_cards_json', [])]
		self.assertIn(in_scope_card.id, card_ids)
		self.assertNotIn(out_of_scope_card.id, card_ids)

	def test_client_staff_pending_list_loads_scoped_rows_beyond_initial_window(self):
		in_scope_card, _ = self._setup_client_staff_row_scope()

		for idx in range(60):
			IDCard.objects.create(
				table=self.table,
				field_data={'NAME': f'Out Scope Bulk {idx}', 'ROLL NO': str(300 + idx), 'CLASS': '11'},
				status='pending',
			)

		self._login_mobile_client_staff()
		response = self.client.get(f'/app/table/{self.table.id}/pending/')

		self.assertEqual(response.status_code, 200)
		students = response.context.get('students', [])
		student_ids = [row['id'] for row in students]
		self.assertIn(in_scope_card.id, student_ids)

	def test_mobile_card_detail_requires_card_info_permission(self):
		self.client_profile.perm_idcard_info = False
		self.client_profile.save(update_fields=['perm_idcard_info'])

		self._login_mobile_client()
		response = self.client.get(f'/app/api/card/{self.card.id}/detail/')

		self.assertEqual(response.status_code, 403)
		self.assertFalse(response.json().get('success'))

	def test_settings_logs_hide_out_of_scope_cards_for_client_staff(self):
		in_scope_card, out_of_scope_card = self._setup_client_staff_row_scope()

		self._login_mobile_client_staff()
		response = self.client.get('/app/settings/')

		self.assertEqual(response.status_code, 200)
		log_names = [row.get('name') for row in response.context.get('log_activities', [])]
		self.assertIn(in_scope_card.field_data.get('NAME'), log_names)
		self.assertNotIn(out_of_scope_card.field_data.get('NAME'), log_names)

	def test_settings_logs_require_card_info_permission_for_client_role(self):
		self.client_profile.perm_idcard_info = False
		self.client_profile.save(update_fields=['perm_idcard_info'])

		self._login_mobile_client()
		response = self.client.get('/app/settings/')

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.context.get('log_activities', []), [])

	def test_mobile_notifications_hide_expired_items(self):
		from core.models import Notification

		Notification.objects.create(
			title='Visible Notice',
			message='Visible message',
			target='client',
			expires_at=timezone.now() + timedelta(hours=1),
		)
		Notification.objects.create(
			title='Expired Notice',
			message='Expired message',
			target='client',
			expires_at=timezone.now() - timedelta(minutes=5),
		)

		self._login_mobile_client()
		response = self.client.get('/app/notifications/')

		self.assertEqual(response.status_code, 200)
		titles = [item.get('title') for item in response.context.get('notifications', [])]
		self.assertIn('Visible Notice', titles)
		self.assertNotIn('Expired Notice', titles)


class MobileAppManagementApiTests(MobileAppBaseTestCase):
	def test_mobile_impersonation_users_requires_pro_user(self):
		self._login_mobile_client()
		response = self.client.get('/app/api/impersonate/users/')
		self.assertEqual(response.status_code, 403)
		self.assertFalse(response.json()['success'])

	def test_mobile_impersonation_start_and_stop_keeps_mobile_session(self):
		self._login_mobile_pro_user()

		start = self.client.post(
			'/app/api/impersonate/start/',
			data=json.dumps({'user_id': self.client_user.id}),
			content_type='application/json',
		)
		self.assertEqual(start.status_code, 200)
		self.assertTrue(start.json()['success'])
		self.assertEqual(start.json().get('redirect_url'), '/app/')
		self.assertTrue(self.client.session.get('mobile_auth_ok'))
		self.assertTrue(self.client.session.get('_pro_original_user_id'))

		home = self.client.get('/app/')
		self.assertEqual(home.status_code, 200)

		stop = self.client.post(
			'/app/api/impersonate/stop/',
			data=json.dumps({}),
			content_type='application/json',
		)
		self.assertEqual(stop.status_code, 200)
		self.assertTrue(stop.json()['success'])
		self.assertEqual(stop.json().get('redirect_url'), '/app/')
		self.assertTrue(self.client.session.get('mobile_auth_ok'))
		self.assertFalse(self.client.session.get('_pro_original_user_id'))

	def test_mobile_impersonation_start_rejects_target_without_mobile_access(self):
		target_user = User.objects.create_user(
			username='mob-no-mobile@test.com',
			email='mob-no-mobile@test.com',
			password='pass1234',
			role='client',
		)
		Client.objects.create(
			user=target_user,
			name='No Mobile Access Client',
			status='active',
			perm_mobile_app=False,
		)

		self._login_mobile_pro_user()
		response = self.client.post(
			'/app/api/impersonate/start/',
			data=json.dumps({'user_id': target_user.id}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)
		self.assertFalse(response.json()['success'])
		self.assertIn('mobile app access', response.json().get('message', '').lower())

	def test_server_info_requires_super_admin(self):
		self._login_mobile_client()
		denied = self.client.get('/app/api/server-info/')
		self.assertEqual(denied.status_code, 403)

		self._login_mobile_super_admin()
		allowed = self.client.get('/app/api/server-info/')
		self.assertEqual(allowed.status_code, 200)
		self.assertTrue(allowed.json()['success'])

	def test_client_toggle_forbidden_for_non_super_admin(self):
		self._login_mobile_client()
		response = self.client.post(f'/app/api/client/{self.client_profile.id}/toggle/')
		self.assertEqual(response.status_code, 403)

		self._login_mobile_admin_staff()
		response = self.client.post(f'/app/api/client/{self.client_profile.id}/toggle/')
		self.assertEqual(response.status_code, 403)

	def test_client_toggle_allowed_for_super_admin(self):
		self._login_mobile_super_admin()
		response = self.client.post(f'/app/api/client/{self.client_profile.id}/toggle/')
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])

	def test_client_toggle_allowed_for_admin_staff_with_manage_client_permission(self):
		self._login_mobile_admin_staff_manager()
		response = self.client.post(f'/app/api/client/{self.client_profile.id}/toggle/')
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])

	def test_client_delete_stays_super_admin_only_for_admin_staff_with_manage_permission(self):
		self._login_mobile_admin_staff_manager()
		response = self.client.post(f'/app/api/client/{self.client_profile.id}/delete/')
		self.assertEqual(response.status_code, 403)

	def test_client_tables_requires_admin_role(self):
		self._login_mobile_client()
		denied = self.client.get(f'/app/api/client/{self.client_profile.id}/tables/')
		self.assertEqual(denied.status_code, 403)

		self._login_mobile_super_admin()
		allowed = self.client.get(f'/app/api/client/{self.client_profile.id}/tables/')
		self.assertEqual(allowed.status_code, 200)
		self.assertTrue(allowed.json()['success'])

	def test_search_short_query_returns_empty_success_payload(self):
		self._login_mobile_super_admin()
		response = self.client.get('/app/api/search/?q=a')
		self.assertEqual(response.status_code, 200)
		payload = response.json()
		self.assertTrue(payload['success'])
		self.assertEqual(payload['data']['count'], 0)

	def test_search_matches_dynamic_field_like_desktop_global_search(self):
		self._login_mobile_super_admin()
		self.table.fields = [
			{'name': 'NAME', 'type': 'text', 'order': 0},
			{'name': 'ROLL NO', 'type': 'text', 'order': 1},
			{'name': 'ADMISSION CODE', 'type': 'text', 'order': 2},
		]
		self.table.save(update_fields=['fields'])
		card = IDCard.objects.create(
			table=self.table,
			field_data={
				'NAME': 'Student Two',
				'ROLL NO': '202',
				'ADMISSION CODE': 'MOB-GLOBAL-SEARCH-777',
			},
			status='verified',
		)

		response = self.client.get('/app/api/search/?q=MOB-GLOBAL-SEARCH-777')
		self.assertEqual(response.status_code, 200)
		payload = response.json()
		self.assertTrue(payload['success'])
		ids = [item['id'] for item in payload['data']['results']]
		self.assertIn(card.id, ids)

	def test_mobile_list_api_search_matches_dynamic_table_field(self):
		self._login_mobile_super_admin()
		self.table.fields = [
			{'name': 'NAME', 'type': 'text', 'order': 0},
			{'name': 'ROLL NO', 'type': 'text', 'order': 1},
			{'name': 'ADMISSION CODE', 'type': 'text', 'order': 2},
		]
		self.table.save(update_fields=['fields'])

		card = IDCard.objects.create(
			table=self.table,
			field_data={
				'NAME': 'Student Three',
				'ROLL NO': '303',
				'ADMISSION CODE': 'MOB-LIST-SEARCH-919',
			},
			status='pending',
		)

		response = self.client.get(f'/app/api/table/{self.table.id}/cards/?status=pending&search=MOB-LIST-SEARCH-919')
		self.assertEqual(response.status_code, 200)
		payload = response.json()
		self.assertTrue(payload['success'])
		ids = [item['id'] for item in payload['data']['cards']]
		self.assertIn(card.id, ids)

	def test_mobile_list_api_download_date_filter_uses_downloaded_at(self):
		self._login_mobile_super_admin()

		old_card = IDCard.objects.create(
			table=self.table,
			field_data={'NAME': 'Old Download', 'ROLL NO': '401', 'DOB': '2099-01-01'},
			status='download',
		)
		new_card = IDCard.objects.create(
			table=self.table,
			field_data={'NAME': 'New Download', 'ROLL NO': '402', 'DOB': '2000-01-01'},
			status='download',
		)

		now = timezone.now()
		old_card.downloaded_at = now - timedelta(days=3)
		old_card.save(update_fields=['downloaded_at'])
		new_card.downloaded_at = now
		new_card.save(update_fields=['downloaded_at'])

		from_date = now.date().isoformat()
		response = self.client.get(f'/app/api/table/{self.table.id}/cards/?status=download&from={from_date}')
		self.assertEqual(response.status_code, 200)
		payload = response.json()
		self.assertTrue(payload['success'])
		ids = [item['id'] for item in payload['data']['cards']]
		self.assertIn(new_card.id, ids)
		self.assertNotIn(old_card.id, ids)

	def test_mobile_global_search_supports_filter_and_table_scope(self):
		self._login_mobile_super_admin()

		other_table = IDCardTable.objects.create(
			group=self.group,
			name='Table Scope B',
			fields=[
				{'name': 'NAME', 'type': 'text', 'order': 0},
				{'name': 'MOBILE', 'type': 'text', 'order': 1},
			],
			is_active=True,
		)

		in_scope = IDCard.objects.create(
			table=self.table,
			field_data={'NAME': 'Scoped Person', 'MOBILE': '9990011111'},
			status='verified',
		)
		out_scope = IDCard.objects.create(
			table=other_table,
			field_data={'NAME': 'Scoped Person', 'MOBILE': '9990022222'},
			status='verified',
		)

		response = self.client.get(f'/app/api/search/?q=Scoped Person&filter=name&table_id={self.table.id}')
		self.assertEqual(response.status_code, 200)
		payload = response.json()
		self.assertTrue(payload['success'])
		ids = [item['id'] for item in payload['data']['results']]
		self.assertIn(in_scope.id, ids)
		self.assertNotIn(out_scope.id, ids)

	def test_table_picker_admin_staff_without_assigned_clients_sees_empty_list(self):
		self._login_mobile_admin_staff()
		response = self.client.get('/app/tables/pending/')
		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.context['tables']), 0)

	@mock.patch('mobile_app.views.ClientService.create')
	def test_client_create_rejects_invalid_json_before_service_call(self, mock_create):
		self._login_mobile_super_admin()
		response = self.client.post('/app/api/client/create/', data='bad-json', content_type='application/json')
		self.assertEqual(response.status_code, 400)
		mock_create.assert_not_called()

	@mock.patch('mobile_app.views.ClientService.create')
	def test_client_create_success_proxy_response(self, mock_create):
		from core.services.base import ServiceResult

		self._login_mobile_super_admin()
		mock_create.return_value = ServiceResult(
			success=True,
			message='Client created',
			data={'client': {'id': 999, 'name': 'Created From Mock'}},
		)

		response = self.client.post(
			'/app/api/client/create/',
			data=json.dumps({'name': 'Created From Mock', 'email': 'new-client@test.com'}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		self.assertEqual(response.json()['client']['id'], 999)

	@mock.patch('mobile_app.views.ClientService.create')
	def test_client_create_forbidden_for_admin_staff_without_manage_client_permission(self, mock_create):
		self._login_mobile_admin_staff()
		response = self.client.post(
			'/app/api/client/create/',
			data=json.dumps({'name': 'Denied Create', 'email': 'denied@test.com'}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 403)
		mock_create.assert_not_called()

	@mock.patch('mobile_app.views.ClientService.create')
	def test_client_create_auto_assigns_new_client_for_admin_staff_with_manage_permission(self, mock_create):
		from core.services.base import ServiceResult

		target_client = self.client_profile_with_add_perm
		self.assertFalse(self.admin_staff_manage_profile.assigned_clients.filter(id=target_client.id).exists())

		mock_create.return_value = ServiceResult(
			success=True,
			message='Client created',
			data={'client': {'id': target_client.id, 'name': target_client.name}},
		)

		self._login_mobile_admin_staff_manager()
		response = self.client.post(
			'/app/api/client/create/',
			data=json.dumps({'name': target_client.name, 'email': 'new-client@test.com'}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		self.admin_staff_manage_profile.refresh_from_db()
		self.assertTrue(self.admin_staff_manage_profile.assigned_clients.filter(id=target_client.id).exists())

	def test_staff_manage_page_requires_manage_client_permission_for_client_role(self):
		self._login_mobile_client()
		denied = self.client.get('/app/staff/')
		self.assertEqual(denied.status_code, 302)
		self.assertIn('/app/', denied.url)

		self.client_profile.perm_idcard_client_list = True
		self.client_profile.save(update_fields=['perm_idcard_client_list'])
		allowed = self.client.get('/app/staff/')
		self.assertEqual(allowed.status_code, 200)

	def test_groups_overview_limits_client_staff_to_assigned_groups(self):
		other_group = IDCardGroup.objects.create(client=self.client_profile, name='Group B')
		other_table = IDCardTable.objects.create(
			group=other_group,
			name='Table B',
			fields=[{'name': 'NAME', 'type': 'text', 'order': 0}],
			is_active=True,
		)
		IDCard.objects.create(table=other_table, field_data={'NAME': 'Hidden'}, status='pending')

		self.client_staff_profile.assigned_groups.set([self.group])
		self._login_mobile_client_staff()

		response = self.client.get('/app/groups/')
		self.assertEqual(response.status_code, 200)

		group_ids = {group.id for group in response.context['groups']}
		table_ids = {table.id for table in response.context['tables']}
		self.assertEqual(group_ids, {self.group.id})
		self.assertEqual(table_ids, {self.table.id})

	def test_staff_api_list_requires_manage_client_permission_for_client_role(self):
		self._login_mobile_client()
		denied = self.client.get('/app/api/staff/')
		self.assertEqual(denied.status_code, 403)
		self.assertFalse(denied.json()['success'])

		self.client_profile.perm_idcard_client_list = True
		self.client_profile.save(update_fields=['perm_idcard_client_list'])
		allowed = self.client.get('/app/api/staff/')
		self.assertEqual(allowed.status_code, 200)
		self.assertTrue(allowed.json()['success'])

	def test_staff_api_list_for_super_admin_includes_permission_flags(self):
		managed_user = User.objects.create_user(
			username='mob-admin-perm-list@test.com',
			email='mob-admin-perm-list@test.com',
			password='pass1234',
			role='admin_staff',
		)
		managed_staff = Staff.objects.create(
			user=managed_user,
			staff_type='admin_staff',
			perm_mobile_app=True,
			perm_print_list=True,
			perm_idcard_bulk_reupload=True,
		)

		self._login_mobile_super_admin()
		response = self.client.get('/app/api/staff/')
		self.assertEqual(response.status_code, 200)
		payload = response.json()
		self.assertTrue(payload['success'])

		staff_row = next((item for item in payload['data']['staff'] if item['id'] == managed_staff.id), None)
		self.assertIsNotNone(staff_row)
		self.assertTrue(staff_row['perm_print_list'])
		self.assertTrue(staff_row['perm_idcard_bulk_reupload'])

	def test_staff_api_update_for_super_admin_updates_admin_staff_permissions(self):
		managed_user = User.objects.create_user(
			username='mob-admin-perm-update@test.com',
			email='mob-admin-perm-update@test.com',
			password='pass1234',
			role='admin_staff',
		)
		managed_staff = Staff.objects.create(
			user=managed_user,
			staff_type='admin_staff',
			perm_mobile_app=True,
			perm_print_list=False,
		)

		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/staff/{managed_staff.id}/update/',
			data=json.dumps({
				'first_name': 'Mobile',
				'last_name': 'Updated',
				'perm_print_list': True,
				'perm_idcard_bulk_reupload': True,
			}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])
		managed_staff.refresh_from_db()
		self.assertTrue(managed_staff.perm_print_list)
		self.assertTrue(managed_staff.perm_idcard_bulk_reupload)

	def test_clients_list_status_chips_do_not_use_single_letter_prefixes(self):
		template_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'clients_list.html'
		html = template_path.read_text(encoding='utf-8')
		self.assertIn('Pending', html)
		self.assertIn('Verified', html)
		self.assertIn('Approved', html)
		self.assertIn('Download', html)
		self.assertNotIn('class="mobile-chip-label">P</span>', html)
		self.assertNotIn('class="mobile-chip-label">V</span>', html)
		self.assertNotIn('class="mobile-chip-label">A</span>', html)
		self.assertNotIn('class="mobile-chip-label">D</span>', html)

	def test_clients_list_form_includes_download_image_mode_permissions(self):
		template_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'clients_list.html'
		html = template_path.read_text(encoding='utf-8')
		self.assertIn('perm_idcard_download_image_rename_mode', html)
		self.assertIn('perm_idcard_download_image_generate_mode', html)
		self.assertIn('Download Images: Rename Mode', html)
		self.assertIn('Download Images: Generate Mode', html)

	def test_website_upload_requires_website_edit_permission(self):
		self._login_mobile_client()
		response = self.client.post('/app/api/website/portfolio/upload/', data={})
		self.assertEqual(response.status_code, 403)

	@mock.patch('website.services.PortfolioItemService.create')
	def test_website_upload_returns_partial_success_for_mixed_files(self, mock_create):
		self._login_mobile_super_admin()
		cat = PortfolioCategory.objects.create(name='School ID Cards', icon='fas fa-id-card', is_active=True, order=1)

		ok_item = mock.Mock()
		ok_item.id = 101
		ok_item.image = mock.Mock()
		ok_item.image.url = '/media/portfolio/ok.webp'

		from django.core.exceptions import ValidationError
		mock_create.side_effect = [ok_item, ValidationError('Uploaded portfolio image is not a valid image.')]

		img1 = SimpleUploadedFile('ok.jpg', b'img-one', content_type='image/jpeg')
		img2 = SimpleUploadedFile('bad.jpg', b'img-two', content_type='image/jpeg')

		response = self.client.post(
			'/app/api/website/portfolio/upload/',
			data={'category_id': str(cat.id), 'images': [img1, img2]},
		)

		self.assertEqual(response.status_code, 207)
		payload = response.json()
		self.assertTrue(payload['success'])
		self.assertEqual(payload['count'], 1)
		self.assertEqual(payload['failed_count'], 1)
		self.assertEqual(payload['failed'][0]['name'], 'bad.jpg')

	@mock.patch('website.services.PortfolioItemService.create')
	def test_website_upload_returns_400_when_all_files_fail(self, mock_create):
		self._login_mobile_super_admin()
		cat = PortfolioCategory.objects.create(name='Office Files', icon='fas fa-folder', is_active=True, order=2)

		from django.core.exceptions import ValidationError
		mock_create.side_effect = ValidationError('Uploaded portfolio image is not a valid image.')

		img1 = SimpleUploadedFile('bad-only.jpg', b'img-data', content_type='image/jpeg')

		response = self.client.post(
			'/app/api/website/portfolio/upload/',
			data={'category_id': str(cat.id), 'images': [img1]},
		)

		self.assertEqual(response.status_code, 400)
		payload = response.json()
		self.assertFalse(payload['success'])
		self.assertEqual(payload['failed_count'], 1)

	def test_reprint_table_non_numeric_query_is_stable(self):
		from reprintcard.models import ReprintRequest

		self._login_mobile_super_admin()
		download_card = IDCard.objects.create(
			table=self.table,
			field_data={'NAME': 'Download Card', 'ROLL NO': '777'},
			status='download',
		)
		ReprintRequest.objects.create(
			card=download_card,
			table=self.table,
			status='requested',
			requested_by=self.super_admin,
		)

		response = self.client.get(f'/app/reprint/table/{self.table.id}/?step=request_list&q=alpha')
		self.assertEqual(response.status_code, 200)

	def test_add_form_sheet_renders_multi_image_field_loop(self):
		template_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'partials' / 'add_form_sheet.html'
		html = template_path.read_text(encoding='utf-8')
		self.assertIn('x-for="fieldName in imageFormFields"', html)
		self.assertIn('@click="if(!viewMode) startImageSelection(fieldName)"', html)
		self.assertNotIn('@click="openCropForField(fieldName)"', html)
		self.assertNotIn('showCropModal', html)
		self.assertIn(':disabled="addFormSubmitting"', html)
		self.assertIn("fa-spinner fa-spin", html)

	def test_mobile_list_toast_is_above_modal_layers(self):
		template_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'partials' / 'list_toast.html'
		html = template_path.read_text(encoding='utf-8')
		self.assertIn('z-[120]', html)
		self.assertIn('pointer-events-none', html)

	def test_mobile_list_page_has_global_action_loading_overlay(self):
		template_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'list_page.html'
		html = template_path.read_text(encoding='utf-8')
		self.assertIn('x-show="actionLoading"', html)
		self.assertIn('Processing...', html)

	def test_home_and_groups_templates_keep_sections_open_by_default(self):
		base = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app'
		home_html = (base / 'home.html').read_text(encoding='utf-8')
		groups_html = (base / 'groups.html').read_text(encoding='utf-8')

		self.assertNotIn('toggle(', home_html)
		self.assertNotIn('expanded ===', home_html)
		self.assertNotIn('expandedGroup', groups_html)

	def test_install_ctas_are_guarded_for_native_apk_shell(self):
		templates_base = Path(__file__).resolve().parent.parent / 'templates'
		mobile_base_html = (templates_base / 'mobile_app' / 'base.html').read_text(encoding='utf-8')
		mobile_login_html = (templates_base / 'mobile_app' / 'login.html').read_text(encoding='utf-8')
		website_pwa_html = (templates_base / 'partials' / 'website' / 'pwa-section.html').read_text(encoding='utf-8')

		self.assertIn('function isNativeShell()', mobile_base_html)
		self.assertIn('if (nativeShell) {', mobile_base_html)
		self.assertIn('var apkDownloadUrl =', mobile_base_html)
		self.assertIn('if (apkDownloadUrl) {', mobile_base_html)
		self.assertIn("installBtn.classList.add('hidden');", mobile_login_html)
		self.assertIn('var apkDownloadUrl =', mobile_login_html)
		self.assertIn('if (apkDownloadUrl) {', mobile_login_html)
		self.assertIn("section.style.display = 'none';", website_pwa_html)
		self.assertIn('MOBILE_ANDROID_APP_DOWNLOAD_URL', website_pwa_html)
		self.assertIn('id="downloadApkCta"', website_pwa_html)

	def test_reprint_table_prefers_field_data_photo_url(self):
		from reprintcard.models import ReprintRequest

		self._login_mobile_super_admin()
		download_card = IDCard.objects.create(
			table=self.table,
			field_data={
				'NAME': 'Photo Card',
				'PHOTO': 'adarshimg/mobile-photo/photo-card.webp',
			},
			status='download',
		)
		ReprintRequest.objects.create(
			card=download_card,
			table=self.table,
			status='requested',
			requested_by=self.super_admin,
		)

		response = self.client.get(f'/app/reprint/table/{self.table.id}/?step=request_list')
		self.assertEqual(response.status_code, 200)
		items = response.context.get('items', [])
		self.assertTrue(items)
		matched = next((row for row in items if row.get('card_id') == download_card.id), None)
		self.assertIsNotNone(matched)
		self.assertEqual(matched.get('photo_url'), '/media/adarshimg/mobile-photo/photo-card.webp')


class MobileAppCoverageGapRegressionTests(MobileAppBaseTestCase):
	def test_desktop_required_page_renders_status_context(self):
		self._login_mobile_client()
		response = self.client.get('/app/desktop-required/?status=download')
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.context.get('status'), 'download')

	def test_profile_page_and_profile_update_api_work_for_mobile_client(self):
		self._login_mobile_client()

		profile_response = self.client.get('/app/profile/')
		self.assertEqual(profile_response.status_code, 200)
		self.assertEqual(profile_response.context.get('user_email'), 'mob-client@test.com')

		update_response = self.client.post(
			'/app/api/profile/update/',
			data=json.dumps({'name': 'Updated Mobile User'}),
			content_type='application/json',
		)
		self.assertEqual(update_response.status_code, 200)
		self.assertTrue(update_response.json().get('success'))

		self.client_user.refresh_from_db()
		self.assertEqual(self.client_user.first_name, 'Updated')
		self.assertEqual(self.client_user.last_name, 'Mobile User')

	def test_profile_update_api_rejects_invalid_json(self):
		self._login_mobile_client()
		response = self.client.post(
			'/app/api/profile/update/',
			data='bad-json',
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)
		self.assertFalse(response.json().get('success'))

	def test_search_page_renders_and_honors_table_scope(self):
		self._login_mobile_super_admin()
		response = self.client.get(f'/app/search/?q=Student&filter=name&table_id={self.table.id}')
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.context.get('table_scope_id'), self.table.id)
		self.assertGreaterEqual(response.context.get('result_count', 0), 1)

	def test_clients_list_requires_admin_and_loads_for_super_admin(self):
		self._login_mobile_client()
		denied = self.client.get('/app/clients/')
		self.assertEqual(denied.status_code, 302)
		self.assertIn('/app/', denied.url)

		self._login_mobile_super_admin()
		allowed = self.client.get('/app/clients/')
		self.assertEqual(allowed.status_code, 200)
		client_ids = [row['id'] for row in allowed.context.get('clients_json', [])]
		self.assertIn(self.client_profile.id, client_ids)

	def test_client_groups_requires_admin_and_super_admin_can_view(self):
		self._login_mobile_client()
		denied = self.client.get(f'/app/clients/{self.client_profile.id}/groups/')
		self.assertEqual(denied.status_code, 302)
		self.assertIn('/app/', denied.url)

		self._login_mobile_super_admin()
		allowed = self.client.get(f'/app/clients/{self.client_profile.id}/groups/')
		self.assertEqual(allowed.status_code, 200)
		self.assertEqual(allowed.context.get('client').id, self.client_profile.id)

	def test_reprint_lists_requires_permission_and_renders_for_super_admin(self):
		from reprintcard.models import ReprintRequest

		download_card = IDCard.objects.create(
			table=self.table,
			field_data={'NAME': 'Reprint Scope', 'ROLL NO': '909'},
			status='download',
		)
		ReprintRequest.objects.create(
			card=download_card,
			table=self.table,
			status='requested',
			requested_by=self.super_admin,
		)

		self._login_mobile_client()
		denied = self.client.get(f'/app/reprint/{self.client_profile.id}/')
		self.assertEqual(denied.status_code, 302)
		self.assertIn('/app/', denied.url)

		self._login_mobile_super_admin()
		allowed = self.client.get(f'/app/reprint/{self.client_profile.id}/')
		self.assertEqual(allowed.status_code, 200)
		self.assertEqual(allowed.context.get('request_total'), 1)

	def test_website_manage_page_requires_permission_and_renders_for_super_admin(self):
		self._login_mobile_client()
		denied = self.client.get('/app/website/')
		self.assertEqual(denied.status_code, 403)

		self._login_mobile_super_admin()
		allowed = self.client.get('/app/website/')
		self.assertEqual(allowed.status_code, 200)
		self.assertIn('categories_json', allowed.context)

	@mock.patch('mobile_app.views.StaffService.create')
	def test_api_staff_create_for_super_admin_uses_staff_service(self, mock_create):
		from core.services.base import ServiceResult

		mock_create.return_value = ServiceResult(success=True, message='Staff created', data={'staff': {'id': 321}})

		self._login_mobile_super_admin()
		response = self.client.post(
			'/app/api/staff/create/',
			data=json.dumps({'first_name': 'Mob', 'last_name': 'Manager', 'email': 'mob-manager@test.com'}),
			content_type='application/json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json().get('success'))
		mock_create.assert_called_once()
		self.assertEqual(mock_create.call_args.kwargs.get('staff_type'), 'admin_staff')

	def test_api_staff_toggle_and_delete_work_for_super_admin(self):
		managed_user = User.objects.create_user(
			username='mob-manage-staff@test.com',
			email='mob-manage-staff@test.com',
			password='pass1234',
			role='admin_staff',
		)
		managed_staff = Staff.objects.create(
			user=managed_user,
			staff_type='admin_staff',
			perm_mobile_app=True,
		)

		self._login_mobile_super_admin()
		toggle_response = self.client.post(f'/app/api/staff/{managed_staff.id}/toggle/')
		self.assertEqual(toggle_response.status_code, 200)
		managed_user.refresh_from_db()
		self.assertFalse(managed_user.is_active)

		delete_response = self.client.post(f'/app/api/staff/{managed_staff.id}/delete/')
		self.assertEqual(delete_response.status_code, 200)
		self.assertFalse(User.objects.filter(id=managed_user.id).exists())

	@mock.patch('mobile_app.views.ClientService.get')
	def test_api_client_detail_for_super_admin_returns_service_payload(self, mock_get):
		from core.services.base import ServiceResult

		mock_get.return_value = ServiceResult(
			success=True,
			message='ok',
			data={'client': {'id': self.client_profile.id, 'name': self.client_profile.name}},
		)

		self._login_mobile_super_admin()
		response = self.client.get(f'/app/api/client/{self.client_profile.id}/')
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json().get('success'))
		self.assertEqual(response.json().get('client', {}).get('id'), self.client_profile.id)
		mock_get.assert_called_once_with(self.client_profile.id, include_permissions=True)

	@mock.patch('mobile_app.views.ClientService.get')
	def test_api_client_detail_for_admin_staff_manager_returns_service_payload(self, mock_get):
		from core.services.base import ServiceResult

		mock_get.return_value = ServiceResult(
			success=True,
			message='ok',
			data={'client': {'id': self.client_profile.id, 'name': self.client_profile.name}},
		)

		self._login_mobile_admin_staff_manager()
		response = self.client.get(f'/app/api/client/{self.client_profile.id}/')
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json().get('success'))
		self.assertEqual(response.json().get('client', {}).get('id'), self.client_profile.id)
		mock_get.assert_called_once_with(self.client_profile.id, include_permissions=True)

	@mock.patch('mobile_app.views.ClientService.get')
	def test_api_client_detail_for_admin_staff_manager_denies_out_of_scope_client(self, mock_get):
		other_user = User.objects.create_user(
			username='mob-out-scope-client@test.com',
			email='mob-out-scope-client@test.com',
			password='pass1234',
			role='client',
		)
		other_client = Client.objects.create(
			user=other_user,
			name='Out Scope Client',
			status='active',
			perm_mobile_app=True,
		)

		self._login_mobile_admin_staff_manager()
		response = self.client.get(f'/app/api/client/{other_client.id}/')
		self.assertEqual(response.status_code, 403)
		self.assertFalse(response.json().get('success'))
		mock_get.assert_not_called()

	@mock.patch('mobile_app.views.ClientService.update')
	def test_api_client_update_for_super_admin_returns_service_payload(self, mock_update):
		from core.services.base import ServiceResult

		mock_update.return_value = ServiceResult(
			success=True,
			message='updated',
			data={'client': {'id': self.client_profile.id, 'name': 'Updated Client'}},
		)

		self._login_mobile_super_admin()
		response = self.client.post(
			f'/app/api/client/{self.client_profile.id}/update/',
			data=json.dumps({'name': 'Updated Client'}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json().get('success'))
		self.assertEqual(response.json().get('client', {}).get('name'), 'Updated Client')
		mock_update.assert_called_once_with(self.client_profile.id, {'name': 'Updated Client'})

	def test_api_portfolio_category_items_requires_view_permission_and_returns_items(self):
		category = PortfolioCategory.objects.create(name='Mobile Category', icon='fas fa-image', is_active=True, order=5)
		item = PortfolioItem.objects.create(
			title='Mobile Clip',
			category=category,
			item_type='video',
			video_url='https://example.com/mobile-clip.mp4',
			is_active=True,
			order=1,
		)

		self._login_mobile_client()
		denied = self.client.get(f'/app/api/website/portfolio/category/{category.id}/items/')
		self.assertEqual(denied.status_code, 403)

		self._login_mobile_super_admin()
		allowed = self.client.get(f'/app/api/website/portfolio/category/{category.id}/items/?limit=5')
		self.assertEqual(allowed.status_code, 200)
		payload = allowed.json()
		self.assertTrue(payload.get('success'))
		item_ids = [row['id'] for row in payload.get('items', [])]
		self.assertIn(item.id, item_ids)


class MobileAppPhase2LifecycleContractTests(TestCase):
	def test_mobile_bridge_has_startup_back_guardrails(self):
		js_path = Path(__file__).resolve().parent.parent / 'static' / 'mobile' / 'js' / 'app.js'
		content = js_path.read_text(encoding='utf-8')

		self.assertIn('backHandlerReadyAt = Date.now() + 2200', content)
		self.assertIn("LOGIN_BACK_SUPPRESS_KEY = 'adarsh.mobile.justLoggedInAt'", content)
		self.assertIn('if (now < backHandlerReadyAt)', content)
		self.assertIn('if (!userInteractedAt || (now - userInteractedAt) > 12 * 60 * 1000)', content)
		self.assertIn('if (shouldSuppressHistoryBackForRecentLogin(now)) {', content)
		self.assertIn("App.addListener('appStateChange'", content)
		self.assertIn('userInteractedAt = 0;', content)

	def test_mobile_bridge_cleans_stale_page_leave_blur_state(self):
		js_path = Path(__file__).resolve().parent.parent / 'static' / 'mobile' / 'js' / 'app.js'
		content = js_path.read_text(encoding='utf-8')

		self.assertIn("var ENTERING_CLASS = 'mobile-page-entering';", content)
		self.assertIn("var LEAVE_CLASS = 'mobile-page-leave';", content)
		self.assertIn("var TRANSITIONING_CLASS = 'mobile-page-transitioning';", content)
		self.assertIn('setTimeout(clearLeaveClass, LEAVE_GUARD_MS);', content)
		self.assertIn("window.addEventListener('pageshow'", content)
		self.assertIn("window.addEventListener('pagehide'", content)

	def test_mobile_css_has_transition_flicker_guards(self):
		css_path = Path(__file__).resolve().parent.parent / 'static' / 'mobile' / 'css' / 'mobile.css'
		content = css_path.read_text(encoding='utf-8')

		self.assertIn('body.mobile-page-transitioning', content)
		self.assertIn("[class*='backdrop-blur']", content)
		self.assertNotIn('.text-\\[8px\\]', content)
		self.assertNotIn('.text-\\[9px\\]', content)
		self.assertNotIn('.text-\\[10px\\]', content)
		self.assertNotIn('.text-\\[11px\\]', content)

	def test_mobile_bridge_has_external_link_and_deep_link_handlers(self):
		js_path = Path(__file__).resolve().parent.parent / 'static' / 'mobile' / 'js' / 'app.js'
		content = js_path.read_text(encoding='utf-8')

		self.assertIn('function setupExternalLinkBridge()', content)
		self.assertIn('Browser.open({ url: href })', content)
		self.assertIn("App.addListener('appUrlOpen'", content)
		self.assertIn("if (!path.startsWith('/app')) return '/app/';", content)

	def test_shell_runtime_has_back_and_deep_link_guardrails(self):
		shell_path = Path(__file__).resolve().parent.parent / 'mobile_shell_app' / 'www' / 'shell.js'
		shell_content = shell_path.read_text(encoding='utf-8')

		self.assertIn('backHandlerReadyAt = Date.now() + 2200', shell_content)
		self.assertIn('if (!lastUserInteractionMs || (now - lastUserInteractionMs) > (12 * 60 * 1000))', shell_content)
		self.assertIn("App.addListener('appStateChange'", shell_content)
		self.assertIn('lastUserInteractionMs = 0;', shell_content)
		self.assertIn("App.addListener('appUrlOpen'", shell_content)
		self.assertIn("if (!path.startsWith('/app')) return APP_ROOT_PATH;", shell_content)


class MobileAppPhase3EnvironmentGateContractTests(TestCase):
	def test_environment_gate_exposes_unified_modes(self):
		env_path = Path(__file__).resolve().parent.parent / 'static' / 'mobile' / 'js' / 'environment-gate.js'
		content = env_path.read_text(encoding='utf-8')

		self.assertIn('window.adarshMobileEnv = {', content)
		self.assertIn('isNativeShell: isNativeShell', content)
		self.assertIn('isStandalonePwa: isStandalonePwa', content)
		self.assertIn('isMobileBrowser: isMobileBrowser', content)
		self.assertIn('canShowInstallCta: canShowInstallCta', content)
		self.assertIn('shouldUseNativeUpdateUi: shouldUseNativeUpdateUi', content)

	def test_base_template_uses_environment_gate_for_install_and_update(self):
		base_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'base.html'
		content = base_path.read_text(encoding='utf-8')

		self.assertIn("mobile/js/environment-gate.js", content)
		self.assertIn('if (!shouldUseNativeUpdateUi()) {', content)
		self.assertIn('function canShowInstallCta()', content)
		self.assertIn('if (isNativeShell()) {', content)

	def test_login_template_hides_install_prompt_in_native_shell(self):
		login_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'login.html'
		content = login_path.read_text(encoding='utf-8')

		self.assertIn("mobile/js/environment-gate.js", content)
		self.assertIn('function isNativeShell()', content)
		self.assertIn("installBtn.classList.add('hidden')", content)

	def test_mobile_bridge_uses_environment_gate_for_native_detection(self):
		js_path = Path(__file__).resolve().parent.parent / 'static' / 'mobile' / 'js' / 'app.js'
		content = js_path.read_text(encoding='utf-8')

		self.assertIn('var envGate = window.adarshMobileEnv || null;', content)
		self.assertIn('function isNativeShellContext()', content)
		self.assertIn('if (!cap || !isNativeShellContext()) {', content)


class MobileAppPhase4DeviceBridgeContractTests(TestCase):
	def test_device_bridge_exposes_native_picker_and_retry_queue(self):
		bridge_path = Path(__file__).resolve().parent.parent / 'static' / 'mobile' / 'js' / 'device-bridge.js'
		content = bridge_path.read_text(encoding='utf-8')

		self.assertIn("QUEUE_KEY = 'adarsh.mobile.critical.retry.queue.v1'", content)
		self.assertIn('async function enqueueCriticalJson(url, payload, options)', content)
		self.assertIn('async function uploadFormDataWithRetry(url, formDataFactory, options)', content)
		self.assertIn('async function pickImage(options)', content)
		self.assertIn('async function checkPermissionBundle()', content)
		self.assertIn('async function requestPermissionBundle(options)', content)
		self.assertIn('async function openNativeSettings()', content)

	def test_mobile_bridge_uses_critical_queue_and_push_refresh_hooks(self):
		js_path = Path(__file__).resolve().parent.parent / 'static' / 'mobile' / 'js' / 'app.js'
		content = js_path.read_text(encoding='utf-8')

		self.assertIn('var bridge = window.adarshDeviceBridge || null;', content)
		self.assertIn('async function enqueueCriticalJson(url, payload, dedupeKey)', content)
		self.assertIn('var pushEnabledRaw = configPayload && configPayload.push_enabled;', content)
		self.assertIn("enqueueCriticalJson('/app/api/mobile-shell/device/ping/'", content)
		self.assertIn("PushNotifications.addListener('registrationError'", content)
		self.assertIn("App.addListener('appStateChange'", content)

	def test_camera_template_uses_native_picker_and_retryable_upload(self):
		camera_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'camera.html'
		content = camera_path.read_text(encoding='utf-8')

		self.assertIn('@click="openGalleryPicker()"', content)
		self.assertIn('async tryCameraRecovery()', content)
		self.assertIn('ensureImageInput(file, sourceLabel)', content)
		self.assertIn('Video captured from ', content)
		self.assertIn("window.addEventListener('pageshow'", content)
		self.assertIn("document.addEventListener('visibilitychange'", content)
		self.assertIn("if (document.visibilityState === 'hidden')", content)
		self.assertIn('bridge.uploadFormDataWithRetry(uploadUrl, buildUploadFormData', content)

	def test_website_upload_template_uses_native_picker_and_retryable_batches(self):
		website_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'website_manage.html'
		content = website_path.read_text(encoding='utf-8')

		self.assertIn('@click.prevent="pickPortfolioFromCamera($event)"', content)
		self.assertIn('async pickPortfolioFromGallery()', content)
		self.assertIn('source = (e && e.target === this.$refs.portfolioCameraInput) ? \'camera\' : \'gallery\';', content)
		self.assertIn('Camera returned video. Please switch to Photo mode and try again.', content)
		self.assertIn('bridge.uploadFormDataWithRetry(', content)

	def test_permissions_center_template_uses_bridge_permission_bundle(self):
		permissions_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'permissions.html'
		content = permissions_path.read_text(encoding='utf-8')

		self.assertIn('x-data="permissionsCenterApp()"', content)
		self.assertIn('bridge.checkPermissionBundle', content)
		self.assertIn('bridge.requestPermissionBundle', content)
		self.assertIn('bridge.openNativeSettings', content)


class MobileAppPhase5OfflineCachingContractTests(TestCase):
	@override_settings(APP_VERSION='v9.9.9', MOBILE_PWA_CACHE_GENERATION=7, MOBILE_PWA_CACHE_ROLLBACK_WINDOW=3)
	def test_service_worker_uses_app_version_and_generation_namespace(self):
		response = self.client.get('/app/sw.js?v=v9.9.9')
		self.assertEqual(response.status_code, 200)
		content = response.content.decode('utf-8')

		self.assertIn("const CACHE_NAMESPACE = 'g7-v9.9.9';", content)
		self.assertIn('const CACHE_GENERATION = 7;', content)
		self.assertIn('const ROLLBACK_WINDOW = 3;', content)
		self.assertIn('/static/mobile/js/app.js?v=v9.9.9.g7', content)

	def test_service_worker_defines_route_policy_buckets(self):
		response = self.client.get('/app/sw.js')
		self.assertEqual(response.status_code, 200)
		content = response.content.decode('utf-8')

		self.assertIn('const READ_ONLY_CACHEABLE_PATHS = ', content)
		self.assertIn('const ONLINE_REQUIRED_PREFIXES = ', content)
		self.assertIn('if (url.pathname.indexOf(\'/app/api/\') === 0)', content)
		self.assertIn('if (isOnlineRequiredPath(url.pathname)) {', content)
		self.assertIn('return offlineJsonResponse();', content)

	def test_mobile_templates_use_app_versioned_assets_and_sw_registration(self):
		project_root = Path(__file__).resolve().parent.parent
		base_path = project_root / 'templates' / 'mobile_app' / 'base.html'
		login_path = project_root / 'templates' / 'mobile_app' / 'login.html'

		base_content = base_path.read_text(encoding='utf-8')
		login_content = login_path.read_text(encoding='utf-8')

		self.assertIn('/app/manifest.json?v={{ APP_VERSION|urlencode }}', base_content)
		self.assertIn('/app/sw.js?v={{ APP_VERSION|urlencode }}', base_content)
		self.assertIn("{% static 'mobile/js/app.js' %}?v={{ APP_VERSION|urlencode }}", base_content)

		self.assertIn('/app/manifest.json?v={{ APP_VERSION|urlencode }}', login_content)
		self.assertIn('/app/sw.js?v={{ APP_VERSION|urlencode }}', login_content)
		self.assertIn("{% static 'mobile/js/environment-gate.js' %}?v={{ APP_VERSION|urlencode }}", login_content)

	def test_phase5_offline_matrix_covers_route_inventory(self):
		project_root = Path(__file__).resolve().parent.parent
		matrix_path = project_root / 'mobile_shell_app' / 'phase5' / 'offline_behavior_matrix.json'
		self.assertTrue(matrix_path.exists(), 'Missing phase5 offline behavior matrix')

		payload = json.loads(matrix_path.read_text(encoding='utf-8'))
		counts = payload.get('counts', {})
		self.assertEqual(counts.get('total_routes'), 55)
		self.assertEqual(len(payload.get('route_policies', [])), 55)


class MobileAppPhase6ReleasePipelineContractTests(TestCase):
	def test_android_workflow_supports_signed_release_and_aab(self):
		project_root = Path(__file__).resolve().parent.parent
		workflow_path = project_root / '.github' / 'workflows' / 'mobile-shell-android.yml'
		content = workflow_path.read_text(encoding='utf-8')

		self.assertIn('release_build:', content)
		self.assertIn('promote_latest_apk:', content)
		self.assertIn('ANDROID_KEYSTORE_B64', content)
		self.assertIn('./gradlew assembleRelease bundleRelease', content)
		self.assertIn('mobile_shell_app/android/app/build/outputs/bundle/release/app-release.aab', content)

	def test_android_workflow_has_latest_apk_policy_paths(self):
		project_root = Path(__file__).resolve().parent.parent
		workflow_path = project_root / '.github' / 'workflows' / 'mobile-shell-android.yml'
		content = workflow_path.read_text(encoding='utf-8')

		self.assertIn('static/website/apk/adarsh-admin.apk', content)
		self.assertIn('static/website/apk/archive/adarsh-admin-${RELEASE_LABEL}.apk', content)
		self.assertIn('static/website/apk/archive/adarsh-admin-${RELEASE_LABEL}.aab', content)

	def test_phase6_artifacts_include_smoke_and_monitoring_guidance(self):
		project_root = Path(__file__).resolve().parent.parent
		phase6_dir = project_root / 'mobile_shell_app' / 'phase6'

		required_files = [
			phase6_dir / 'release_pipeline_contract.md',
			phase6_dir / 'release_smoke_checklist.md',
			phase6_dir / 'rollout_monitoring_plan.md',
			phase6_dir / 'PHASE6_EXECUTION_LOG.md',
			phase6_dir / 'PHASE6_COMPLETION_REPORT.md',
		]
		for file_path in required_files:
			self.assertTrue(file_path.exists(), f'Missing phase6 artifact: {file_path.name}')

		monitoring = (phase6_dir / 'rollout_monitoring_plan.md').read_text(encoding='utf-8')
		self.assertIn('Crash-free sessions', monitoring)
		self.assertIn('ANR rate', monitoring)
		self.assertIn('5% for 4-6 hours', monitoring)

	def test_plan_tracks_phase6_completion(self):
		plan_path = Path(__file__).resolve().parent.parent / 'mobile_shell_app' / 'ANDROID_NATIVE_CONVERSION_PLAN.md'
		content = plan_path.read_text(encoding='utf-8')

		self.assertIn('## Phase 6 Completion (2026-04-11)', content)
		self.assertIn('release_pipeline_contract.md', content)
		self.assertIn('MobileAppPhase6ReleasePipelineContractTests', content)


class MobileAppPhase7RolloutGuardAutomationTests(TestCase):
	def test_phase7_command_exists_and_has_phase_thresholds(self):
		cmd_path = Path(__file__).resolve().parent.parent / 'mobile_app' / 'management' / 'commands' / 'mobile_rollout_guard.py'
		content = cmd_path.read_text(encoding='utf-8')

		self.assertIn('CRASH_FREE_SESSIONS_MIN = 99.0', content)
		self.assertIn('ANR_RATE_MAX = 0.47', content)
		self.assertIn('FAILURE_RATE_MULTIPLIER_MAX = 2.0', content)
		self.assertIn('--strict', content)

	def test_phase7_artifacts_include_guard_and_incident_docs(self):
		project_root = Path(__file__).resolve().parent.parent
		phase7_dir = project_root / 'mobile_shell_app' / 'phase7'

		required_files = [
			phase7_dir / 'rollout_gate_check_contract.md',
			phase7_dir / 'incident_response_runbook.md',
			phase7_dir / 'PHASE7_EXECUTION_LOG.md',
			phase7_dir / 'PHASE7_COMPLETION_REPORT.md',
		]
		for file_path in required_files:
			self.assertTrue(file_path.exists(), f'Missing phase7 artifact: {file_path.name}')

		contract = (phase7_dir / 'rollout_gate_check_contract.md').read_text(encoding='utf-8')
		self.assertIn('python manage.py mobile_rollout_guard', contract)
		self.assertIn('Crash-free sessions', contract)
		self.assertIn('ANR rate', contract)

	def test_phase7_pipeline_doc_has_rollout_guard_step(self):
		doc_path = Path(__file__).resolve().parent.parent / 'docs' / 'mobile-shell' / 'ANDROID_RELEASE_PIPELINE.md'
		content = doc_path.read_text(encoding='utf-8')

		self.assertIn('Phase 7 Rollout Guard Automation', content)
		self.assertIn('mobile_rollout_guard', content)
		self.assertIn('--strict', content)

	def test_plan_tracks_phase7_completion(self):
		plan_path = Path(__file__).resolve().parent.parent / 'mobile_shell_app' / 'ANDROID_NATIVE_CONVERSION_PLAN.md'
		content = plan_path.read_text(encoding='utf-8')

		self.assertIn('## Phase 7 Completion (2026-04-11)', content)
		self.assertIn('rollout_gate_check_contract.md', content)
		self.assertIn('MobileAppPhase7RolloutGuardAutomationTests', content)


class MobileAppPhase8ReleasePreflightCompletionTests(TestCase):
	def test_phase8_command_exists_and_has_strict_preflight_flags(self):
		cmd_path = Path(__file__).resolve().parent.parent / 'mobile_app' / 'management' / 'commands' / 'mobile_release_preflight.py'
		content = cmd_path.read_text(encoding='utf-8')

		self.assertIn('Run Android mobile-shell release preflight checks', content)
		self.assertIn('--strict', content)
		self.assertIn('--require-local-apk', content)

	def test_phase8_artifacts_include_preflight_contract_and_reports(self):
		project_root = Path(__file__).resolve().parent.parent
		phase8_dir = project_root / 'mobile_shell_app' / 'phase8'

		required_files = [
			phase8_dir / 'release_preflight_contract.md',
			phase8_dir / 'nice_to_have_backlog.md',
			phase8_dir / 'PHASE8_EXECUTION_LOG.md',
			phase8_dir / 'PHASE8_COMPLETION_REPORT.md',
		]
		for file_path in required_files:
			self.assertTrue(file_path.exists(), f'Missing phase8 artifact: {file_path.name}')

		contract = (phase8_dir / 'release_preflight_contract.md').read_text(encoding='utf-8')
		self.assertIn('python manage.py mobile_release_preflight', contract)
		self.assertIn('--strict', contract)

	def test_phase8_pipeline_doc_has_preflight_step(self):
		doc_path = Path(__file__).resolve().parent.parent / 'docs' / 'mobile-shell' / 'ANDROID_RELEASE_PIPELINE.md'
		content = doc_path.read_text(encoding='utf-8')

		self.assertIn('Phase 8 Final Preflight and Nice-to-Have Closure', content)
		self.assertIn('mobile_release_preflight', content)

	def test_plan_tracks_phase8_completion(self):
		plan_path = Path(__file__).resolve().parent.parent / 'mobile_shell_app' / 'ANDROID_NATIVE_CONVERSION_PLAN.md'
		content = plan_path.read_text(encoding='utf-8')

		self.assertIn('## Phase 8 Completion (2026-04-11)', content)
		self.assertIn('release_preflight_contract.md', content)
		self.assertIn('MobileAppPhase8ReleasePreflightCompletionTests', content)


class MobileAppProfileUpdateFlowContractTests(TestCase):
	def test_profile_template_has_update_button_hooked_to_mobile_update_flow(self):
		profile_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'profile.html'
		content = profile_path.read_text(encoding='utf-8')

		self.assertIn('Update App', content)
		self.assertIn('window.mobileUpdateApp(event)', content)

	def test_base_template_mobile_update_flow_fetches_config_and_opens_update_link(self):
		base_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'base.html'
		content = base_path.read_text(encoding='utf-8')

		self.assertIn('async function fetchMobileShellConfig()', content)
		self.assertIn('function resolveUpdateLink(configData)', content)
		self.assertIn('function shouldOpenInstallerForConfig(configData)', content)
		self.assertIn('var isLikelyApk = /\\.apk(?:\\?|#|$)/i.test(targetUrl);', content)
		self.assertIn('resolved.searchParams.set(\'_ts\', String(Date.now()));', content)
		self.assertIn('window.location.assign(targetUrl);', content)
		self.assertIn('var shouldOpenInstaller = shouldOpenInstallerForConfig(configData);', content)
		self.assertIn('var updateLink = resolveUpdateLink(configData);', content)
		self.assertIn('await openUpdateLink(updateLink, { preferExternalForApk: false });', content)
		self.assertIn('setUpdateProgress(90, \'Installer opened. Confirm install, then reopen the app.\');', content)

	def test_profile_template_shows_update_status_card_and_runtime_check(self):
		profile_path = Path(__file__).resolve().parent.parent / 'templates' / 'mobile_app' / 'profile.html'
		content = profile_path.read_text(encoding='utf-8')

		self.assertIn('App Update Status', content)
		self.assertIn('Refresh Update Status', content)
		self.assertIn('async loadUpdateStatus()', content)
		self.assertIn("fetch('/app/api/mobile-shell/config/'", content)
		self.assertIn('const payload = (data && data.success && data.data) ? data.data : null;', content)
		self.assertIn('payload.update_required', content)
		self.assertIn('payload.update_recommended', content)


class MobileAppPhase1SmokeAndVisualTests(MobileAppBaseTestCase):
	def _post_json(self, url, payload):
		return self.client.post(
			url,
			data=json.dumps(payload),
			content_type='application/json',
		)

	@mock.patch('mobile_app.views.ActivityService.log_login')
	@mock.patch('mobile_app.views.AuthService.authenticate_user')
	def test_phase1_auth_login_api_smoke_success(self, mock_authenticate, _mock_log_login):
		mock_authenticate.return_value = {
			'success': True,
			'user': self.super_admin,
			'message': 'ok',
		}

		response = self._post_json('/app/api/auth/login/', {
			'email': self.super_admin.email,
			'password': 'pass1234',
			'role': 'super_admin',
		})

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json().get('success'))

	def test_phase1_page_routes_smoke_matrix(self):
		self._login_mobile_super_admin()

		page_cases = [
			'/app/login/',
			'/app/no-access/',
			'/app/desktop-required/',
			'/app/',
			'/app/clients/',
			f'/app/clients/{self.client_profile.id}/groups/',
			'/app/groups/',
			'/app/tables/pending/',
			f'/app/table/{self.table.id}/pending/',
			f'/app/card/{self.card.id}/',
			f'/app/reprint/{self.client_profile.id}/',
			f'/app/reprint/table/{self.table.id}/',
			f'/app/camera/{self.table.id}/',
			f'/app/camera/{self.table.id}/{self.card.id}/',
			'/app/notifications/',
			'/app/profile/',
			'/app/permissions/',
			'/app/staff/',
			'/app/settings/',
			f'/app/search/?q=Student&filter=name&table_id={self.table.id}',
			'/app/website/',
		]

		for url in page_cases:
			response = self.client.get(url)
			self.assertIn(
				response.status_code,
				(200, 302, 403),
				msg=f'Unexpected status for page route {url}: {response.status_code}',
			)
			self.assertLess(response.status_code, 500, msg=f'5xx on page route {url}')

	def test_phase1_api_routes_smoke_matrix(self):
		self._login_mobile_super_admin()

		managed_staff_user = User.objects.create_user(
			username='phase1-manage-staff@test.com',
			email='phase1-manage-staff@test.com',
			password='pass1234',
			role='admin_staff',
		)
		managed_staff = Staff.objects.create(
			user=managed_staff_user,
			staff_type='admin_staff',
			perm_mobile_app=True,
		)

		temp_card_for_delete = IDCard.objects.create(
			table=self.table,
			field_data={'NAME': 'Phase1 Delete', 'ROLL NO': '9801'},
			status='pending',
		)

		managed_client_user = User.objects.create_user(
			username='phase1-client@test.com',
			email='phase1-client@test.com',
			password='pass1234',
			role='client',
		)
		managed_client = Client.objects.create(
			user=managed_client_user,
			name='Phase1 Client',
			status='active',
			perm_mobile_app=True,
		)

		portfolio_category = PortfolioCategory.objects.create(
			name='Phase1 Category',
			icon='fas fa-image',
			is_active=True,
			order=11,
		)

		api_cases = [
			{'method': 'get', 'url': f'/app/api/card/{self.card.id}/detail/', 'allowed': (200, 403)},
			{'method': 'post', 'url': f'/app/api/card/{self.card.id}/status/', 'payload': {'status': 'verified'}, 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/card/{temp_card_for_delete.id}/delete/', 'allowed': (200, 400, 403)},
			{'method': 'get', 'url': f'/app/api/table/{self.table.id}/cards/', 'allowed': (200, 403)},
			{'method': 'post', 'url': f'/app/api/table/{self.table.id}/bulk-status/', 'payload': {'ids': [self.card.id], 'status': 'verified'}, 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/table/{self.table.id}/upload-photo/', 'payload': {'card_id': self.card.id, 'field_name': 'PHOTO'}, 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/table/{self.table.id}/card/add/', 'payload': {'field_data': {'NAME': 'Phase1 Add', 'ROLL NO': '501'}}, 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/table/{self.table.id}/card/{self.card.id}/update/', 'payload': {'field_data': {'NAME': 'Phase1 Update'}}, 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/table/{self.table.id}/update-fields/', 'payload': {'fields': ['NAME', 'ROLL NO']}, 'allowed': (200, 400, 403)},
			{'method': 'get', 'url': '/app/api/staff/', 'allowed': (200, 403)},
			{'method': 'post', 'url': '/app/api/staff/create/', 'payload': {'first_name': 'Phase', 'last_name': 'Staff', 'email': 'phase1-staff-create@test.com'}, 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/staff/{managed_staff.id}/update/', 'payload': {'first_name': 'Phase1', 'last_name': 'Updated'}, 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/staff/{managed_staff.id}/toggle/', 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/staff/{managed_staff.id}/delete/', 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': '/app/api/profile/update/', 'payload': {'name': 'Phase One User'}, 'allowed': (200, 400, 403)},
			{'method': 'get', 'url': f'/app/api/search/?q=Student&filter=name&table_id={self.table.id}', 'allowed': (200, 400, 403)},
			{'method': 'get', 'url': '/app/api/server-info/', 'allowed': (200, 403)},
			{'method': 'get', 'url': '/app/api/mobile-shell/config/', 'allowed': (200, 403)},
			{'method': 'post', 'url': '/app/api/mobile-shell/device/register/', 'payload': {'platform': 'android', 'installation_id': 'instphase1abc12345', 'app_build': 1, 'app_version': '1.0.0', 'device_model': 'Pixel', 'os_version': '14', 'device_language': 'en'}, 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': '/app/api/mobile-shell/device/ping/', 'payload': {'installation_id': 'instphase1abc12345', 'app_build': 1, 'app_version': '1.0.0'}, 'allowed': (200, 400, 403)},
			{'method': 'get', 'url': '/app/api/mobile-shell/device/summary/', 'allowed': (200, 403)},
			{'method': 'get', 'url': '/app/api/impersonate/users/', 'allowed': (200, 403)},
			{'method': 'post', 'url': '/app/api/impersonate/start/', 'payload': {'target_user_id': self.client_user.id}, 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': '/app/api/impersonate/stop/', 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': '/app/api/client/create/', 'payload': {'name': 'Phase1 Created Client', 'email': 'phase1-created-client@test.com'}, 'allowed': (200, 400, 403)},
			{'method': 'get', 'url': f'/app/api/client/{managed_client.id}/', 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/client/{managed_client.id}/update/', 'payload': {'name': 'Phase1 Client Updated'}, 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/client/{managed_client.id}/toggle/', 'allowed': (200, 400, 403)},
			{'method': 'get', 'url': f'/app/api/client/{self.client_profile.id}/tables/', 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': f'/app/api/client/{managed_client.id}/delete/', 'allowed': (200, 400, 403)},
			{'method': 'post', 'url': '/app/api/website/portfolio/upload/', 'payload': {'category_id': portfolio_category.id}, 'allowed': (200, 400, 403)},
			{'method': 'get', 'url': f'/app/api/website/portfolio/category/{portfolio_category.id}/items/?limit=5', 'allowed': (200, 400, 403)},
		]

		self.assertEqual(len(api_cases), 32)

		for case in api_cases:
			method = case['method']
			url = case['url']
			payload = case.get('payload', {})

			if method == 'get':
				response = self.client.get(url)
			else:
				response = self._post_json(url, payload)

			self.assertIn(
				response.status_code,
				case['allowed'],
				msg=f'Unexpected status for API route {url}: {response.status_code}',
			)
			self.assertLess(response.status_code, 500, msg=f'5xx on API route {url}')

			if 'application/json' in (response.get('Content-Type', '') or ''):
				try:
					response.json()
				except ValueError:
					self.fail(f'Expected JSON payload for API route {url}')

	def test_phase1_visual_baseline_critical_templates(self):
		project_root = Path(__file__).resolve().parent.parent
		baseline_path = project_root / 'mobile_shell_app' / 'phase1' / 'critical_template_hashes.json'
		self.assertTrue(baseline_path.exists(), 'Missing phase1 visual baseline file')

		baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
		templates = baseline.get('templates', [])
		self.assertTrue(templates, 'No templates found in visual baseline file')

		for entry in templates:
			rel_path = entry['path']
			expected_hash = entry['sha256'].upper()
			file_path = project_root / rel_path
			self.assertTrue(file_path.exists(), f'Missing template: {rel_path}')

			actual_hash = hashlib.sha256(file_path.read_bytes()).hexdigest().upper()
			self.assertEqual(
				actual_hash,
				expected_hash,
				msg=f'Visual baseline drift detected for {rel_path}',
			)
