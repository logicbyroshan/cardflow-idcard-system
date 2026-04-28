from django.urls import path
from . import views

app_name = 'mobile_app'

urlpatterns = [
    # PWA Manifest — required for 'Add to Home Screen' / install prompt
    path('manifest.json', views.pwa_manifest, name='pwa_manifest'),

    # PWA Service Worker — required by Chrome/Android for install prompt
    path('sw.js', views.pwa_service_worker, name='pwa_service_worker'),

    # Mobile login (dedicated PWA login screen)
    path('login/', views.mobile_login, name='mobile_login'),
    path('no-access/', views.mobile_no_access, name='mobile_no_access'),
    path('desktop-required/', views.desktop_required, name='desktop_required'),

    # Page views
    path('', views.home, name='home'),
    path('clients/', views.clients_list, name='clients_list'),
    path('clients/<int:client_id>/groups/', views.client_groups, name='client_groups'),
    path('tables/<str:status>/', views.table_picker, name='table_picker'),
    path('table/<int:table_id>/<str:status>/', views.card_list, name='card_list'),
    path('reprint/<int:client_id>/', views.reprint_lists, name='reprint_lists'),
    path('reprint/table/<int:table_id>/', views.reprint_table, name='reprint_table'),
    path('camera/<int:table_id>/', views.camera_capture, name='camera_capture'),
    path('camera/<int:table_id>/<int:card_id>/', views.camera_capture, name='camera_capture_card'),
    path('notifications/', views.notifications, name='notifications'),
    path('profile/', views.profile, name='profile'),
    path('permissions/', views.permissions_center, name='permissions_center'),
    path('card/<int:card_id>/', views.card_detail, name='card_detail'),
    path('staff/', views.staff_manage, name='staff_manage'),
    path('groups/', views.groups_overview, name='groups_overview'),
    path('settings/', views.settings_page, name='settings_page'),
    path('search/', views.search_page, name='search_page'),

    # API endpoints (thin proxies to existing services)
    path('api/auth/login/', views.api_mobile_login, name='api_mobile_login'),
    path('api/card/<int:card_id>/status/', views.api_card_status, name='api_card_status'),
    path('api/card/<int:card_id>/detail/', views.api_card_detail, name='api_card_detail'),
    path('api/card/<int:card_id>/delete/', views.api_card_delete, name='api_card_delete'),
    path('api/table/<int:table_id>/cards/', views.api_cards, name='api_cards'),
    path('api/table/<int:table_id>/cards/all-ids/', views.api_all_card_ids, name='api_all_card_ids'),
    path('api/table/<int:table_id>/filter-options/', views.api_filter_options, name='api_filter_options'),
    path('api/table/<int:table_id>/bulk-status/', views.api_bulk_status, name='api_bulk_status'),
    path('api/table/<int:table_id>/upload-photo/', views.api_upload_photo, name='api_upload_photo'),
    path('api/table/<int:table_id>/card/add/', views.api_card_add, name='api_card_add'),
    path('api/table/<int:table_id>/card/<int:card_id>/update/', views.api_card_update, name='api_card_update'),
    path('api/table/<int:table_id>/update-fields/', views.api_table_update_fields, name='api_table_update_fields'),

    # Staff management APIs
    path('api/staff/', views.api_staff_list, name='api_staff_list'),
    path('api/staff/create/', views.api_staff_create, name='api_staff_create'),
    path('api/staff/<int:staff_id>/update/', views.api_staff_update, name='api_staff_update'),
    path('api/staff/<int:staff_id>/toggle/', views.api_staff_toggle, name='api_staff_toggle'),
    path('api/staff/<int:staff_id>/delete/', views.api_staff_delete, name='api_staff_delete'),

    # Profile & Search APIs
    path('api/profile/', views.api_profile_data, name='api_profile_data'),
    path('api/profile/update/', views.api_profile_update, name='api_profile_update'),
    path('api/profile/delete-request/', views.api_profile_delete_request, name='api_profile_delete_request'),
    path('api/search/', views.api_search, name='api_search'),
    path('api/server-info/', views.api_server_info, name='api_server_info'),

    # Native app specific APIs
    path('api/notifications/', views.api_notifications_list, name='api_notifications_list'),
    path('api/tables/', views.api_tables_list, name='api_tables_list'),
    path('api/groups/', views.api_groups_list, name='api_groups_list'),
    path('api/settings/', views.api_settings_data, name='api_settings_data'),
    path('api/dashboard/', views.api_dashboard_data, name='api_dashboard_data'),
    path('api/reprint/<int:client_id>/', views.api_reprint_data, name='api_reprint_data'),
    path('api/mobile-shell/config/', views.api_mobile_shell_config, name='api_mobile_shell_config'),
    path('api/mobile-shell/device/register/', views.api_mobile_shell_device_register, name='api_mobile_shell_device_register'),
    path('api/mobile-shell/device/ping/', views.api_mobile_shell_device_ping, name='api_mobile_shell_device_ping'),
    path('api/mobile-shell/device/summary/', views.api_mobile_shell_device_summary, name='api_mobile_shell_device_summary'),

    # Pro user impersonation APIs (mobile surface)
    path('api/impersonate/users/', views.api_impersonate_users, name='api_impersonate_users'),
    path('api/impersonate/start/', views.api_impersonate_start, name='api_impersonate_start'),
    path('api/impersonate/stop/', views.api_impersonate_stop, name='api_impersonate_stop'),

    # Client Management APIs
    path('api/client/create/', views.api_client_create, name='api_client_create'),
    path('api/client/<int:client_id>/', views.api_client_detail, name='api_client_detail'),
    path('api/client/<int:client_id>/update/', views.api_client_update, name='api_client_update'),
    path('api/client/<int:client_id>/toggle/', views.api_client_toggle, name='api_client_toggle'),
    path('api/client/<int:client_id>/delete/', views.api_client_delete, name='api_client_delete'),
    path('api/client/<int:client_id>/tables/', views.api_client_tables, name='api_client_tables'),

    # Website management (unified portfolio media upload from mobile)
    path('website/', views.website_manage, name='website_manage'),
    path('api/website/portfolio/upload/', views.api_portfolio_upload, name='api_portfolio_upload'),
    path('api/website/portfolio/category/<int:category_id>/items/', views.api_portfolio_category_items, name='api_portfolio_category_items'),
]
