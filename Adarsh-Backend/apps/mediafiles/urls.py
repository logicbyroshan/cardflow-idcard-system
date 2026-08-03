from django.urls import path, include
from rest_framework.routers import SimpleRouter
from apps.mediafiles.views import MediaViewSet

router = SimpleRouter()
router.register(r'media', MediaViewSet, basename='media')

urlpatterns = [
    path('', include(router.urls)),
]
