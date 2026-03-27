from django.test import TestCase
from django.contrib.auth import get_user_model

User = get_user_model()


class IDCardsModelTests(TestCase):
	def setUp(self):
		from client.models import Client
		from idcards.models import IDCardGroup, IDCardTable

		self.owner = User.objects.create_user(
			username='owner-model-id@test.com',
			email='owner-model-id@test.com',
			password='pass1234',
			role='client',
		)
		self.client_obj = Client.objects.create(user=self.owner, name='Model IDCards Client')
		self.group = IDCardGroup.objects.create(client=self.client_obj, name='Class 10')
		self.table = IDCardTable.objects.create(
			group=self.group,
			name='Students',
			fields=[
				{'name': 'Name', 'type': 'text', 'mandatory': True},
				{'name': 'Class', 'type': 'class', 'mandatory': True},
				{'name': 'Section', 'type': 'section', 'mandatory': False},
				{'name': 'Photo', 'type': 'photo', 'mandatory': True},
			],
		)

	def test_table_field_helpers_detect_class_section_and_images(self):
		self.assertTrue(self.table.has_class_field())
		self.assertTrue(self.table.has_section_field())
		self.assertTrue(self.table.has_image_fields())
		self.assertEqual(self.table.get_image_fields(), ['Photo'])

	def test_idcard_save_sanitizes_text_but_keeps_image_markers(self):
		from idcards.models import IDCard

		card = IDCard.objects.create(
			table=self.table,
			field_data={
				'Name': 'Aditya🙂\u0007 Kumar',
				'Photo': 'PENDING:photo_1.jpg',
			},
			status='pending',
		)

		card.refresh_from_db()
		self.assertEqual(card.field_data['Name'], 'Aditya Kumar')
		self.assertEqual(card.field_data['Photo'], 'PENDING:photo_1.jpg')

	def test_idcard_client_and_group_properties(self):
		from idcards.models import IDCard

		card = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Neha', 'Class': '10', 'Photo': 'adarshimg/a.jpg'},
			status='pending',
		)

		self.assertEqual(card.group.id, self.group.id)
		self.assertEqual(card.client.id, self.client_obj.id)


class WorkflowServiceTests(TestCase):
	def setUp(self):
		from client.models import Client
		from idcards.models import IDCardGroup, IDCardTable, IDCard

		self.super_admin = User.objects.create_user(
			username='super-workflow@test.com',
			email='super-workflow@test.com',
			password='pass1234',
			role='super_admin',
		)
		self.client_user = User.objects.create_user(
			username='client-workflow@test.com',
			email='client-workflow@test.com',
			password='pass1234',
			role='client',
		)
		self.client_obj = Client.objects.create(
			user=self.client_user,
			name='Workflow Client',
			status='active',
			perm_idcard_verify=True,
			perm_idcard_approve=True,
			perm_idcard_delete=True,
			perm_idcard_retrieve=False,
			perm_idcard_reprint_list=True,
		)

		self.group = IDCardGroup.objects.create(client=self.client_obj, name='Workflow Group')
		self.table = IDCardTable.objects.create(
			group=self.group,
			name='Workflow Table',
			fields=[
				{'name': 'Name', 'type': 'text', 'mandatory': True},
				{'name': 'Photo', 'type': 'photo', 'mandatory': True},
				{'name': 'Class', 'type': 'class', 'mandatory': False},
			],
		)

		self.card_good_pending = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Good', 'Photo': 'adarshimg/good.jpg', 'Class': '10'},
			status='pending',
		)
		self.card_missing_text = IDCard.objects.create(
			table=self.table,
			field_data={'Name': '', 'Photo': 'adarshimg/missing-text.jpg'},
			status='pending',
		)
		self.card_missing_image = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'No Image', 'Photo': ''},
			status='pending',
		)

	def test_get_allowed_transitions_filters_by_permissions(self):
		from idcards.services_workflow import WorkflowService

		allowed = WorkflowService.get_allowed_transitions(self.card_good_pending, user=self.client_user)
		self.assertIn('verified', allowed)
		self.assertIn('pool', allowed)

	def test_transition_rejects_invalid_target_status(self):
		from idcards.services_workflow import WorkflowService

		result = WorkflowService.transition(
			self.card_good_pending,
			'not-a-status',
			user=self.client_user,
		)
		self.assertFalse(result.success)
		self.assertIn('Invalid status', result.message)

	def test_transition_blocks_when_mandatory_fields_missing(self):
		from idcards.services_workflow import WorkflowService

		result = WorkflowService.transition(
			self.card_missing_text,
			'verified',
			user=self.client_user,
		)
		self.assertFalse(result.success)
		self.assertIn('required fields are empty', result.message)

	def test_transition_blocks_when_mandatory_images_missing(self):
		from idcards.services_workflow import WorkflowService

		result = WorkflowService.transition(
			self.card_missing_image,
			'verified',
			user=self.client_user,
		)
		self.assertFalse(result.success)
		self.assertIn('required fields are empty', result.message)

	def test_super_admin_bypasses_required_field_and_image_gates(self):
		from idcards.services_workflow import WorkflowService

		result = WorkflowService.transition(
			self.card_missing_image,
			'verified',
			user=self.super_admin,
		)
		self.assertTrue(result.success)
		self.card_missing_image.refresh_from_db()
		self.assertEqual(self.card_missing_image.status, 'verified')

	def test_transition_pool_to_pending_requires_retrieve_permission(self):
		from idcards.models import IDCard
		from idcards.services_workflow import WorkflowService

		card = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Pool Card', 'Photo': 'adarshimg/pool.jpg'},
			status='pool',
		)
		result = WorkflowService.transition(card, 'pending', user=self.client_user)
		self.assertFalse(result.success)
		self.assertIn('Permission denied', result.message)

	def test_transition_sets_and_clears_downloaded_timestamp(self):
		from idcards.models import IDCard
		from idcards.services_workflow import WorkflowService

		card = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'Approved Card', 'Photo': 'adarshimg/appr.jpg'},
			status='approved',
		)

		first = WorkflowService.transition(card, 'download', user=self.super_admin)
		self.assertTrue(first.success)
		card.refresh_from_db()
		self.assertIsNotNone(card.downloaded_at)
		self.assertEqual(card.modified_by, self.super_admin.username)

		second = WorkflowService.transition(card, 'approved', user=self.super_admin)
		self.assertTrue(second.success)
		card.refresh_from_db()
		self.assertIsNone(card.downloaded_at)

	def test_bulk_transition_updates_eligible_and_skips_invalid(self):
		from idcards.services_workflow import WorkflowService

		result = WorkflowService.bulk_transition(
			table=self.table,
			card_ids=[self.card_good_pending.id, self.card_missing_text.id, self.card_missing_image.id],
			target_status='verified',
			user=self.client_user,
		)
		self.assertTrue(result.success)
		self.assertEqual(result.data['updated_count'], 1)
		self.assertEqual(result.data['skipped_count'], 2)

		self.card_good_pending.refresh_from_db()
		self.card_missing_text.refresh_from_db()
		self.card_missing_image.refresh_from_db()
		self.assertEqual(self.card_good_pending.status, 'verified')
		self.assertEqual(self.card_missing_text.status, 'pending')
		self.assertEqual(self.card_missing_image.status, 'pending')

	def test_bulk_transition_to_pool_sets_deleted_timestamp(self):
		from idcards.models import IDCard
		from idcards.services_workflow import WorkflowService

		card_verified = IDCard.objects.create(
			table=self.table,
			field_data={'Name': 'To Pool', 'Photo': 'adarshimg/poolit.jpg'},
			status='verified',
		)

		result = WorkflowService.bulk_transition(
			table=self.table,
			card_ids=[card_verified.id],
			target_status='pool',
			user=self.client_user,
		)
		self.assertTrue(result.success)
		card_verified.refresh_from_db()
		self.assertEqual(card_verified.status, 'pool')
		self.assertIsNotNone(card_verified.deleted_at)

	def test_debug_workflow_reports_missing_fields_and_images(self):
		from idcards.services_workflow import WorkflowService

		info = WorkflowService.debug_workflow(self.card_missing_image.id, user=self.client_user)
		self.assertEqual(info['current_status'], 'pending')
		self.assertNotIn('Name', info['mandatory_fields_missing'])
		self.assertIn('Photo', info['image_fields_missing'])

	def test_transition_without_user_does_not_crash(self):
		from idcards.services_workflow import WorkflowService

		result = WorkflowService.transition(
			self.card_good_pending,
			'verified',
			user=None,
		)
		self.assertTrue(result.success)
		self.card_good_pending.refresh_from_db()
		self.assertEqual(self.card_good_pending.status, 'verified')

	def test_bulk_transition_normalizes_invalid_card_ids(self):
		from idcards.services_workflow import WorkflowService

		result = WorkflowService.bulk_transition(
			table=self.table,
			card_ids=['bad', None, -1, self.card_good_pending.id, str(self.card_good_pending.id)],
			target_status='verified',
			user=self.client_user,
		)

		self.assertTrue(result.success)
		self.card_good_pending.refresh_from_db()
		self.assertEqual(self.card_good_pending.status, 'verified')

	def test_bulk_transition_ignores_locked_cards_outside_target_table(self):
		from idcards.models import IDCardGroup, IDCardTable, IDCard
		from idcards.services_workflow import WorkflowService

		other_group = IDCardGroup.objects.create(client=self.client_obj, name='Other Group')
		other_table = IDCardTable.objects.create(
			group=other_group,
			name='Other Table',
			fields=self.table.fields,
		)
		locked_other_table_card = IDCard.objects.create(
			table=other_table,
			field_data={'Name': 'Locked', 'Photo': 'adarshimg/locked.jpg'},
			status='approved',
		)

		result = WorkflowService.bulk_transition(
			table=self.table,
			card_ids=[self.card_good_pending.id, locked_other_table_card.id],
			target_status='verified',
			user=self.client_user,
		)

		self.assertTrue(result.success)
		self.card_good_pending.refresh_from_db()
		locked_other_table_card.refresh_from_db()
		self.assertEqual(self.card_good_pending.status, 'verified')
		self.assertEqual(locked_other_table_card.status, 'approved')
