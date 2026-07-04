from django.urls import path, include
from rest_framework.routers import SimpleRouter
from apps.exports.views import ExportTemplateViewSet, ExportSessionViewSet

router = SimpleRouter()
router.register('exports/templates', ExportTemplateViewSet, basename='exports-templates')
router.register('exports/sessions', ExportSessionViewSet, basename='exports-sessions')

urlpatterns = [
    path('', include(router.urls)),
]
