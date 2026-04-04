import json
from unittest import mock
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from client.models import Client
from idcards.models import IDCard, IDCardGroup, IDCardTable
from staff.models import Staff
from website.models import PortfolioCategory


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

	def _set_mobile_auth_checkpoint(self):
		session = self.client.session
		session['mobile_auth_ok'] = True
		session.save()

	def _login_mobile_super_admin(self):
		self.client.login(username='mob-super@test.com', password='pass1234')
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
		self.assertRegex(content, r"const STATIC_CACHE = 'adarsh-static-v\d+';")
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


class MobileAppManagementApiTests(MobileAppBaseTestCase):
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
