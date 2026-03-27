import json
from datetime import timedelta

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()


class ReprintRequestModelTests(TestCase):
	def test_reprint_request_string_representation(self):
		from client.models import Client
		from idcards.models import IDCardGroup, IDCardTable, IDCard
		from reprintcard.models import ReprintRequest

		owner = User.objects.create_user(
			username='owner-model@test.com',
			email='owner-model@test.com',
			password='pass1234',
			role='client',
		)
		client = Client.objects.create(user=owner, name='Model Client')
		group = IDCardGroup.objects.create(client=client, name='Model Group')
		table = IDCardTable.objects.create(
			group=group,
			name='Model Table',
			fields=[{'name': 'Name', 'type': 'text'}],
		)
		card = IDCard.objects.create(table=table, field_data={'Name': 'A'}, status='download')
		rr = ReprintRequest.objects.create(card=card, table=table, status='requested', requested_by=owner)

		self.assertIn(f'Reprint #{rr.id}', str(rr))
		self.assertIn(f'Card #{card.id}', str(rr))
		self.assertIn('requested', str(rr))


class ReprintWorkflowServiceTests(TestCase):
	def setUp(self):
		from client.models import Client
		from idcards.models import IDCardGroup, IDCardTable, IDCard
		from reprintcard.models import ReprintRequest

		self.owner = User.objects.create_user(
			username='owner-service@test.com',
			email='owner-service@test.com',
			password='pass1234',
			role='client',
		)
		self.client_obj = Client.objects.create(user=self.owner, name='Service Client')
		self.group = IDCardGroup.objects.create(client=self.client_obj, name='Service Group')
		self.table = IDCardTable.objects.create(
			group=self.group,
			name='Service Table',
			fields=[
				{'name': 'Name', 'type': 'text'},
				{'name': 'Class', 'type': 'class'},
				{'name': 'Section', 'type': 'section'},
			],
		)

		self.card_download_1 = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Card One', 'Class': '10', 'Section': 'A'},
			status='download',
		)
		self.card_download_2 = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Card Two', 'Class': '10', 'Section': 'B'},
			status='download',
		)
		self.card_pending = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Card Three'},
			status='pending',
		)

		self.rr_requested = ReprintRequest.objects.create(
			card=self.card_download_1,
			table=self.table,
			status='requested',
			requested_by=self.owner,
		)

	def test_create_requests_requires_card_ids(self):
		from reprintcard.services import ReprintWorkflowService

		result = ReprintWorkflowService.create_requests(table=self.table, card_ids=[], requested_by=self.owner)
		self.assertFalse(result.success)
		self.assertIn('No card IDs provided', result.message)

	def test_create_requests_creates_only_eligible_download_cards(self):
		from reprintcard.services import ReprintWorkflowService
		from reprintcard.models import ReprintRequest

		result = ReprintWorkflowService.create_requests(
			table=self.table,
			card_ids=[self.card_download_1.id, self.card_download_2.id, self.card_pending.id, 999999],
			reason='Need reprint',
			requested_by=self.owner,
		)

		self.assertTrue(result.success)
		self.assertEqual(result.data['created_count'], 1)
		self.assertEqual(result.data['skipped_count'], 1)
		self.assertTrue(
			ReprintRequest.objects.filter(
				card=self.card_download_2,
				table=self.table,
				status='requested',
			).exists()
		)
		self.assertFalse(ReprintRequest.objects.filter(card=self.card_pending).exists())

	def test_transition_blocks_invalid_requested_to_downloaded(self):
		from reprintcard.services import ReprintWorkflowService

		result = ReprintWorkflowService.transition(self.rr_requested, 'downloaded', user=self.owner)
		self.assertFalse(result.success)
		self.assertIn('Cannot change reprint status', result.message)

	def test_bulk_transition_confirms_only_requested(self):
		from reprintcard.services import ReprintWorkflowService
		from reprintcard.models import ReprintRequest

		rr_confirmed = ReprintRequest.objects.create(
			card=self.card_download_2,
			table=self.table,
			status='confirmed',
			requested_by=self.owner,
		)

		result = ReprintWorkflowService.bulk_transition(
			table=self.table,
			rr_ids=[self.rr_requested.id, rr_confirmed.id],
			target_status='confirmed',
			user=self.owner,
		)

		self.assertTrue(result.success)
		self.assertEqual(result.data['updated_count'], 1)
		self.rr_requested.refresh_from_db()
		rr_confirmed.refresh_from_db()
		self.assertEqual(self.rr_requested.status, 'confirmed')
		self.assertEqual(rr_confirmed.status, 'confirmed')

	def test_bulk_transition_updates_updated_at(self):
		from reprintcard.services import ReprintWorkflowService
		from reprintcard.models import ReprintRequest

		old_updated_at = timezone.now() - timedelta(days=1)
		ReprintRequest.objects.filter(id=self.rr_requested.id).update(updated_at=old_updated_at)

		result = ReprintWorkflowService.bulk_transition(
			table=self.table,
			rr_ids=[self.rr_requested.id],
			target_status='confirmed',
			user=self.owner,
		)

		self.assertTrue(result.success)
		self.rr_requested.refresh_from_db()
		self.assertGreater(self.rr_requested.updated_at, old_updated_at)

	def test_bulk_transition_rejects_invalid_rr_ids(self):
		from reprintcard.services import ReprintWorkflowService

		result = ReprintWorkflowService.bulk_transition(
			table=self.table,
			rr_ids=['x', None, {}],
			target_status='confirmed',
			user=self.owner,
		)

		self.assertFalse(result.success)
		self.assertIn('No reprint IDs provided', result.message)

	def test_reject_requests_moves_cards_to_pool(self):
		from reprintcard.services import ReprintWorkflowService
		from reprintcard.models import ReprintRequest

		result = ReprintWorkflowService.reject_requests(
			table=self.table,
			rr_ids=[self.rr_requested.id],
			move_card_to_pool=True,
		)

		self.assertTrue(result.success)
		self.assertEqual(result.data['rejected_count'], 1)
		self.assertFalse(ReprintRequest.objects.filter(id=self.rr_requested.id).exists())
		self.card_download_1.refresh_from_db()
		self.assertEqual(self.card_download_1.status, 'pool')
		self.assertIsNotNone(self.card_download_1.deleted_at)
		self.assertIsNotNone(self.card_download_1.status_changed_at)

	def test_debug_reprint_for_missing_id(self):
		from reprintcard.services import ReprintWorkflowService

		info = ReprintWorkflowService.debug_reprint(987654)
		self.assertIn('error', info)


class ReprintApiIntegrationTests(TestCase):
	def setUp(self):
		from client.models import Client
		from idcards.models import IDCardGroup, IDCardTable, IDCard
		from staff.models import Staff
		from reprintcard.models import ReprintRequest

		self.super_admin = User.objects.create_user(
			username='super-reprint@test.com',
			email='super-reprint@test.com',
			password='pass1234',
			role='super_admin',
		)

		self.client_user = User.objects.create_user(
			username='client-reprint@test.com',
			email='client-reprint@test.com',
			password='pass1234',
			role='client',
		)
		self.client_obj = Client.objects.create(
			user=self.client_user,
			name='Reprint Client',
			perm_idcard_reprint_list=True,
		)

		self.other_client_user = User.objects.create_user(
			username='other-client-reprint@test.com',
			email='other-client-reprint@test.com',
			password='pass1234',
			role='client',
		)
		self.other_client = Client.objects.create(
			user=self.other_client_user,
			name='Other Reprint Client',
		)

		self.group = IDCardGroup.objects.create(client=self.client_obj, name='Reprint Group')
		self.table = IDCardTable.objects.create(
			group=self.group,
			name='Reprint Table',
			fields=[
				{'name': 'Name', 'type': 'text'},
				{'name': 'Class', 'type': 'class'},
				{'name': 'Section', 'type': 'section'},
			],
		)

		self.card_a = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Alpha', 'Class': '10', 'Section': 'A'},
			status='download',
		)
		self.card_b = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Beta', 'Class': '10', 'Section': 'B'},
			status='download',
		)

		self.rr_requested = ReprintRequest.objects.create(
			card=self.card_a,
			table=self.table,
			status='requested',
			requested_by=self.super_admin,
		)

		self.assigned_staff_user = User.objects.create_user(
			username='assigned-staff@test.com',
			email='assigned-staff@test.com',
			password='pass1234',
			role='admin_staff',
		)
		self.assigned_staff = Staff.objects.create(
			user=self.assigned_staff_user,
			staff_type='admin_staff',
			perm_idcard_reprint_list=True,
		)
		self.assigned_staff.assigned_clients.add(self.client_obj)

		self.unassigned_staff_user = User.objects.create_user(
			username='unassigned-staff@test.com',
			email='unassigned-staff@test.com',
			password='pass1234',
			role='admin_staff',
		)
		Staff.objects.create(
			user=self.unassigned_staff_user,
			staff_type='admin_staff',
			perm_idcard_reprint_list=True,
		)

	def _url(self, name, table_id=None):
		from django.urls import reverse

		tid = table_id or self.table.id
		return reverse(f'reprintcard:{name}', args=[tid])

	def test_step_counts_requires_authentication(self):
		response = self.client.get(self._url('api_reprint_step_counts'))
		self.assertIn(response.status_code, [302, 401])

	def test_step_counts_denies_unassigned_admin_staff_scope(self):
		self.client.force_login(self.unassigned_staff_user)
		response = self.client.get(self._url('api_reprint_step_counts'))
		self.assertEqual(response.status_code, 403)

	def test_step_counts_for_assigned_staff(self):
		self.client.force_login(self.assigned_staff_user)
		response = self.client.get(self._url('api_reprint_step_counts'))

		self.assertEqual(response.status_code, 200)
		payload = response.json()
		self.assertEqual(payload['status'], 'ok')
		self.assertEqual(payload['download_list'], 2)
		self.assertEqual(payload['request_list'], 1)

	def test_reprint_request_create_invalid_json(self):
		self.client.force_login(self.super_admin)
		response = self.client.post(
			self._url('api_reprint_request_create'),
			data='bad-json',
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)

	def test_reprint_request_create_and_request_list(self):
		self.client.force_login(self.super_admin)

		create_response = self.client.post(
			self._url('api_reprint_request_create'),
			data=json.dumps({'card_ids': [self.card_b.id], 'reason': 'Correction'}),
			content_type='application/json',
		)
		self.assertEqual(create_response.status_code, 200)
		self.assertEqual(create_response.json()['created_count'], 1)

		list_response = self.client.get(self._url('api_request_list'))
		self.assertEqual(list_response.status_code, 200)
		self.assertGreaterEqual(len(list_response.json()['items']), 2)

	def test_request_list_non_numeric_query_is_stable(self):
		self.client.force_login(self.super_admin)
		response = self.client.get(self._url('api_request_list'), {'q': 'alpha'})
		self.assertEqual(response.status_code, 200)

	def test_confirm_invalid_rr_ids_payload_returns_400(self):
		self.client.force_login(self.super_admin)
		response = self.client.post(
			self._url('api_reprint_confirm'),
			data=json.dumps({'rr_ids': ['bad', None, {}]}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)

	def test_confirm_requires_admin_role_even_with_client_permission(self):
		from reprintcard.models import ReprintRequest

		self.client.force_login(self.client_user)
		rr = ReprintRequest.objects.create(
			card=self.card_b,
			table=self.table,
			status='requested',
			requested_by=self.super_admin,
		)
		response = self.client.post(
			self._url('api_reprint_confirm'),
			data=json.dumps({'rr_ids': [rr.id]}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 403)

	def test_confirm_then_mark_downloaded(self):
		from reprintcard.models import ReprintRequest

		self.client.force_login(self.super_admin)
		confirm_response = self.client.post(
			self._url('api_reprint_confirm'),
			data=json.dumps({'rr_ids': [self.rr_requested.id]}),
			content_type='application/json',
		)
		self.assertEqual(confirm_response.status_code, 200)

		self.rr_requested.refresh_from_db()
		self.assertEqual(self.rr_requested.status, 'confirmed')

		mark_response = self.client.post(
			self._url('api_reprint_mark_downloaded'),
			data=json.dumps({'rr_ids': [self.rr_requested.id]}),
			content_type='application/json',
		)
		self.assertEqual(mark_response.status_code, 200)

		self.rr_requested.refresh_from_db()
		self.assertEqual(self.rr_requested.status, 'downloaded')

		download_response = self.client.get(self._url('api_download_list'))
		self.assertEqual(download_response.status_code, 200)
		rr_ids = [item['rr_id'] for item in download_response.json()['items']]
		self.assertIn(self.rr_requested.id, rr_ids)

		self.assertTrue(ReprintRequest.objects.filter(id=self.rr_requested.id, status='downloaded').exists())

	def test_reject_moves_card_to_pool(self):
		self.client.force_login(self.super_admin)
		response = self.client.post(
			self._url('api_reprint_reject'),
			data=json.dumps({'rr_ids': [self.rr_requested.id]}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)

		self.card_a.refresh_from_db()
		self.assertEqual(self.card_a.status, 'pool')

	def test_send_to_print_requires_selected_ids(self):
		self.client.force_login(self.super_admin)
		response = self.client.post(
			self._url('api_reprint_send_to_print'),
			data=json.dumps({'rr_ids': []}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)

	def test_send_to_print_creates_print_request_and_moves_to_confirmed(self):
		from cardprint.models import PrintRequest

		self.client.force_login(self.super_admin)
		response = self.client.post(
			self._url('api_reprint_send_to_print'),
			data=json.dumps({'rr_ids': [self.rr_requested.id]}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)

		self.rr_requested.refresh_from_db()
		self.assertEqual(self.rr_requested.status, 'confirmed')
		self.assertTrue(
			PrintRequest.objects.filter(
				table=self.table,
				card_id=self.card_a.id,
				status='print_list',
			).exists()
		)
