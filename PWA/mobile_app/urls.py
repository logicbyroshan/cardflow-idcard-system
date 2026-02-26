from django.urls import path
from . import views

app_name = 'mobile_app'

urlpatterns = [
    # Page views
    path('', views.home, name='home'),
    path('tables/<str:status>/', views.table_picker, name='table_picker'),
    path('table/<int:table_id>/<str:status>/', views.card_list, name='card_list'),
    path('camera/<int:table_id>/', views.camera_capture, name='camera_capture'),
    path('camera/<int:table_id>/<int:card_id>/', views.camera_capture, name='camera_capture_card'),
    path('notifications/', views.notifications, name='notifications'),
    path('profile/', views.profile, name='profile'),

    # API endpoints (thin proxies to existing services)
    path('api/card/<int:card_id>/status/', views.api_card_status, name='api_card_status'),
    path('api/card/<int:card_id>/detail/', views.api_card_detail, name='api_card_detail'),
    path('api/table/<int:table_id>/cards/', views.api_cards, name='api_cards'),
    path('api/table/<int:table_id>/bulk-status/', views.api_bulk_status, name='api_bulk_status'),
    path('api/table/<int:table_id>/upload-photo/', views.api_upload_photo, name='api_upload_photo'),
    path('api/table/<int:table_id>/card/add/', views.api_card_add, name='api_card_add'),
    path('api/table/<int:table_id>/card/<int:card_id>/update/', views.api_card_update, name='api_card_update'),
]
