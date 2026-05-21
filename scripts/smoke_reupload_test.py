import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django
django.setup()

from mediafiles.services.image_service import ImageService
from django.core.files.uploadedfile import SimpleUploadedFile
from client.models import Client

client = Client.objects.first()
if not client:
    print('No client found; abort smoke test')
    raise SystemExit(0)

import base64
# Use a valid 1x1 PNG image
img = base64.b64decode(
    b'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg=='
)
res = ImageService.save_new_image(img, client, 'photo', card=None, original_filename='test.png', uploaded_by=None)
print('save_new:', res.success, res.message, res.data.get('path'))
existing = res.data.get('path')
res2 = ImageService.replace_image(img, client, 'photo', existing_path=existing, card=None, original_filename='test.png')
print('replace:', res2.success, res2.message, res2.data.get('path'))
