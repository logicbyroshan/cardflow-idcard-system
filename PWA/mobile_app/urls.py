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
    path('card/<int:card_id>/', views.card_detail, name='card_detail'),
    path('staff/', views.staff_manage, name='staff_manage'),
    path('groups/', views.groups_overview, name='groups_overview'),
    path('settings/', views.settings_page, name='settings_page'),
    path('search/', views.search_page, name='search_page'),

    # API endpoints (thin proxies to existing services)
    path('api/card/<int:card_id>/status/', views.api_card_status, name='api_card_status'),
    path('api/card/<int:card_id>/detail/', views.api_card_detail, name='api_card_detail'),
    path('api/card/<int:card_id>/delete/', views.api_card_delete, name='api_card_delete'),
    path('api/table/<int:table_id>/cards/', views.api_cards, name='api_cards'),
    path('api/table/<int:table_id>/bulk-status/', views.api_bulk_status, name='api_bulk_status'),
    path('api/table/<int:table_id>/upload-photo/', views.api_upload_photo, name='api_upload_photo'),
    path('api/table/<int:table_id>/card/add/', views.api_card_add, name='api_card_add'),
    path('api/table/<int:table_id>/card/<int:card_id>/update/', views.api_card_update, name='api_card_update'),

    # Staff management APIs
    path('api/staff/', views.api_staff_list, name='api_staff_list'),
    path('api/staff/create/', views.api_staff_create, name='api_staff_create'),
    path('api/staff/<int:staff_id>/update/', views.api_staff_update, name='api_staff_update'),
    path('api/staff/<int:staff_id>/toggle/', views.api_staff_toggle, name='api_staff_toggle'),
    path('api/staff/<int:staff_id>/delete/', views.api_staff_delete, name='api_staff_delete'),

    # Profile & Search APIs
    path('api/profile/update/', views.api_profile_update, name='api_profile_update'),
    path('api/search/', views.api_search, name='api_search'),
]
