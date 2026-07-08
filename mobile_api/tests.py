import io
from django.test import TestCase, Client
from django.urls import reverse
from PIL import Image

class PhotoValidationApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.url = reverse('mobile_api:api_validate_photo')

    def test_get_method_not_allowed(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 405)

    def test_post_no_photo(self):
        response = self.client.post(self.url)
        self.assertEqual(response.status_code, 400)
        self.assertJSONEqual(response.content, {'success': False, 'message': 'No photo uploaded'})

    def test_post_invalid_image_file(self):
        bad_file = io.BytesIO(b'this is not an image file')
        bad_file.name = 'test.jpg'
        response = self.client.post(self.url, {'photo': bad_file})
        self.assertEqual(response.status_code, 400)
        self.assertIn('Invalid image', response.json().get('message', ''))

    def test_post_valid_image_no_face(self):
        # Create a small 100x100 solid black square image (no face inside)
        img = Image.new('RGB', (100, 100), color='black')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='JPEG')
        img_bytes.seek(0)
        img_bytes.name = 'noface.jpg'
        
        response = self.client.post(self.url, {'photo': img_bytes})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data['success'])
        self.assertFalse(data['face_detected'])
        self.assertEqual(data['message'], 'No Person Detected')
