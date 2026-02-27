"""
Tests for mediafiles app.
Covers: CardMedia model, ImageService basics.
"""
from django.test import TestCase
from django.contrib.auth import get_user_model

User = get_user_model()


def _create_test_card():
    """Create a client, group, table, and card for mediafiles testing."""
    user = User.objects.create_user(
        username='mfcl@test.com', email='mfcl@test.com',
        password='pass1234', role='client',
    )
    from client.models import Client
    client = Client.objects.create(user=user, name='Media Client')
    from workflows.models import IDCardGroup, IDCardTable, IDCard
    group = IDCardGroup.objects.create(client=client, name='MF Group')
    table = IDCardTable.objects.create(
        group=group, name='MF Table',
        fields=[
            {'name': 'NAME', 'type': 'text', 'order': 1},
            {'name': 'PHOTO', 'type': 'photo', 'order': 2},
        ],
    )
    card = IDCard.objects.create(
        table=table, field_data={'NAME': 'MEDIA TEST'}, status='pending',
    )
    return client, group, table, card


class CardMediaModelTests(TestCase):
    """Tests for CardMedia model."""

    def test_create_card_media(self):
        from mediafiles.models import CardMedia
        from django.core.files.uploadedfile import SimpleUploadedFile
        client, group, table, card = _create_test_card()

        # Create a minimal valid PNG
        png_bytes = (
            b'\x89PNG\r\n\x1a\n'
            b'\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
            b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx'
            b'\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00'
            b'\x00\x00\x00IEND\xaeB`\x82'
        )
        image_file = SimpleUploadedFile('test.png', png_bytes, content_type='image/png')

        media = CardMedia.objects.create(
            card=card,
            client=client,
            file=image_file,
            media_type='photo',
            field_name='PHOTO',
            original_filename='test.png',
        )
        self.assertEqual(media.media_type, 'photo')
        self.assertEqual(media.card.id, card.id)
        self.assertEqual(media.client.id, client.id)
        self.assertTrue(media.file.name)

    def test_card_media_without_card(self):
        """Template images can have null card."""
        from mediafiles.models import CardMedia
        from django.core.files.uploadedfile import SimpleUploadedFile
        client, group, table, card = _create_test_card()

        png_bytes = b'\x89PNG\r\n\x1a\n' + b'\x00' * 50
        image_file = SimpleUploadedFile('template.png', png_bytes, content_type='image/png')

        media = CardMedia.objects.create(
            card=None,
            group=group,
            client=client,
            file=image_file,
            media_type='template_front',
        )
        self.assertIsNone(media.card)
        self.assertEqual(media.group.id, group.id)


class ImageServiceBasicTests(TestCase):
    """Basic tests for ImageService."""

    def test_validate_image_bytes_valid_png(self):
        from core.utils.field_utils import validate_image_bytes
        # Generate a valid PNG using PIL (100x100 to exceed 100-byte minimum)
        from io import BytesIO
        try:
            from PIL import Image
            buf = BytesIO()
            Image.new('RGB', (100, 100), color='red').save(buf, format='PNG')
            png_bytes = buf.getvalue()
            self.assertGreater(len(png_bytes), 100, 'PNG must exceed 100 bytes')
            is_valid, error_msg = validate_image_bytes(png_bytes)
            self.assertTrue(is_valid, f'validate_image_bytes failed: {error_msg}')
        except ImportError:
            self.skipTest('Pillow not installed')

    def test_validate_image_bytes_invalid(self):
        from core.utils.field_utils import validate_image_bytes
        is_valid, error_msg = validate_image_bytes(b'not an image')
        self.assertFalse(is_valid)

    def test_validate_image_bytes_empty(self):
        from core.utils.field_utils import validate_image_bytes
        is_valid, error_msg = validate_image_bytes(b'')
        self.assertFalse(is_valid)
