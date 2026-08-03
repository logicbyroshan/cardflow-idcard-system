from django.urls import path
from apps.hardening.views import (
    RootHealthView,
    LivenessCheckView,
    DatabaseHealthView,
    RedisHealthView,
    CeleryHealthView,
    StorageHealthView,
)

urlpatterns = [
    path('health/', RootHealthView.as_view(), name='health_root'),
    path('health/ready/', RootHealthView.as_view(), name='health_ready'),
    path('health/live/', LivenessCheckView.as_view(), name='health_live'),
    path('health/db/', DatabaseHealthView.as_view(), name='health_db'),
    path('health/redis/', RedisHealthView.as_view(), name='health_redis'),
    path('health/celery/', CeleryHealthView.as_view(), name='health_celery'),
    path('health/storage/', StorageHealthView.as_view(), name='health_storage'),
]
