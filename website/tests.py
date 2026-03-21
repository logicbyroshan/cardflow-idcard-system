from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image

from website.models import PortfolioCategory, PortfolioItem
from website.services import PortfolioItemService


class PortfolioUploadProcessingTests(TestCase):
	def setUp(self):
		self.category = PortfolioCategory.objects.create(name='Test Category')

	def _uploaded_image(self, name='sample.jpg'):
		buffer = BytesIO()
		Image.new('RGB', (1200, 800), color=(210, 80, 90)).save(buffer, format='JPEG', quality=95)
		buffer.seek(0)
		return SimpleUploadedFile(name, buffer.read(), content_type='image/jpeg')

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
