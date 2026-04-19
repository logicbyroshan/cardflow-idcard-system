import json
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from core.realtime.consumers import RealtimeHubConsumer
from core.models import User
from officework.models import OfficeWorkChatGroup, OfficeWorkChatGroupMember, OfficeWorkChatMessage, OfficeWorkTask, OfficeWorkTaskComment


class OfficeWorkChatGroupAndAttachmentTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='office_admin',
            email='office_admin@example.com',
            password='pass12345',
            role='admin_staff',
            is_staff=True,
            is_active=True,
        )
        self.member = User.objects.create_user(
            username='office_member',
            email='office_member@example.com',
            password='pass12345',
            role='admin_staff',
            is_staff=True,
            is_active=True,
        )
        self.non_admin = User.objects.create_user(
            username='plain_client',
            email='plain_client@example.com',
            password='pass12345',
            role='client',
            is_active=True,
        )

    def test_admin_can_create_group_and_member_can_see_it(self):
        self.client.force_login(self.admin)

        response = self.client.post(
            reverse('api_office_work_chat_group_create'),
            data=json.dumps({
                'name': 'Urgent Team',
                'member_ids': [self.member.id],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get('success'))

        group = OfficeWorkChatGroup.objects.get(name='Urgent Team')
        member_ids = set(
            OfficeWorkChatGroupMember.objects.filter(group=group).values_list('user_id', flat=True)
        )
        self.assertIn(self.admin.id, member_ids)
        self.assertIn(self.member.id, member_ids)

        self.client.force_login(self.member)
        groups_response = self.client.get(reverse('api_office_work_chat_groups_list'))
        self.assertEqual(groups_response.status_code, 200)
        groups_payload = groups_response.json()
        self.assertTrue(groups_payload.get('success'))
        group_names = {item['name'] for item in groups_payload.get('groups', [])}
        self.assertIn('Urgent Team', group_names)

    def test_non_admin_cannot_create_group(self):
        self.client.force_login(self.non_admin)
        response = self.client.post(
            reverse('api_office_work_chat_group_create'),
            data=json.dumps({
                'name': 'Not Allowed',
                'member_ids': [self.admin.id],
            }),
            content_type='application/json',
        )
        self.assertIn(response.status_code, [401, 403])

    def test_admin_can_send_chat_message_with_attachment(self):
        self.client.force_login(self.admin)

        create_response = self.client.post(
            reverse('api_office_work_chat_group_create'),
            data=json.dumps({
                'name': 'Files Group',
                'member_ids': [self.member.id],
            }),
            content_type='application/json',
        )
        self.assertEqual(create_response.status_code, 200)
        group = OfficeWorkChatGroup.objects.get(name='Files Group')

        upload = SimpleUploadedFile(
            'sample-doc.txt',
            b'hello office work',
            content_type='text/plain',
        )

        send_response = self.client.post(
            reverse('api_office_work_chat_send'),
            data={
                'group_id': str(group.id),
                'message': 'Please review',
                'file': upload,
            },
        )
        self.assertEqual(send_response.status_code, 200)
        send_payload = send_response.json()
        self.assertTrue(send_payload.get('success'))
        self.assertIsNotNone(send_payload.get('item', {}).get('attachment'))

        message_id = int(send_payload['item']['id'])
        message = OfficeWorkChatMessage.objects.get(id=message_id)
        self.assertEqual(message.group_id, group.id)
        self.assertTrue(bool(message.attachment))

        download_response = self.client.get(
            reverse('api_office_work_chat_attachment_download', args=[message_id])
        )
        self.assertEqual(download_response.status_code, 200)

    def test_chat_attachment_blocks_dangerous_extension(self):
        self.client.force_login(self.admin)

        create_response = self.client.post(
            reverse('api_office_work_chat_group_create'),
            data=json.dumps({
                'name': 'Security Group',
                'member_ids': [self.member.id],
            }),
            content_type='application/json',
        )
        self.assertEqual(create_response.status_code, 200)
        group = OfficeWorkChatGroup.objects.get(name='Security Group')

        upload = SimpleUploadedFile(
            'payload.exe',
            b'MZ',
            content_type='application/octet-stream',
        )

        send_response = self.client.post(
            reverse('api_office_work_chat_send'),
            data={
                'group_id': str(group.id),
                'message': 'blocked',
                'file': upload,
            },
        )
        self.assertEqual(send_response.status_code, 400)
        self.assertFalse(send_response.json().get('success'))

    def test_share_upload_blocks_dangerous_extension(self):
        self.client.force_login(self.admin)

        upload = SimpleUploadedFile(
            'dangerous.ps1',
            b'Write-Host test',
            content_type='text/plain',
        )

        response = self.client.post(
            reverse('api_office_work_share_upload'),
            data={
                'title': 'Blocked file',
                'note': 'Should not upload',
                'file': upload,
            },
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload.get('success'))


class OfficeWorkRoleRestrictionTests(TestCase):
    def setUp(self):
        self.client_user = User.objects.create_user(
            username='office_client',
            email='office_client@example.com',
            password='pass12345',
            role='client',
            is_active=True,
        )
        self.assistant_user = User.objects.create_user(
            username='office_assistant',
            email='office_assistant@example.com',
            password='pass12345',
            role='client_staff',
            is_active=True,
        )

    def test_client_role_cannot_open_office_work_page_or_chat_apis(self):
        self.client.force_login(self.client_user)

        page_response = self.client.get(reverse('office_work_page'))
        self.assertNotEqual(page_response.status_code, 200)

        groups_response = self.client.get(reverse('api_office_work_chat_groups_list'))
        self.assertIn(groups_response.status_code, [302, 401, 403])

        send_response = self.client.post(
            reverse('api_office_work_chat_send'),
            data=json.dumps({'message': 'blocked'}),
            content_type='application/json',
        )
        self.assertIn(send_response.status_code, [302, 401, 403])

    def test_assistant_role_cannot_open_office_work_page_or_chat_apis(self):
        self.client.force_login(self.assistant_user)

        page_response = self.client.get(reverse('office_work_page'))
        self.assertNotEqual(page_response.status_code, 200)

        groups_response = self.client.get(reverse('api_office_work_chat_groups_list'))
        self.assertIn(groups_response.status_code, [302, 401, 403])

        send_response = self.client.post(
            reverse('api_office_work_chat_send'),
            data=json.dumps({'message': 'blocked'}),
            content_type='application/json',
        )
        self.assertIn(send_response.status_code, [302, 401, 403])


class OfficeWorkTaskRealtimeEventTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='office_task_admin',
            email='office_task_admin@example.com',
            password='pass12345',
            role='admin_staff',
            is_staff=True,
            is_active=True,
        )
        self.admin_peer = User.objects.create_user(
            username='office_task_admin_peer',
            email='office_task_admin_peer@example.com',
            password='pass12345',
            role='admin_staff',
            is_staff=True,
            is_active=True,
        )
        self.client.force_login(self.admin)

    @patch('officework.views_tasks.publish_topic_event')
    def test_task_create_emits_realtime_event(self, publish_mock):
        response = self.client.post(
            reverse('api_office_work_task_create'),
            data=json.dumps({
                'title': 'Realtime Task',
                'description': 'Created from test',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get('success'))

        publish_mock.assert_called_once()
        self.assertEqual(publish_mock.call_args.kwargs.get('topic'), 'officework.tasks')
        self.assertEqual(publish_mock.call_args.kwargs.get('event_type'), 'officework.task.created')

    def test_task_create_always_starts_in_todo(self):
        response = self.client.post(
            reverse('api_office_work_task_create'),
            data=json.dumps({
                'title': 'Force Todo',
                'status': OfficeWorkTask.STATUS_DONE,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get('success'))
        self.assertEqual(payload['task']['status'], OfficeWorkTask.STATUS_TODO)

    def test_non_creator_done_move_requests_creator_approval(self):
        task = OfficeWorkTask.objects.create(
            title='Need Approval',
            status=OfficeWorkTask.STATUS_IN_PROGRESS,
            priority=OfficeWorkTask.PRIORITY_NORMAL,
            created_by=self.admin,
            assigned_to=self.admin_peer,
        )

        self.client.force_login(self.admin_peer)
        update_response = self.client.post(
            reverse('api_office_work_task_update', args=[task.id]),
            data=json.dumps({'status': OfficeWorkTask.STATUS_DONE}),
            content_type='application/json',
        )
        self.assertEqual(update_response.status_code, 200)
        update_payload = update_response.json()
        self.assertTrue(update_payload.get('success'))
        self.assertEqual(update_payload['task']['status'], OfficeWorkTask.STATUS_PENDING)

        self.client.force_login(self.admin)
        approve_response = self.client.post(
            reverse('api_office_work_task_update', args=[task.id]),
            data=json.dumps({'approval_decision': 'approve'}),
            content_type='application/json',
        )
        self.assertEqual(approve_response.status_code, 200)
        approve_payload = approve_response.json()
        self.assertTrue(approve_payload.get('success'))
        self.assertEqual(approve_payload['task']['status'], OfficeWorkTask.STATUS_DONE)

    @patch('officework.views_tasks.publish_topic_event')
    def test_task_comment_create_emits_realtime_event(self, publish_mock):
        task = OfficeWorkTask.objects.create(
            title='Task Commented',
            status=OfficeWorkTask.STATUS_TODO,
            priority=OfficeWorkTask.PRIORITY_NORMAL,
            created_by=self.admin,
        )

        response = self.client.post(
            reverse('api_office_work_task_comment_create', args=[task.id]),
            data=json.dumps({'message': 'Please share final lanyard fields.'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get('success'))
        self.assertTrue(OfficeWorkTaskComment.objects.filter(task=task).exists())

        publish_mock.assert_called_once()
        self.assertEqual(publish_mock.call_args.kwargs.get('topic'), 'officework.tasks')
        self.assertEqual(publish_mock.call_args.kwargs.get('event_type'), 'officework.task.comment.created')

    @patch('officework.views_tasks.publish_topic_event')
    def test_task_update_emits_realtime_event(self, publish_mock):
        task = OfficeWorkTask.objects.create(
            title='Task To Update',
            status=OfficeWorkTask.STATUS_TODO,
            priority=OfficeWorkTask.PRIORITY_NORMAL,
            created_by=self.admin,
        )

        response = self.client.post(
            reverse('api_office_work_task_update', args=[task.id]),
            data=json.dumps({
                'status': OfficeWorkTask.STATUS_DONE,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get('success'))

        publish_mock.assert_called_once()
        self.assertEqual(publish_mock.call_args.kwargs.get('topic'), 'officework.tasks')
        self.assertEqual(publish_mock.call_args.kwargs.get('event_type'), 'officework.task.updated')

    @patch('officework.views_tasks.publish_topic_event')
    def test_task_delete_emits_realtime_event(self, publish_mock):
        task = OfficeWorkTask.objects.create(
            title='Task To Delete',
            status=OfficeWorkTask.STATUS_TODO,
            priority=OfficeWorkTask.PRIORITY_NORMAL,
            created_by=self.admin,
        )

        response = self.client.post(
            reverse('api_office_work_task_delete', args=[task.id]),
            data=json.dumps({}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get('success'))

        publish_mock.assert_called_once()
        self.assertEqual(publish_mock.call_args.kwargs.get('topic'), 'officework.tasks')
        self.assertEqual(publish_mock.call_args.kwargs.get('event_type'), 'officework.task.deleted')


class OfficeWorkRealtimeTopicSecurityTests(TestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(
            username='office_topic_admin',
            email='office_topic_admin@example.com',
            password='pass12345',
            role='admin_staff',
            is_staff=True,
            is_active=True,
        )
        self.client_user = User.objects.create_user(
            username='office_topic_client',
            email='office_topic_client@example.com',
            password='pass12345',
            role='client',
            is_active=True,
        )
        self.admin_peer = User.objects.create_user(
            username='office_topic_admin_peer',
            email='office_topic_admin_peer@example.com',
            password='pass12345',
            role='admin_staff',
            is_staff=True,
            is_active=True,
        )

    def test_officework_task_and_share_topics_require_admin(self):
        self.assertTrue(RealtimeHubConsumer._can_access_topic_sync(self.admin_user, 'officework.tasks'))
        self.assertTrue(RealtimeHubConsumer._can_access_topic_sync(self.admin_user, 'officework.share'))

        self.assertFalse(RealtimeHubConsumer._can_access_topic_sync(self.client_user, 'officework.tasks'))
        self.assertFalse(RealtimeHubConsumer._can_access_topic_sync(self.client_user, 'officework.share'))

    def test_officework_group_topic_requires_membership(self):
        group = OfficeWorkChatGroup.objects.create(name='Realtime Security Group', created_by=self.admin_user)
        OfficeWorkChatGroupMember.objects.create(group=group, user=self.admin_user, added_by=self.admin_user)

        topic = f'officework.chat.group.{group.id}'
        self.assertTrue(RealtimeHubConsumer._can_access_topic_sync(self.admin_user, topic))
        self.assertFalse(RealtimeHubConsumer._can_access_topic_sync(self.admin_peer, topic))

