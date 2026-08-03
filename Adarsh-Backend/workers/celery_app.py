import os
from celery import Celery
from .settings import CELERY_CONFIG

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')

app = Celery('adarsh')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.conf.update(**CELERY_CONFIG)
app.autodiscover_tasks()\n