import json
from io import BytesIO
from urllib.parse import parse_qs, urlsplit
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from PIL import Image

from website.models import ContactSubmission, PortfolioCategory, PortfolioItem, Testimonial as WebsiteTestimonial
from website.services import PortfolioItemService, TestimonialService
from website.views import pwa_manifest


User = get_user_model()


class PortfolioUploadProcessingTests(TestCase):
	def setUp(self):
		cache.clear()
		self.category = PortfolioCategory.objects.create(name='Test Category')
		self.other_category = PortfolioCategory.objects.create(name='Updated Category')

	def _uploaded_image(self, name='sample.jpg'):
		buffer = BytesIO()
		Image.new('RGB', (1200, 800), color=(210, 80, 90)).save(buffer, format='JPEG', quality=95)
		buffer.seek(0)
		return SimpleUploadedFile(name, buffer.read(), content_type='image/jpeg')

	def _uploaded_video(self, name='sample.mp4'):
		return SimpleUploadedFile(name, b'fake-video-content', content_type='video/mp4')

	def test_direct_model_save_processes_portfolio_image_to_webp(self):
		item = PortfolioItem.objects.create(
			title='Direct Model Upload',
			category=self.category,
			item_type='image',
			image=self._uploaded_image('direct.jpg'),
		)

		self.assertTrue(item.image.name.lower().endswith('.webp'))
		self.assertLessEqual(item.image.size, 200 * 1024)

	def test_service_create_processes_portfolio_image_to_webp(self):
		item = PortfolioItemService.create(
			category_id=self.category.id,
			item_type='image',
			image=self._uploaded_image('service.jpg'),
			is_active=True,
		)

		self.assertTrue(item.image.name.lower().endswith('.webp'))
		self.assertLessEqual(item.image.size, 200 * 1024)

	def test_service_update_renames_title_when_category_changes(self):
		item = PortfolioItemService.create(
			category_id=self.category.id,
			item_type='image',
			image=self._uploaded_image('rename-source.jpg'),
			is_active=True,
		)
		old_title = item.title

		PortfolioItemService.update(item.id, category_id=self.other_category.id)
		item.refresh_from_db()

		self.assertEqual(item.category_id, self.other_category.id)
		self.assertNotEqual(item.title, old_title)
		self.assertTrue(item.title.startswith(self.other_category.name + ' '))
		suffix = item.title.split(' ')[-1]
		self.assertEqual(len(suffix), 6)
		self.assertTrue(all(ch in '0123456789ABCDEF' for ch in suffix))

	def test_service_update_switch_to_image_clears_video_sources(self):
		item = PortfolioItemService.create(
			category_id=self.category.id,
			item_type='reel',
			video_file=self._uploaded_video('intro.mp4'),
			is_active=True,
		)

		PortfolioItemService.update(
			item.id,
			item_type='image',
			image=self._uploaded_image('converted-image.jpg'),
		)
		item.refresh_from_db()

		self.assertEqual(item.item_type, 'image')
		self.assertFalse(bool(item.video_file))
		self.assertEqual(item.video_url, '')

	def test_home_products_rows_exclude_reels_and_videos(self):
		image_item = PortfolioItemService.create(
			category_id=self.category.id,
			item_type='image',
			image=self._uploaded_image('home-image.jpg'),
			is_active=True,
			is_featured=True,
		)
		reel_item = PortfolioItemService.create(
			category_id=self.category.id,
			item_type='reel',
			video_file=self._uploaded_video('home-reel.mp4'),
			is_active=True,
			is_featured=True,
		)
		cache.delete('home_sections')

		response = self.client.get('/')
		self.assertEqual(response.status_code, 200)

		row_items = list(response.context['row1_portfolio']) + list(response.context['row2_portfolio'])
		self.assertTrue(row_items)
		self.assertIn(image_item, row_items)
		self.assertNotIn(reel_item, row_items)
		self.assertTrue(all(p.item_type == 'image' for p in row_items))

	def test_home_products_rows_mix_categories_without_adjacent_repeats(self):
		cat_a = PortfolioCategory.objects.create(name='Category A')
		cat_b = PortfolioCategory.objects.create(name='Category B')
		cat_c = PortfolioCategory.objects.create(name='Category C')

		for idx in range(2):
			PortfolioItemService.create(
				category_id=cat_a.id,
				item_type='image',
				image=self._uploaded_image(f'cat-a-{idx}.jpg'),
				is_active=True,
				is_featured=True,
			)
			PortfolioItemService.create(
				category_id=cat_b.id,
				item_type='image',
				image=self._uploaded_image(f'cat-b-{idx}.jpg'),
				is_active=True,
				is_featured=True,
			)
			PortfolioItemService.create(
				category_id=cat_c.id,
				item_type='image',
				image=self._uploaded_image(f'cat-c-{idx}.jpg'),
				is_active=True,
				is_featured=True,
			)

		cache.delete('home_sections')
		response = self.client.get('/')
		self.assertEqual(response.status_code, 200)

		row1 = list(response.context['row1_portfolio'])
		row2 = list(response.context['row2_portfolio'])
		self.assertTrue(row1)
		self.assertTrue(row2)

		for row in (row1, row2):
			for i in range(1, len(row)):
				self.assertNotEqual(row[i - 1].category_id, row[i].category_id)

		for i in range(min(len(row1), len(row2))):
			self.assertNotEqual(row1[i].category_id, row2[i].category_id)


class TestimonialSubmissionTests(TestCase):
	def setUp(self):
		cache.clear()

	def _uploaded_image(self, name='feedback.png'):
		buffer = BytesIO()
		Image.new('RGB', (800, 500), color=(55, 120, 220)).save(buffer, format='PNG')
		buffer.seek(0)
		return SimpleUploadedFile(name, buffer.read(), content_type='image/png')

	def test_public_submission_blocks_duplicate_email_or_ip(self):
		TestimonialService.create_public(
			reviewer_name='Parent One',
			reviewer_email='parent@example.com',
			reviewer_school='Example School',
			text='Great service.',
			rating=5,
			reviewer_ip='8.8.8.8',
		)

		with self.assertRaises(ValidationError) as email_error:
			TestimonialService.create_public(
				reviewer_name='Parent Two',
				reviewer_email='parent@example.com',
				reviewer_school='Example School',
				text='Second review.',
				rating=4,
				reviewer_ip='1.1.1.1',
			)
		self.assertIn('A review has already been submitted from this email address or device.', str(email_error.exception))

		with self.assertRaises(ValidationError) as ip_error:
			TestimonialService.create_public(
				reviewer_name='Parent Three',
				reviewer_email='other@example.com',
				reviewer_school='Example School',
				text='Third review.',
				rating=4,
				reviewer_ip='8.8.8.8',
			)
		self.assertIn('A review has already been submitted from this email address or device.', str(ip_error.exception))

	def test_public_testimonials_page_hides_review_cta_for_existing_email(self):
		user = User.objects.create_user(
			username='viewer@example.com',
			email='viewer@example.com',
			password='testpass123',
			role='client',
		)
		WebsiteTestimonial.objects.create(
			reviewer_name='Viewer',
			reviewer_email='viewer@example.com',
			reviewer_school='Demo School',
			text='Nice work.',
			rating=5,
			is_active=False,
		)

		self.client.force_login(user)
		response = self.client.get(reverse('website:testimonials'))

		self.assertEqual(response.status_code, 200)
		self.assertFalse(response.context['can_submit_public_review'])

	def test_public_testimonial_submit_rejects_duplicate_ip(self):
		TestimonialService.create_public(
			reviewer_name='Parent One',
			reviewer_email='parent2@example.com',
			reviewer_school='Example School',
			text='Great service.',
			rating=5,
			reviewer_ip='9.9.9.9',
		)

		response = self.client.post(
			reverse('website:submit_testimonial'),
			{
				'name': 'Another Parent',
				'email': 'new@example.com',
				'school': 'Example School',
				'text': 'Another review.',
				'rating': '5',
			},
			HTTP_X_FORWARDED_FOR='9.9.9.9',
		)

		self.assertEqual(response.status_code, 400)
		self.assertJSONEqual(response.content, {
			'success': False,
			'message': 'A review has already been submitted from this email address or device.',
		})

	def test_public_testimonials_page_authenticated_user_not_blocked_by_shared_ip(self):
		user = User.objects.create_user(
			username='client-unique@example.com',
			email='client-unique@example.com',
			password='testpass123',
			role='client',
		)

		WebsiteTestimonial.objects.create(
			reviewer_name='Other User',
			reviewer_email='other-user@example.com',
			reviewer_ip='5.5.5.5',
			reviewer_school='Example School',
			text='Existing review from shared device/network.',
			rating=5,
			is_active=False,
		)

		self.client.force_login(user)
		response = self.client.get(reverse('website:testimonials'), REMOTE_ADDR='5.5.5.5')

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.context['can_submit_public_review'])

	def test_public_testimonial_submit_accepts_attachment_image(self):
		response = self.client.post(
			reverse('website:submit_testimonial'),
			{
				'name': 'Attachment User',
				'email': 'attachment-user@example.com',
				'school': 'Attachment School',
				'text': 'Sharing screenshot proof.',
				'rating': '4',
				'attachment_image': self._uploaded_image(),
			},
			HTTP_X_FORWARDED_FOR='4.4.4.4',
		)

		self.assertEqual(response.status_code, 200)
		created = WebsiteTestimonial.objects.get(reviewer_email='attachment-user@example.com')
		self.assertTrue(bool(created.attachment_image))


class WebsitePublicHardeningTests(TestCase):
	def setUp(self):
		cache.clear()

	def test_panel_entry_falls_back_to_safe_login_path_for_invalid_next(self):
		response = self.client.get(reverse('website:panel_entry'), {'next': '/panel/../../etc/passwd'})

		self.assertEqual(response.status_code, 302)
		location = response['Location']
		parsed = urlsplit(location)
		query = parse_qs(parsed.query)

		self.assertIn(parsed.path, ['/panel/auth/login/', '/auth/login/'])
		self.assertIn('panel_entry_token', query)

	def test_panel_entry_preserves_valid_panel_path_and_query(self):
		response = self.client.get(reverse('website:panel_entry'), {'next': '/panel/app/login/?install=1&src=website'})

		self.assertEqual(response.status_code, 302)
		location = response['Location']
		parsed = urlsplit(location)
		query = parse_qs(parsed.query)

		self.assertIn(parsed.path, ['/panel/app/login/', '/app/login/'])
		self.assertEqual(query.get('install'), ['1'])
		self.assertEqual(query.get('src'), ['website'])
		self.assertIn('panel_entry_token', query)

	def test_submit_contact_sanitizes_subject_before_save(self):
		response = self.client.post(
			reverse('website:submit_contact'),
			{
				'name': 'Contact User',
				'email': 'contact-user@example.com',
				'phone': '9999999999',
				'subject': 'Need help\r\nBcc: hidden@example.com',
				'message': 'Please call me back.',
			},
		)

		self.assertEqual(response.status_code, 200)
		submission = ContactSubmission.objects.get(email='contact-user@example.com')
		self.assertEqual(submission.subject, 'Need help Bcc: hidden@example.com')
		self.assertNotIn('\r', submission.subject)
		self.assertNotIn('\n', submission.subject)


class WebsitePwaInstallabilityTests(TestCase):
	def test_manifest_endpoint_returns_installable_payload(self):
		response = self.client.get(reverse('website:pwa_manifest'))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response['Content-Type'], 'application/manifest+json')
		payload = response.json()
		self.assertEqual(payload.get('start_url'), '/panel-entry/?next=/auth/login/&src=pwa-launch')
		self.assertEqual(payload.get('scope'), '/')
		self.assertEqual(payload.get('display'), 'standalone')
		self.assertGreaterEqual(len(payload.get('icons', [])), 1)

	@override_settings(PANEL_DOMAIN='panel.example.test', ALLOWED_HOSTS=['testserver', 'panel.example.test'])
	def test_manifest_returns_panel_payload_for_panel_host(self):
		factory = RequestFactory()
		request = factory.get('/manifest.json', HTTP_HOST='panel.example.test')

		response = pwa_manifest(request)

		self.assertEqual(response.status_code, 200)
		payload = json.loads(response.content.decode('utf-8'))
		self.assertEqual(payload.get('name'), 'Adarsh ID Cards Panel')
		self.assertEqual(payload.get('start_url'), '/')
		self.assertEqual(payload.get('scope'), '/')

	@override_settings(PANEL_DOMAIN='panel.example.test', ALLOWED_HOSTS=['testserver', 'panel.example.test'])
	def test_manifest_endpoint_is_exempt_on_panel_host(self):
		response = self.client.get('/manifest.json', HTTP_HOST='panel.example.test')

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response['Content-Type'], 'application/manifest+json')
		payload = response.json()
		self.assertEqual(payload.get('name'), 'Adarsh ID Cards Panel')

	def test_service_worker_endpoint_returns_required_headers(self):
		response = self.client.get(reverse('website:pwa_service_worker'))

		self.assertEqual(response.status_code, 200)
		self.assertIn('javascript', response['Content-Type'])
		self.assertEqual(response['Service-Worker-Allowed'], '/')
		self.assertIn("self.addEventListener('fetch'", response.content.decode('utf-8'))
