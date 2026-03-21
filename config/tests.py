from django.contrib.auth.models import AnonymousUser
from django.http import Http404
from django.test import RequestFactory, TestCase, override_settings
from django.urls import resolve

from core.models import User


class ConfigRootUrlTests(TestCase):
    def test_root_urlconf_exposes_health_check(self):
        match = resolve('/api/health/')
        self.assertEqual(match.url_name, 'health_check')

    def test_root_urlconf_exposes_mobile_app_route(self):
        match = resolve('/app/manifest.json')
        self.assertEqual(match.url_name, 'pwa_manifest')


class ConfigMediaGuardTests(TestCase):
    def setUp(self):
        from config.urls import _protected_media_serve

        self.factory = RequestFactory()
        self._protected_media_serve = _protected_media_serve

    def test_protected_media_redirects_anonymous_user_to_login(self):
        request = self.factory.get('/media/adarshimg/secret.jpg')
        request.user = AnonymousUser()

        response = self._protected_media_serve(request, 'adarshimg/secret.jpg', document_root='.')
        self.assertEqual(response.status_code, 302)
        self.assertIn('login', response.url)

    @override_settings(MEDIA_USE_XACCEL=True)
    def test_protected_media_uses_x_accel_for_authenticated_user(self):
        request = self.factory.get('/media/exports/report.pdf')
        request.user = User.objects.create_user(
            username='config-auth@test.com',
            email='config-auth@test.com',
            password='pass1234',
            role='super_admin',
        )

        response = self._protected_media_serve(request, 'exports/report.pdf', document_root='.')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['X-Accel-Redirect'], '/protected-media/exports/report.pdf')


class PanelAndWebsiteUrlconfTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_panel_robots_disallows_all(self):
        from config.urls_panel import panel_robots_txt

        request = self.factory.get('/robots.txt')
        response = panel_robots_txt(request)

        self.assertEqual(response.status_code, 200)
        self.assertIn('Disallow: /', response.content.decode('utf-8'))

    def test_public_media_serve_blocks_non_public_prefix(self):
        from config.urls_website import _public_media_serve

        request = self.factory.get('/media/exports/private.zip')
        response = _public_media_serve(request, 'exports/private.zip', document_root='.')

        self.assertEqual(response.status_code, 404)

    def test_public_media_serve_allows_public_prefix(self):
        from config.urls_website import _public_media_serve

        request = self.factory.get('/media/adarshimg/photo.jpg')
        with self.assertRaises(Http404):
            _public_media_serve(request, 'adarshimg/photo.jpg', document_root='.')
