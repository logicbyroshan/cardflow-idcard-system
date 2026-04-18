import json

from django.test import TestCase

from core.models import BackgroundTask, SuperModeAssignment, User
from core.services.super_mode_service import SuperModeService


class SuperModeServiceTests(TestCase):
    def setUp(self):
        self.pro_user = User.objects.create_user(
            username='pro_user_test',
            email='pro_user_test@example.com',
            password='pass12345',
            role='pro_user',
        )
        self.super_admin = User.objects.create_user(
            username='sa_user_test',
            email='sa_user_test@example.com',
            password='pass12345',
            role='super_admin',
        )
        self.operator = User.objects.create_user(
            username='operator_user_test',
            email='operator_user_test@example.com',
            password='pass12345',
            role='admin_staff',
        )

    def test_assign_operator_rejects_invalid_ram_value(self):
        with self.assertRaises(ValueError):
            SuperModeService.assign_user(
                self.pro_user,
                self.operator,
                enabled=True,
                ram_mb=300,
            )

    def test_assign_operator_accepts_role_limited_ram(self):
        assignment = SuperModeService.assign_user(
            self.pro_user,
            self.operator,
            enabled=True,
            ram_mb=250,
        )

        self.assertTrue(assignment.is_assigned)
        self.assertEqual(assignment.ram_allocation_mb, 250)
        self.assertFalse(assignment.is_enabled)

    def test_pro_user_self_supports_up_to_750(self):
        assignment = SuperModeService.configure_pro_user_self(
            self.pro_user,
            enabled=True,
            ram_mb=750,
        )

        self.assertTrue(assignment.is_assigned)
        self.assertTrue(assignment.is_enabled)
        self.assertEqual(assignment.ram_allocation_mb, 750)

    def test_runtime_toggle_requires_assignment(self):
        with self.assertRaises(ValueError):
            SuperModeService.toggle_runtime(self.operator, enabled=True)

    def test_phase2_performance_policies_scale_with_ram_tier(self):
        SuperModeService.assign_user(
            self.pro_user,
            self.operator,
            enabled=True,
            ram_mb=250,
        )
        SuperModeService.toggle_runtime(self.operator, enabled=True)

        self.assertEqual(SuperModeService.upload_chunk_size_bytes(self.operator), 16 * 1024 * 1024)
        self.assertEqual(SuperModeService.download_block_size_bytes(self.operator), 256 * 1024)
        self.assertEqual(SuperModeService.allowed_concurrent_tasks(self.operator), 2)
        self.assertEqual(SuperModeService.calculate_export_lock_boost(self.operator), 1)
        self.assertEqual(SuperModeService.rate_limit_bonus(self.operator, key_prefix='export'), 2)

    def test_create_if_no_active_respects_super_mode_task_slots(self):
        SuperModeService.assign_user(
            self.pro_user,
            self.operator,
            enabled=True,
            ram_mb=250,
        )
        SuperModeService.toggle_runtime(self.operator, enabled=True)

        first, first_err = BackgroundTask.create_if_no_active(
            user=self.operator,
            task_type='export_pdf',
            metadata={'table_id': 1},
        )
        second, second_err = BackgroundTask.create_if_no_active(
            user=self.operator,
            task_type='export_pdf',
            metadata={'table_id': 1},
        )
        third, third_err = BackgroundTask.create_if_no_active(
            user=self.operator,
            task_type='export_pdf',
            metadata={'table_id': 1},
        )

        self.assertIsNotNone(first, first_err)
        self.assertIsNone(first_err)
        self.assertIsNotNone(second, second_err)
        self.assertIsNone(second_err)
        self.assertIsNone(third)
        self.assertIn('current limit is 2', str(third_err))


class SuperModeApiTests(TestCase):
    def setUp(self):
        self.pro_user = User.objects.create_user(
            username='pro_api_user',
            email='pro_api_user@example.com',
            password='pass12345',
            role='pro_user',
        )
        self.operator = User.objects.create_user(
            username='operator_api_user',
            email='operator_api_user@example.com',
            password='pass12345',
            role='admin_staff',
        )

    def test_pro_user_can_list_manageable_users(self):
        self.client.force_login(self.pro_user)

        response = self.client.get('/panel/api/pro-user/super-mode/users/')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertTrue(payload.get('success'))
        ids = {item['id'] for item in payload.get('users', [])}
        self.assertIn(self.operator.id, ids)

    def test_non_pro_user_cannot_access_super_mode_users_api(self):
        self.client.force_login(self.operator)

        response = self.client.get('/panel/api/pro-user/super-mode/users/')
        self.assertEqual(response.status_code, 403)

    def test_assigned_operator_can_toggle_runtime_from_profile_api(self):
        SuperModeService.assign_user(
            self.pro_user,
            self.operator,
            enabled=True,
            ram_mb=250,
        )

        self.client.force_login(self.operator)
        response = self.client.post(
            '/panel/api/profile/super-mode/toggle/',
            data=json.dumps({'enabled': True}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get('success'))
        self.assertTrue(payload.get('super_mode', {}).get('effective_enabled'))

        assignment = SuperModeAssignment.objects.get(user=self.operator)
        self.assertTrue(assignment.is_enabled)

    def test_pro_user_assign_api_can_set_runtime_toggle(self):
        self.client.force_login(self.pro_user)

        enable_response = self.client.post(
            '/panel/api/pro-user/super-mode/assign/',
            data=json.dumps({
                'user_id': self.operator.id,
                'enabled': True,
                'ram_allocation_mb': 250,
                'runtime_enabled': True,
            }),
            content_type='application/json',
        )
        self.assertEqual(enable_response.status_code, 200)
        self.assertTrue(enable_response.json().get('success'))

        assignment = SuperModeAssignment.objects.get(user=self.operator)
        self.assertTrue(assignment.is_assigned)
        self.assertTrue(assignment.is_enabled)
        self.assertEqual(assignment.ram_allocation_mb, 250)

        disable_response = self.client.post(
            '/panel/api/pro-user/super-mode/assign/',
            data=json.dumps({
                'user_id': self.operator.id,
                'enabled': True,
                'ram_allocation_mb': 250,
                'runtime_enabled': False,
            }),
            content_type='application/json',
        )
        self.assertEqual(disable_response.status_code, 200)
        self.assertTrue(disable_response.json().get('success'))

        assignment.refresh_from_db()
        self.assertTrue(assignment.is_assigned)
        self.assertFalse(assignment.is_enabled)
