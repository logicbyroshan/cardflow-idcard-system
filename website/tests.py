from io import BytesIO
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from django.db import DatabaseError
from django.test import TestCase
from django.urls import reverse
from PIL import Image

from website.models import PortfolioCategory, PortfolioItem, Testimonial
from website.services import PortfolioItemService, TestimonialService


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
		self.assertLessEqual(item.image.size, 500 * 1024)

	def test_service_create_processes_portfolio_image_to_webp(self):
		item = PortfolioItemService.create(
			category_id=self.category.id,
			item_type='image',
			image=self._uploaded_image('service.jpg'),
			is_active=True,
		)

		self.assertTrue(item.image.name.lower().endswith('.webp'))
		self.assertLessEqual(item.image.size, 500 * 1024)

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


class TestimonialSubmissionTests(TestCase):
	def setUp(self):
		cache.clear()

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
		Testimonial.objects.create(
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


class ProUserFeedbackPageTests(TestCase):
	def test_pro_user_feedback_page_renders(self):
		user = User.objects.create_user(
			username='pro@example.com',
			email='pro@example.com',
			password='testpass123',
			role='pro_user',
		)
		self.client.force_login(user)

		response = self.client.get(reverse('pro_user_feedback'))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.context['active_page'], 'pro_user_feedback')

	@mock.patch('core.context_processors.TestimonialService.has_public_review', side_effect=DatabaseError('missing reviewer_ip column'))
	def test_pro_user_feedback_page_handles_public_review_lookup_db_errors(self, _mock_has_public_review):
		user = User.objects.create_user(
			username='pro-fallback@example.com',
			email='pro-fallback@example.com',
			password='testpass123',
			role='pro_user',
		)
		self.client.force_login(user)

		response = self.client.get(reverse('pro_user_feedback'))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.context['active_page'], 'pro_user_feedback')
		self.assertTrue(response.context['can_submit_public_review'])
