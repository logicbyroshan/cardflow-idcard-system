from django.urls import path
from apps.permissions.views import PermissionViewSet

urlpatterns = [
    path('', PermissionViewSet.as_view({'get': 'list', 'post': 'create'}), name='permissions'),
]
