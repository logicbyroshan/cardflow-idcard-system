from django.urls import path
from apps.fields.views import FieldViewSet

urlpatterns = [
    path('fields/', FieldViewSet.as_view({'get': 'list', 'post': 'create'}), name='fields-list'),
]
