import json

from django.test import TestCase
from django.contrib.auth import get_user_model

User = get_user_model()


class CardPrintModelTests(TestCase):
	def setUp(self):
		from client.models import Client
		from idcards.models import IDCardGroup, IDCardTable, IDCard

		owner = User.objects.create_user(
			username='owner-cardprint-model@test.com',
			email='owner-cardprint-model@test.com',
			password='pass1234',
			role='client',
		)
		self.client_obj = Client.objects.create(user=owner, name='CardPrint Model Client')
		self.group = IDCardGroup.objects.create(client=self.client_obj, name='Model Group')
		self.table = IDCardTable.objects.create(
			group=self.group,
			name='Model Table',
			fields=[{'name': 'Name', 'type': 'text'}],
		)
		self.card = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Card One'},
			status='approved',
		)

	def test_print_request_string_representation(self):
		from cardprint.models import PrintRequest

		pr = PrintRequest.objects.create(
			card=self.card,
			table=self.table,
			status='print_list',
		)
		self.assertIn(f'Print #{pr.id}', str(pr))
		self.assertIn(f'Card #{self.card.id}', str(pr))

	def test_validate_field_mappings_success_and_failures(self):
		from cardprint.models import validate_field_mappings

		valid = {
			'front': {'Name': {'x_mm': 1, 'y_mm': 2, 'w_mm': 30, 'h_mm': 8}},
			'back': {},
		}
		self.assertIsNone(validate_field_mappings(valid))

		self.assertIn('JSON object', validate_field_mappings('bad'))
		self.assertIn('only contain keys', validate_field_mappings({'left': {}}))
		self.assertIn('missing', validate_field_mappings({'front': {'Name': {'x_mm': 1}}}))


class PrintWorkflowServiceTests(TestCase):
	def setUp(self):
		from client.models import Client
		from idcards.models import IDCardGroup, IDCardTable, IDCard
		from cardprint.models import PrintRequest

		self.user = User.objects.create_user(
			username='workflow-user@test.com',
			email='workflow-user@test.com',
			password='pass1234',
			role='super_admin',
		)
		owner = User.objects.create_user(
			username='workflow-owner@test.com',
			email='workflow-owner@test.com',
			password='pass1234',
			role='client',
		)
		self.client_obj = Client.objects.create(user=owner, name='Workflow Client')
		self.group = IDCardGroup.objects.create(client=self.client_obj, name='Workflow Group')
		self.table = IDCardTable.objects.create(
			group=self.group,
			name='Workflow Table',
			fields=[{'name': 'Name', 'type': 'text'}],
		)

		self.card_1 = IDCard.objects.create(table=self.table, field_data={'Name': 'A'}, status='approved')
		self.card_2 = IDCard.objects.create(table=self.table, field_data={'Name': 'B'}, status='approved')

		self.pr_print = PrintRequest.objects.create(
			card=self.card_1,
			table=self.table,
			status='print_list',
			requested_by=self.user,
		)

	def test_create_requests_requires_card_ids(self):
		from cardprint.services import PrintWorkflowService

		result = PrintWorkflowService.create_requests(self.table, [], self.user)
		self.assertFalse(result.success)
		self.assertIn('No card IDs provided', result.message)

	def test_create_requests_skips_existing_active_requests(self):
		from cardprint.services import PrintWorkflowService
		from cardprint.models import PrintRequest

		result = PrintWorkflowService.create_requests(
			self.table,
			[self.card_1.id, self.card_2.id],
			self.user,
		)
		self.assertTrue(result.success)
		self.assertEqual(result.data['created'], 1)
		self.assertEqual(result.data['skipped'], 1)
		self.assertTrue(PrintRequest.objects.filter(card=self.card_2, status='print_list').exists())

	def test_bulk_send_to_generate_transitions_only_print_list(self):
		from cardprint.services import PrintWorkflowService
		from cardprint.models import PrintRequest

		pr_finalized = PrintRequest.objects.create(
			card=self.card_2,
			table=self.table,
			status='finalized',
			requested_by=self.user,
		)
		result = PrintWorkflowService.bulk_send_to_generate([self.pr_print.id, pr_finalized.id], self.user)

		self.assertTrue(result.success)
		self.assertEqual(result.data['updated'], 1)
		self.pr_print.refresh_from_db()
		pr_finalized.refresh_from_db()
		self.assertEqual(self.pr_print.status, 'generate_list')
		self.assertEqual(pr_finalized.status, 'finalized')

	def test_bulk_move_to_print_list_rejects_invalid_source(self):
		from cardprint.services import PrintWorkflowService

		result = PrintWorkflowService.bulk_move_to_print_list([self.pr_print.id], self.user, 'print_list')
		self.assertFalse(result.success)
		self.assertIn('Invalid source status', result.message)

	def test_bulk_mark_pool_moves_only_finalized(self):
		from cardprint.services import PrintWorkflowService
		from cardprint.models import PrintRequest

		pr_finalized = PrintRequest.objects.create(
			card=self.card_2,
			table=self.table,
			status='finalized',
			requested_by=self.user,
		)
		result = PrintWorkflowService.bulk_mark_pool([self.pr_print.id, pr_finalized.id], self.user)
		self.assertTrue(result.success)
		self.assertEqual(result.data['updated'], 1)
		pr_finalized.refresh_from_db()
		self.assertEqual(pr_finalized.status, 'pool')

	def test_delete_requests_deletes_only_print_list(self):
		from cardprint.services import PrintWorkflowService
		from cardprint.models import PrintRequest

		pr_generate = PrintRequest.objects.create(
			card=self.card_2,
			table=self.table,
			status='generate_list',
			requested_by=self.user,
		)
		result = PrintWorkflowService.delete_requests([self.pr_print.id, pr_generate.id], self.user)
		self.assertTrue(result.success)
		self.assertEqual(result.data['deleted'], 1)
		self.assertFalse(PrintRequest.objects.filter(id=self.pr_print.id).exists())
		self.assertTrue(PrintRequest.objects.filter(id=pr_generate.id).exists())


class CardPrintApiIntegrationTests(TestCase):
	def setUp(self):
		from client.models import Client
		from idcards.models import IDCardGroup, IDCardTable, IDCard
		from staff.models import Staff
		from cardprint.models import PrintRequest

		self.super_admin = User.objects.create_user(
			username='super-cardprint@test.com',
			email='super-cardprint@test.com',
			password='pass1234',
			role='super_admin',
		)

		owner = User.objects.create_user(
			username='owner-cardprint@test.com',
			email='owner-cardprint@test.com',
			password='pass1234',
			role='client',
		)
		self.client_obj = Client.objects.create(user=owner, name='CardPrint Client')
		self.group = IDCardGroup.objects.create(client=self.client_obj, name='CardPrint Group')
		self.table = IDCardTable.objects.create(
			group=self.group,
			name='CardPrint Table',
			fields=[
				{'name': 'Name', 'type': 'text'},
				{'name': 'Photo', 'type': 'photo'},
			],
		)

		self.card_approved_1 = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Approved One', 'Photo': 'adarshimg/a1.jpg'},
			status='approved',
		)
		self.card_approved_2 = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Approved Two', 'Photo': 'adarshimg/a2.jpg'},
			status='approved',
		)

		self.assigned_staff_user = User.objects.create_user(
			username='assigned-print-staff@test.com',
			email='assigned-print-staff@test.com',
			password='pass1234',
			role='admin_staff',
		)
		self.assigned_staff = Staff.objects.create(
			user=self.assigned_staff_user,
			staff_type='admin_staff',
			perm_print_list=True,
			perm_finalized_list=True,
		)
		self.assigned_staff.assigned_clients.add(self.client_obj)

		self.unassigned_staff_user = User.objects.create_user(
			username='unassigned-print-staff@test.com',
			email='unassigned-print-staff@test.com',
			password='pass1234',
			role='admin_staff',
		)
		Staff.objects.create(
			user=self.unassigned_staff_user,
			staff_type='admin_staff',
			perm_print_list=True,
			perm_finalized_list=True,
		)

		self.pr_print = PrintRequest.objects.create(
			card=self.card_approved_1,
			table=self.table,
			status='print_list',
			requested_by=self.super_admin,
		)
		self.pr_generate = PrintRequest.objects.create(
			card=self.card_approved_2,
			table=self.table,
			status='generate_list',
			requested_by=self.super_admin,
		)

	def _url(self, name):
		from django.urls import reverse

		return reverse(f'cardprint:{name}', args=[self.table.id])

	def test_step_counts_denied_for_unassigned_staff(self):
		self.client.force_login(self.unassigned_staff_user)
		response = self.client.get(self._url('api_print_step_counts'))
		self.assertEqual(response.status_code, 403)

	def test_print_send_invalid_json(self):
		self.client.force_login(self.assigned_staff_user)
		response = self.client.post(
			self._url('api_print_send'),
			data='bad-json',
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)

	def test_print_send_moves_approved_cards_to_download(self):
		from cardprint.models import PrintRequest

		from idcards.models import IDCard
		fresh_card = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Approved Fresh', 'Photo': 'adarshimg/fresh.jpg'},
			status='approved',
		)

		self.client.force_login(self.assigned_staff_user)
		response = self.client.post(
			self._url('api_print_send'),
			data=json.dumps({'card_ids': [fresh_card.id]}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)
		payload = response.json()
		self.assertEqual(payload['status'], 'ok')
		self.assertEqual(payload['created'], 1)

		fresh_card.refresh_from_db()
		self.assertEqual(fresh_card.status, 'download')
		self.assertTrue(PrintRequest.objects.filter(card=fresh_card, status='print_list').exists())

	def test_print_list_returns_items(self):
		self.client.force_login(self.assigned_staff_user)
		response = self.client.get(self._url('api_print_list'))
		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.json()['status'], 'ok')
		self.assertGreaterEqual(len(response.json()['items']), 1)

	def test_print_generate_and_back_to_print(self):
		self.client.force_login(self.assigned_staff_user)

		to_generate = self.client.post(
			self._url('api_print_generate'),
			data=json.dumps({'request_ids': [self.pr_print.id]}),
			content_type='application/json',
		)
		self.assertEqual(to_generate.status_code, 200)

		self.pr_print.refresh_from_db()
		self.assertEqual(self.pr_print.status, 'generate_list')

		back_to_print = self.client.post(
			self._url('api_print_generate_to_print'),
			data=json.dumps({'request_ids': [self.pr_print.id]}),
			content_type='application/json',
		)
		self.assertEqual(back_to_print.status_code, 200)

		self.pr_print.refresh_from_db()
		self.assertEqual(self.pr_print.status, 'print_list')

	def test_field_config_save_validation_and_success(self):
		self.client.force_login(self.assigned_staff_user)

		bad = self.client.post(
			self._url('api_field_config_save'),
			data=json.dumps({'is_two_sided': False, 'front_fields': ['Unknown']}),
			content_type='application/json',
		)
		self.assertEqual(bad.status_code, 400)

		ok = self.client.post(
			self._url('api_field_config_save'),
			data=json.dumps({'is_two_sided': False, 'front_fields': ['Name']}),
			content_type='application/json',
		)
		self.assertEqual(ok.status_code, 200)
		self.assertEqual(ok.json()['status'], 'ok')

	def test_template_save_rejects_invalid_mapping(self):
		self.client.force_login(self.assigned_staff_user)
		response = self.client.post(
			self._url('api_template_save'),
			data=json.dumps({'field_mappings': {'wrong': {}}, 'font_size': 8}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 400)

	def test_mark_pool_moves_finalized_items(self):
		from cardprint.models import PrintRequest

		self.pr_generate.status = 'finalized'
		self.pr_generate.save(update_fields=['status'])

		self.client.force_login(self.assigned_staff_user)
		response = self.client.post(
			self._url('api_print_mark_pool'),
			data=json.dumps({'request_ids': [self.pr_generate.id]}),
			content_type='application/json',
		)
		self.assertEqual(response.status_code, 200)

		self.pr_generate.refresh_from_db()
		self.assertEqual(self.pr_generate.status, 'pool')
		self.assertTrue(PrintRequest.objects.filter(id=self.pr_generate.id, status='pool').exists())
