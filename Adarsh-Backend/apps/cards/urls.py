from django.urls import path
from apps.cards.views import CardViewSet

urlpatterns = [
    path('cards/', CardViewSet.as_view({'get': 'list', 'post': 'create'}), name='cards-list'),
    path('cards/bulk-update/', CardViewSet.as_view({'patch': 'bulk_update'}), name='cards-bulk-update'),
    path('cards/<uuid:pk>/', CardViewSet.as_view({'patch': 'partial_update', 'delete': 'destroy'}), name='cards-detail'),
    path('cards/search/', CardViewSet.as_view({'get': 'search'}), name='cards-search'),
]
