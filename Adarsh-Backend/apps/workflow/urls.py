from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.workflow.views import WorkflowViewSet

router = DefaultRouter()
router.register(r'workflow', WorkflowViewSet, basename='workflow')

urlpatterns = [
    path('', include(router.urls)),
]
