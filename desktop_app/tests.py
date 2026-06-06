import io
import json
import tempfile
import zipfile

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model

from client.models import Client
from idcards.models import IDCard, IDCardGroup, IDCardTable
from mediafiles.models import CardMedia

User = get_user_model()


@override_settings(
    DESKTOP_APP_ENABLED=True,
    DESKTOP_APP_BOOTSTRAP_TOKEN='bootstrap-secret',
    DESKTOP_APP_MAX_CONNECTIONS=5,
)
class DesktopAppApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.temp_media = tempfile.TemporaryDirectory()
        self.media_override = override_settings(MEDIA_ROOT=self.temp_media.name)
        self.media_override.enable()

        self.user = User.objects.create_user(
            username='admin@example.com',
            email='admin@example.com',
            password='pass12345',
            role='super_admin',
        )
        self.client_obj = Client.objects.create(user=self.user, name='Alpha School', status='active')
        self.group = IDCardGroup.objects.create(client=self.client_obj, name='Grade 1')
        self.table = IDCardTable.objects.create(
            group=self.group,
            name='2026 Cards',
            fields=[
                {'name': 'PHOTO', 'type': 'photo', 'order': 1},
                {'name': 'NAME', 'type': 'text', 'order': 2},
            ],
        )
        self.card = IDCard.objects.create(
            table=self.table,
            field_data={'PHOTO': '', 'NAME': 'Ada'},
        )

    def tearDown(self):
        self.media_override.disable()
        self.temp_media.cleanup()
        cache.clear()

    def _register_device(self, installation_id='desktop-01'):
        response = self.client.post(
            '/api/desktop/register/',
            data=json.dumps({'device_name': 'Office PC', 'installation_id': installation_id}),
            content_type='application/json',
            HTTP_X_DESKTOP_BOOTSTRAP='bootstrap-secret',
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload['success'])
        return payload['access_token']

    def test_register_device_and_pull_manifest(self):
        token = self._register_device()
        response = self.client.get('/api/desktop/clients/', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['summary']['clients'], Client.objects.count())
        self.assertEqual(payload['summary']['tables'], 1)
        self.assertEqual(payload['summary']['cards'], 1)

    def test_device_limit_caps_at_five(self):
        for index in range(5):
            response = self.client.post(
                '/api/desktop/register/',
                data=json.dumps({'device_name': f'Device {index}', 'installation_id': f'desktop-{index}'}),
                content_type='application/json',
                HTTP_X_DESKTOP_BOOTSTRAP='bootstrap-secret',
            )
            self.assertEqual(response.status_code, 201)
        blocked = self.client.post(
            '/api/desktop/register/',
            data=json.dumps({'device_name': 'Device 6', 'installation_id': 'desktop-6'}),
            content_type='application/json',
            HTTP_X_DESKTOP_BOOTSTRAP='bootstrap-secret',
        )
        self.assertEqual(blocked.status_code, 403)

    def test_export_archive_includes_manifest_and_files(self):
        upload = SimpleUploadedFile('student-photo.jpg', b'fake-image-bytes', content_type='image/jpeg')
        CardMedia.objects.create(
            card=self.card,
            group=self.group,
            client=self.client_obj,
            file=upload,
            media_type='photo',
            field_name='PHOTO',
            original_filename='student-photo.jpg',
        )
        token = self._register_device()
        response = self.client.get('/api/desktop/export/', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(response.status_code, 200)
        archive_bytes = b''.join(response.streaming_content)
        with zipfile.ZipFile(io.BytesIO(archive_bytes), 'r') as zf:
            names = set(zf.namelist())
            self.assertIn('manifest.json', names)
            self.assertIn('clients.json', names)
            self.assertTrue(any(name.startswith('original_images/') for name in names))
