import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')

app = Celery('adarsh')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django apps.
app.autodiscover_tasks()

from celery.signals import before_task_publish, task_prerun, task_postrun

@before_task_publish.connect
def before_task_publish_handler(headers=None, body=None, **kwargs):
    if headers is not None:
        try:
            from apps.hardening.context import get_request_id
            rid = get_request_id()
            if rid:
                headers['x_request_id'] = rid
        except ImportError:
            pass

@task_prerun.connect
def task_prerun_handler(task_id=None, task=None, *args, **kwargs):
    rid = None
    if task and task.request:
        rid = getattr(task.request, 'x_request_id', None)
        if not rid and hasattr(task.request, 'headers') and task.request.headers:
            rid = task.request.headers.get('x_request_id')
            
    if rid:
        try:
            from apps.hardening.context import set_request_context
            set_request_context(request_id=rid)
        except ImportError:
            pass

@task_postrun.connect
def task_postrun_handler(task_id=None, task=None, retval=None, state=None, **kwargs):
    try:
        from apps.hardening.context import clear_request_context
        clear_request_context()
    except ImportError:
        pass
