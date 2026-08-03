from django.urls import path, include
from rest_framework.routers import SimpleRouter
from apps.imports.views import ImportSessionViewSet, ReuploadSessionViewSet

router = SimpleRouter()
router.register('imports/sessions', ImportSessionViewSet, basename='imports-sessions')
router.register('reuploads/sessions', ReuploadSessionViewSet, basename='reuploads-sessions')

urlpatterns = [
    path('', include(router.urls)),
]
