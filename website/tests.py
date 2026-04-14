from io import BytesIO

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image

from website.models import PortfolioCategory, PortfolioItem
from website.services import PortfolioItemService


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
