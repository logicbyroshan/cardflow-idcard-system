from .queues import task_queues
from .task_routes import task_routes

CELERY_CONFIG = {
    'task_queues': task_queues,
    'task_routes': task_routes,
    'task_default_queue': 'default',
    'task_serializer': 'json',
    'result_serializer': 'json',
    'accept_content': ['json'],
    'worker_prefetch_multiplier': 1,
    'task_acks_late': True,
    'task_reject_on_worker_lost': True,
    'task_publish_retry': True,
    'task_publish_retry_policy': {
        'max_retries': 5,
        'interval_start': 0,
        'interval_step': 0.5,
        'interval_max': 2.0,
    },
    'worker_max_tasks_per_child': 1000,
}\n