from django.urls import path, include
from rest_framework.routers import SimpleRouter
from apps.jobs.views import JobViewSet

router = SimpleRouter()
router.register(r'jobs', JobViewSet, basename='job')

urlpatterns = [
    path('', include(router.urls)),
]
