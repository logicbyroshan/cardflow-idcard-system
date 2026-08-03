from django.urls import path
from apps.tables.views import TableViewSet

urlpatterns = [
    path('tables/', TableViewSet.as_view({'get': 'list', 'post': 'create'}), name='tables-list'),
]
