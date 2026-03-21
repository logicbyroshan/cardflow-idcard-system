import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile

from client.models import Client
from idcards.models import IDCard, IDCardGroup, IDCardTable
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

	def test_client_toggle_allowed_for_super_admin(self):
		self._login_mobile_super_admin()
		response = self.client.post(f'/app/api/client/{self.client_profile.id}/toggle/')
		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()['success'])

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
