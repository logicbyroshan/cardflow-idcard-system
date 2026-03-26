import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from client.models import Client
from core.models import BackupTask, EmailLog, Notification, NotificationRead
from core.services.notification_service import NotificationService


User = get_user_model()


class PanelBaseTestCase(TestCase):
    def setUp(self):
        self.super_admin = User.objects.create_user(
            username='panel-super@test.com',
            email='panel-super@test.com',
            password='pass1234',
            role='super_admin',
        )
        self.client_user = User.objects.create_user(
            username='panel-client@test.com',
            email='panel-client@test.com',
            password='pass1234',
            role='client',
        )
        self.client_profile = Client.objects.create(
            user=self.client_user,
            name='Panel Client',
            status='active',
        )
        cache.clear()

    def tearDown(self):
        cache.clear()


class PanelAccessTests(PanelBaseTestCase):
    def test_manage_panel_requires_super_admin(self):
        self.client.login(username='panel-client@test.com', password='pass1234')
        response = self.client.get('/panel/manage-panel/')
        self.assertIn(response.status_code, [302, 403])

    def test_manage_panel_super_admin_can_access(self):
        self.client.login(username='panel-super@test.com', password='pass1234')
        response = self.client.get('/panel/manage-panel/')
        self.assertEqual(response.status_code, 200)


class PanelNotificationApiTests(PanelBaseTestCase):
    def setUp(self):
        super().setUp()
        self.notif_all = Notification.objects.create(
            title='All users',
            message='Visible to everyone',
            target='all',
            created_by=self.super_admin,
        )
        self.notif_client = Notification.objects.create(
            title='Client only',
            message='Visible to client role',
            target='client',
            created_by=self.super_admin,
        )
        self.notif_selected = Notification.objects.create(
            title='Selected user',
            message='Visible to one user',
            target='selected',
            created_by=self.super_admin,
        )
        self.notif_selected.target_users.add(self.client_user)

    def test_user_notifications_list_returns_visible_entries(self):
        self.client.login(username='panel-client@test.com', password='pass1234')
        response = self.client.get('/panel/api/notifications/list/?limit=10&offset=0')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertTrue(payload['success'])
        returned_ids = {item['id'] for item in payload['notifications']}
        self.assertIn(self.notif_all.id, returned_ids)
        self.assertIn(self.notif_client.id, returned_ids)
        self.assertIn(self.notif_selected.id, returned_ids)

    def test_mark_read_updates_unread_count(self):
        self.client.login(username='panel-client@test.com', password='pass1234')

        before = self.client.get('/panel/api/notifications/unread-count/').json()
        self.assertTrue(before['unread_count'] >= 1)

        response = self.client.post(f'/panel/api/notifications/{self.notif_all.id}/read/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(NotificationRead.objects.filter(user=self.client_user, notification=self.notif_all).exists())

        after = self.client.get('/panel/api/notifications/unread-count/').json()
        self.assertLess(after['unread_count'], before['unread_count'])

    def test_admin_create_and_delete_notification(self):
        self.client.login(username='panel-super@test.com', password='pass1234')

        create_response = self.client.post(
            '/panel/api/notifications/admin/create/',
            data=json.dumps({
                'title': 'Panel create',
                'message': 'Created from API',
                'priority': 'high',
                'category': 'announcement',
                'target': 'selected',
                'target_user_ids': [self.client_user.id],
                'send_email': False,
            }),
            content_type='application/json',
        )
        self.assertEqual(create_response.status_code, 200)
        created_id = create_response.json()['notification']['id']

        notif = Notification.objects.get(id=created_id)
        self.assertEqual(notif.target, 'selected')
        self.assertTrue(notif.target_users.filter(id=self.client_user.id).exists())

        delete_response = self.client.delete(f'/panel/api/notifications/admin/{created_id}/delete/')
        self.assertEqual(delete_response.status_code, 200)
        notif.refresh_from_db()
        self.assertFalse(notif.is_active)

    def test_admin_create_rejects_empty_title(self):
        self.client.login(username='panel-super@test.com', password='pass1234')
        response = self.client.post(
            '/panel/api/notifications/admin/create/',
            data=json.dumps({'title': '', 'message': 'x'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()['success'])


class PanelNotificationEmailTemplateTests(PanelBaseTestCase):
    @mock.patch('core.utils.threaded_email.send_html_email_async')
    @mock.patch('core.services.notification_service.render_to_string')
    @mock.patch('django.conf.settings.EMAIL_HOST_USER', 'smtp-user')
    @mock.patch('django.conf.settings.DEFAULT_FROM_EMAIL', 'Adarsh Admin <noreply@test.com>')
    def test_send_email_alerts_uses_html_template_with_category_theme(self, mock_render, mock_send_html):
        self.client_user.email = 'panel-client@test.com'
        self.client_user.save(update_fields=['email'])

        notif = Notification.objects.create(
            title='Server notice',
            message='Database maintenance starts at 11 PM.',
            priority='urgent',
            category='alert',
            target='selected',
            created_by=self.super_admin,
        )
        notif.target_users.add(self.client_user)

        mock_render.return_value = '<html><body><span style="color:#991b1b">Alert</span></body></html>'

        NotificationService._send_email_alerts(notif)

        self.assertEqual(mock_render.call_count, 1)
        args, _kwargs = mock_render.call_args
        self.assertEqual(args[0], 'emails/notification_alert.html')
        self.assertEqual(args[1]['category_display'], 'Alert')
        self.assertEqual(args[1]['theme']['accent'], '#dc2626')

        mock_send_html.assert_called_once()
        send_kwargs = mock_send_html.call_args.kwargs
        self.assertEqual(send_kwargs['subject'], '[Urgent] Server notice')
        self.assertEqual(send_kwargs['recipient_list'], ['panel-client@test.com'])
        self.assertIn('Category: Alert', send_kwargs['plain_content'])
        self.assertIn('Database maintenance starts at 11 PM.', send_kwargs['plain_content'])
        self.assertIn('#991b1b', send_kwargs['html_content'])

    @mock.patch('core.utils.threaded_email.send_html_email_async')
    @mock.patch('django.conf.settings.EMAIL_HOST_USER', 'smtp-user')
    @mock.patch('django.conf.settings.DEFAULT_FROM_EMAIL', 'Adarsh Admin <noreply@test.com>')
    def test_send_email_alerts_renders_alert_theme_template(self, mock_send_html):
        notif = Notification.objects.create(
            title='Immediate action needed',
            message='Please review suspicious activity logs now.',
            priority='urgent',
            category='alert',
            target='selected',
            created_by=self.super_admin,
        )
        notif.target_users.add(self.client_user)

        NotificationService._send_email_alerts(notif)

        mock_send_html.assert_called_once()
        html_content = mock_send_html.call_args.kwargs['html_content']
        self.assertIn('theme-alert', html_content)
        self.assertIn('Immediate action needed', html_content)
        self.assertIn('Urgent:', html_content)


class PanelEmailApiTests(PanelBaseTestCase):
    def setUp(self):
        super().setUp()
        self.sent_log = EmailLog.objects.create(
            recipient_name='Client User',
            recipient_email='panel-client@test.com',
            subject='Welcome',
            body_text='Hello',
            email_type=EmailLog.EMAIL_TYPE_WELCOME,
            status=EmailLog.STATUS_ON_HOLD,
        )
        EmailLog.objects.create(
            recipient_name='Other User',
            recipient_email='other@test.com',
            subject='OTP',
            body_text='Code',
            email_type=EmailLog.EMAIL_TYPE_OTP_RESET,
            status=EmailLog.STATUS_FAILED,
        )

    def test_email_logs_endpoint_supports_query_params(self):
        self.client.login(username='panel-super@test.com', password='pass1234')
        response = self.client.get('/panel/api/email-logs/?page=abc&per_page=999&status=on_hold')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['page'], 1)
        self.assertEqual(payload['total'], 1)
        self.assertEqual(len(payload['logs']), 1)

    def test_compose_defaults_uses_name(self):
        self.client.login(username='panel-super@test.com', password='pass1234')
        response = self.client.get('/panel/api/email-compose-defaults/?name=Ravi')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertIn('Ravi', payload['default_body_text'])

    def test_send_new_requires_required_fields(self):
        self.client.login(username='panel-super@test.com', password='pass1234')
        response = self.client.post(
            '/panel/api/email-send/',
            data=json.dumps({'recipient_email': '', 'subject': '', 'body_text': ''}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    @mock.patch('panel.views.manage_panel_views._send_email_now')
    def test_send_new_marks_log_as_sent_on_success(self, mock_send):
        self.client.login(username='panel-super@test.com', password='pass1234')
        response = self.client.post(
            '/panel/api/email-send/',
            data=json.dumps({
                'recipient_email': 'new-user@test.com',
                'recipient_name': 'New User',
                'subject': 'Hello',
                'body_text': 'Welcome',
                'email_type': EmailLog.EMAIL_TYPE_SYSTEM,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])

        log = EmailLog.objects.get(id=payload['log_id'])
        self.assertEqual(log.status, EmailLog.STATUS_SENT)
        self.assertIsNotNone(log.sent_at)
        mock_send.assert_called_once()

    @mock.patch('panel.views.manage_panel_views._send_email_now')
    def test_email_resend_custom_payload_updates_log(self, mock_send):
        self.client.login(username='panel-super@test.com', password='pass1234')

        response = self.client.post(
            f'/panel/api/email-resend/{self.sent_log.id}/',
            data=json.dumps({
                'recipient_email': 'panel-client@test.com',
                'recipient_name': 'Client Updated',
                'subject': 'Updated Subject',
                'body_text': 'Updated body',
                'body_html': '<b>Updated</b>',
                'email_type': EmailLog.EMAIL_TYPE_SYSTEM,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)

        self.sent_log.refresh_from_db()
        self.assertEqual(self.sent_log.status, EmailLog.STATUS_SENT)
        self.assertEqual(self.sent_log.subject, 'Updated Subject')
        mock_send.assert_called_once()


class PanelBackupApiTests(PanelBaseTestCase):
    def test_backup_generate_code_returns_10_digits(self):
        self.client.login(username='panel-super@test.com', password='pass1234')
        response = self.client.get('/panel/api/backup/generate-code/')
        self.assertEqual(response.status_code, 200)
        code = response.json()['code']
        self.assertEqual(len(code), 10)
        self.assertTrue(code.isdigit())

    def test_backup_initiate_validates_confirmation_code(self):
        self.client.login(username='panel-super@test.com', password='pass1234')
        response = self.client.post(
            '/panel/api/backup/initiate/',
            data=json.dumps({'code': '123'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()['success'])

    def test_backup_initiate_creates_pending_task(self):
        self.client.login(username='panel-super@test.com', password='pass1234')
        response = self.client.post(
            '/panel/api/backup/initiate/',
            data=json.dumps({'code': '1234567890'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)

        task_id = response.json()['task_id']
        task = BackupTask.objects.get(id=task_id)
        self.assertEqual(task.status, 'pending')
        self.assertEqual(task.confirmation_code, '1234567890')

    @mock.patch('panel.services.backup_service.start_backup')
    def test_backup_start_sets_clients_and_calls_service(self, mock_start_backup):
        self.client.login(username='panel-super@test.com', password='pass1234')
        task = BackupTask.objects.create(
            created_by=self.super_admin,
            confirmation_code='1234567890',
            status='pending',
        )

        response = self.client.post(
            '/panel/api/backup/start/',
            data=json.dumps({'task_id': task.id, 'client_ids': [self.client_profile.id]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)

        task.refresh_from_db()
        self.assertEqual(task.total, 1)
        self.assertIn(self.client_profile.id, task.client_ids)
        mock_start_backup.assert_called_once_with(task.id)

    @mock.patch('panel.services.backup_service.delete_backup_files')
    def test_backup_delete_now_calls_service_for_completed_task(self, mock_delete):
        self.client.login(username='panel-super@test.com', password='pass1234')
        task = BackupTask.objects.create(
            created_by=self.super_admin,
            confirmation_code='1234567890',
            status='completed',
            zip_files={'combined': {'path': 'temp/backups/x.zip', 'filename': 'x.zip', 'size': 1}},
        )

        response = self.client.post(f'/panel/api/backup/{task.id}/delete-now/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['success'])
        mock_delete.assert_called_once_with(task.id)

    def test_backup_list_and_status_return_payload(self):
        self.client.login(username='panel-super@test.com', password='pass1234')
        task = BackupTask.objects.create(
            created_by=self.super_admin,
            confirmation_code='1234567890',
            status='pending',
            progress=0,
            total=1,
            client_names={str(self.client_profile.id): self.client_profile.name},
        )

        list_response = self.client.get('/panel/api/backup/list/')
        self.assertEqual(list_response.status_code, 200)
        self.assertTrue(list_response.json()['success'])

        status_response = self.client.get(f'/panel/api/backup/status/{task.id}/')
        self.assertEqual(status_response.status_code, 200)
        status_payload = status_response.json()
        self.assertTrue(status_payload['success'])
        self.assertEqual(status_payload['id'], task.id)


class PanelMonitoringApiTests(PanelBaseTestCase):
    def test_client_errors_ignores_unauthenticated_reports(self):
        response = self.client.post(
            '/panel/api/client-errors/',
            data=json.dumps({'errors': [{'type': 'error', 'message': 'x'}]}),
            content_type='application/json',
        )
        self.assertIn(response.status_code, [200, 302])
        if response.status_code == 200:
            self.assertEqual(response.json()['status'], 'ignored')

    def test_client_errors_rejects_invalid_json(self):
        self.client.login(username='panel-client@test.com', password='pass1234')
        response = self.client.post(
            '/panel/api/client-errors/',
            data='not-json',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['status'], 'bad_request')

    def test_monitoring_data_requires_super_admin(self):
        self.client.login(username='panel-client@test.com', password='pass1234')
        denied = self.client.get('/panel/api/monitoring/')
        self.assertEqual(denied.status_code, 403)

        self.client.login(username='panel-super@test.com', password='pass1234')
        allowed = self.client.get('/panel/api/monitoring/')
        self.assertEqual(allowed.status_code, 200)
        self.assertTrue(allowed.json()['success'])

    def test_server_info_snapshot_uses_cache_when_available(self):
        from panel.views.monitoring_views import _SERVER_INFO_CACHE_KEY

        self.client.login(username='panel-super@test.com', password='pass1234')
        cache.set(_SERVER_INFO_CACHE_KEY, {'host': 'cached-host'}, 300)

        response = self.client.get('/panel/api/server-info/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertTrue(payload['cached'])
        self.assertEqual(payload['snapshot']['host'], 'cached-host')
