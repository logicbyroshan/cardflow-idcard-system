from django.urls import include, path
from django.views.decorators.csrf import csrf_exempt
from . import views
from exports import views as export_views

urlpatterns = [
    # ==================== AUTHENTICATION ====================
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('inactive/', views.inactive_view, name='inactive'),
    path('maintenance/', views.maintenance_view, name='maintenance'),
    path('maintenance/system/', views.system_maintenance_page, name='system_maintenance_page'),
    path('api/auth/check-maintenance/', views.api_check_maintenance, name='api_check_maintenance'),
    path('api/maintenance/status/', views.api_system_maintenance_check, name='api_system_maintenance_check'),
    path('api/maintenance/toggle/', views.api_maintenance_toggle, name='api_maintenance_toggle'),
    path('api/auth/check-email/', csrf_exempt(views.api_check_email), name='api_check_email'),
    path('api/auth/login/', csrf_exempt(views.api_login), name='api_login'),
    path('api/auth/forgot-password/', csrf_exempt(views.api_forgot_password), name='api_forgot_password'),
    path('api/auth/verify-otp/', csrf_exempt(views.api_verify_otp), name='api_verify_otp'),
    path('api/auth/reset-password/', csrf_exempt(views.api_reset_password), name='api_reset_password'),
    path('api/auth/impersonate/start/', csrf_exempt(views.api_impersonate_start), name='api_impersonate_start'),
    path('api/auth/impersonate/stop/', csrf_exempt(views.api_impersonate_stop), name='api_impersonate_stop'),
    path('api/auth/impersonate/users/', csrf_exempt(views.api_impersonate_users), name='api_impersonate_users'),
    path('api/auth/user-audit/users/', csrf_exempt(views.api_user_audit_users), name='api_user_audit_users'),
    path('api/auth/user-audit/history/', csrf_exempt(views.api_user_audit_history), name='api_user_audit_history'),
    path('api/auth/user-audit/actions/', csrf_exempt(views.api_user_audit_actions), name='api_user_audit_actions'),
    
    # Role-specific Dashboards
    path('admin-staff-dashboard/', views.admin_staff_dashboard, name='admin_staff_dashboard'),
    path('client-dashboard/', views.client_dashboard, name='client_dashboard'),
    path('client-staff-dashboard/', views.client_staff_dashboard, name='client_staff_dashboard'),
    
    # Dashboard (Super Admin)
    path('', views.dashboard, name='dashboard'),
    
    # Global Search API
    path('api/global-search/', views.api_global_search, name='api_global_search'),

    # Dashboard live card stats API
    path('api/dashboard-card-stats/', views.api_dashboard_card_stats, name='api_dashboard_card_stats'),
    
    # Recent Client Updates API
    path('api/recent-client-updates/', views.api_recent_client_updates, name='api_recent_client_updates'),

    # Live working client presence APIs
    path('api/presence/track/', views.api_presence_track, name='api_presence_track'),
    path('api/presence/live-count/', views.api_live_client_presence, name='api_live_client_presence'),


    
    # Recent Activity API
    path('api/recent-activity/', views.api_recent_activity, name='api_recent_activity'),
    
    # Reprint Overview API
    path('api/reprint-overview/', views.api_reprint_overview, name='api_reprint_overview'),
    
    # Staff Management
    path('manage-staff/', views.manage_staff, name='manage_staff'),
    # Keep a named route for legacy references; the view redirects to `manage_staff`.
    path('manage-client-staff/', views.manage_client_staff, name='manage_client_staff'),

    # Client Management
    path('manage-clients/', views.manage_clients, name='manage_clients'),

    # Legacy Active Clients backlinks (redirect to Manage Clients)
    path('active-clients/', views.active_clients, name='active_clients'),
    path('client/<int:client_id>/status/<str:status>/', views.active_client_status_redirect, name='active_client_status_redirect'),
    
    # ID Card Group for a client (shows all tables with status counts)
    path('client/<int:client_id>/groups/', views.idcard_group, name='idcard_group'),

    # ID Card Actions for a table (shows cards, can filter by status)
    path('table/<int:table_id>/cards/', views.idcard_actions, name='idcard_actions'),
    
    # Group Settings for a client (manage tables)
    path('client/<int:client_id>/settings/', views.group_settings, name='group_settings'),

    # NOTE: Reprint Cards moved to 'reprintcard' app — see config/urls.py

    # ==================== SERVICES ==

    # User Options (Pro User only)
    path('login-as-user/', views.login_as_user_page, name='login_as_user'),

    # Backward-compatible deep-history list URL (redirects to User Options)
    path('pro-user/activity-logs/', views.pro_user_activity_logs_page, name='pro_user_activity_logs'),
    path('pro-user/log-deletion-guard/', views.pro_user_log_deletion_guard_page, name='pro_user_log_deletion_guard'),
    path('pro-user/data-deletion-guard/', views.pro_user_data_deletion_guard_page, name='pro_user_data_deletion_guard'),
    path('pro-user/super-mode/', views.pro_user_super_mode_page, name='pro_user_super_mode'),
    path('pro-user/guest-users/', views.pro_user_guest_users_page, name='pro_user_guest_users'),
    path('pro-user/activity-logs/<int:user_id>/', views.pro_user_activity_logs_detail_page, name='pro_user_activity_logs_detail'),
    
    # Manage Panel
    path('manage-panel/', views.manage_panel, name='manage_panel'),
    path('api/email-logs/', views.api_email_logs, name='api_email_logs'),
    path('api/email-resend/<int:log_id>/', views.api_email_resend, name='api_email_resend'),
    path('api/email-send/', views.api_email_send_new, name='api_email_send_new'),
    path('api/email-compose-defaults/', views.api_email_compose_defaults, name='api_email_compose_defaults'),
    
    # ==================== BACKUP ====================
    path('backup/select-clients/', views.backup_select_clients, name='backup_select_clients'),
    path('api/backup/generate-code/', views.api_backup_generate_code, name='api_backup_generate_code'),
    path('api/backup/initiate/', views.api_backup_initiate, name='api_backup_initiate'),
    path('api/backup/start/', views.api_backup_start, name='api_backup_start'),
    path('api/backup/list/', views.api_backup_list, name='api_backup_list'),
    path('api/backup/status/<int:task_id>/', views.api_backup_status, name='api_backup_status'),
    path('api/backup/<int:task_id>/delete-now/', views.api_backup_delete_now, name='api_backup_delete_now'),
    path('api/backup/download/<int:task_id>/', views.api_backup_download, name='api_backup_download'),
    
    # Notifications Page (all authenticated users)
    path('notifications/', views.notifications_page, name='notifications_page'),

    # ==================== NOTIFICATION APIs ====================
    # User-facing notifications
    path('api/notifications/list/', views.api_notifications_list, name='api_notifications_list'),
    path('api/notifications/unread-count/', views.api_notifications_unread_count, name='api_notifications_unread_count'),
    path('api/notifications/<int:notification_id>/read/', views.api_notification_mark_read, name='api_notification_mark_read'),
    path('api/notifications/mark-all-read/', views.api_notifications_mark_all_read, name='api_notifications_mark_all_read'),
    path('api/notifications/client-messages/unread/', views.api_client_message_strip, name='api_client_message_strip'),
    # Admin notification management
    path('api/notifications/admin/list/', views.api_panel_notifications_list, name='api_panel_notifications_list'),
    path('api/notifications/admin/create/', views.api_panel_notification_create, name='api_panel_notification_create'),
    path('api/notifications/admin/<int:notification_id>/delete/', views.api_panel_notification_delete, name='api_panel_notification_delete'),
    path('api/notifications/admin/target-users/', views.api_panel_target_users, name='api_panel_target_users'),

    # Client Tutorial (all authenticated users; content is client-oriented)
    path('tutorial/', views.tutorial, name='tutorial'),
    path('tutorial/personal-guide/', views.tutorial_personal_guide, name='tutorial_personal_guide'),
    path('tutorial/personal-guide/download/', views.tutorial_personal_guide_download, name='tutorial_personal_guide_download'),

    # System Settings
    path('settings/', views.settings, name='settings'),
    
    # ==================== API ENDPOINTS ====================
    # Client APIs
    path('api/client/create/', views.api_client_create, name='api_client_create'),
    path('api/client/<int:client_id>/', views.api_client_get, name='api_client_get'),
    path('api/client/<int:client_id>/update/', views.api_client_update, name='api_client_update'),
    path('api/client/<int:client_id>/delete/', views.api_client_delete, name='api_client_delete'),
    path('api/client/<int:client_id>/toggle-status/', views.api_client_toggle_status, name='api_client_toggle_status'),
    path('api/client/<int:client_id>/staff/', views.api_client_staff, name='api_client_staff'),
    path('api/client/<int:client_id>/staff/<int:staff_id>/toggle-status/', views.api_client_staff_toggle_status, name='api_client_staff_toggle_status'),
    path('api/client/<int:client_id>/staff/<int:staff_id>/permissions/', views.api_client_staff_permissions, name='api_client_staff_permissions'),
    path('api/client/<int:client_id>/set-temp-password/', views.api_client_set_temp_password, name='api_client_set_temp_password'),
    path('api/client/<int:client_id>/logo/', views.api_client_logo_get, name='api_client_logo_get'),
    path('api/client/<int:client_id>/logo/upload/', views.api_client_logo_upload, name='api_client_logo_upload'),
    path('api/client/<int:client_id>/logo/delete/', views.api_client_logo_delete, name='api_client_logo_delete'),
    path('api/client/<int:client_id>/messages/', views.api_client_messages, name='api_client_messages'),
    path('api/client/<int:client_id>/messages/send/', views.api_client_message_send, name='api_client_message_send'),
    path('api/client/messages/targets/', views.api_client_message_targets, name='api_client_message_targets'),
    path('api/client/messages/group-send/', views.api_client_messages_group_send, name='api_client_messages_group_send'),
    path('api/client/<int:client_id>/messages/<int:message_id>/delete/', views.api_client_message_delete, name='api_client_message_delete'),
    path('api/client/<int:client_id>/login-history/', views.api_client_login_history, name='api_client_login_history'),
    path('api/client-staff/<int:staff_id>/login-history/', views.api_client_staff_login_history, name='api_client_staff_login_history'),
    path('api/client-staff/<int:staff_id>/assignment-timeline/', views.api_client_staff_assignment_timeline, name='api_client_staff_assignment_timeline'),
    # NOTE: Admin-side Manage Assistant pages and APIs removed — client-side assistant features remain.
    
    # Staff APIs
    path('api/staff/create/', views.api_staff_create, name='api_staff_create'),
    path('api/staff/<int:staff_id>/', views.api_staff_get, name='api_staff_get'),
    path('api/staff/<int:staff_id>/update/', views.api_staff_update, name='api_staff_update'),
    path('api/staff/<int:staff_id>/delete/', views.api_staff_delete, name='api_staff_delete'),
    path('api/staff/<int:staff_id>/toggle-status/', views.api_staff_toggle_status, name='api_staff_toggle_status'),
    path('api/staff/<int:staff_id>/login-history/', views.api_staff_login_history, name='api_staff_login_history'),
    path('api/staff/<int:staff_id>/assignment-timeline/', views.api_staff_assignment_timeline, name='api_staff_assignment_timeline'),
    path('api/clients/active/', views.api_active_clients_list, name='api_active_clients_list'),
    path('api/clients/for-staff-assignment/', views.api_all_clients_for_assignment, name='api_all_clients_for_assignment'),
    path('api/staff/<int:staff_id>/set-temp-password/', views.api_staff_set_temp_password, name='api_staff_set_temp_password'),
    
    # ID Card Table APIs
    path('api/group/<int:group_id>/tables/', views.api_idcard_table_list, name='api_idcard_table_list'),
    path('api/group/<int:group_id>/table/create/', views.api_idcard_table_create, name='api_idcard_table_create'),
    path('api/table/<int:table_id>/', views.api_idcard_table_get, name='api_idcard_table_get'),
    path('api/table/<int:table_id>/update/', views.api_idcard_table_update, name='api_idcard_table_update'),
    path('api/table/<int:table_id>/delete/', views.api_idcard_table_delete, name='api_idcard_table_delete'),
    path('api/table/<int:table_id>/generate-delete-code/', views.api_generate_table_delete_code, name='api_generate_table_delete_code'),
    path('api/table/<int:table_id>/toggle-status/', views.api_idcard_table_toggle_status, name='api_idcard_table_toggle_status'),
    path('api/group/<int:group_id>/table/create-from-xlsx/', views.api_create_table_from_xlsx, name='api_create_table_from_xlsx'),
    
    # ID Card APIs
    path('api/table/<int:table_id>/cards/', views.api_idcard_list, name='api_idcard_list'),
    path('api/table/<int:table_id>/cards-json/', views.api_idcard_cards_json, name='api_idcard_cards_json'),
    path('api/table/<int:table_id>/cards/all-ids/', views.api_idcard_all_ids, name='api_idcard_all_ids'),
    path('api/table/<int:table_id>/filter-options/', views.api_idcard_filter_options, name='api_idcard_filter_options'),
    path('api/table/<int:table_id>/card/create/', views.api_idcard_create, name='api_idcard_create'),
    path('api/card/<int:card_id>/', views.api_idcard_get, name='api_idcard_get'),
    path('api/card/<int:card_id>/history/', views.api_idcard_history, name='api_idcard_history'),
    path('api/card/<int:card_id>/update/', views.api_idcard_update, name='api_idcard_update'),
    path('api/card/<int:card_id>/update-field/', views.api_idcard_update_field, name='api_idcard_update_field'),
    path('api/image/preview-convert/', views.api_image_preview_convert, name='api_image_preview_convert'),
    path('api/card/<int:card_id>/delete/', views.api_idcard_delete, name='api_idcard_delete'),
    path('api/card/<int:card_id>/status/', views.api_idcard_change_status, name='api_idcard_change_status'),
    path('api/table/<int:table_id>/cards/bulk-status/', views.api_idcard_bulk_status, name='api_idcard_bulk_status'),
    path('api/table/<int:table_id>/cards/bulk-delete/', views.api_idcard_bulk_delete, name='api_idcard_bulk_delete'),
    path('api/table/<int:table_id>/cards/generate-delete-code/', views.api_generate_delete_code, name='api_generate_delete_code'),
    path('api/table/<int:table_id>/cards/generate-upgrade-code/', views.api_generate_upgrade_code, name='api_generate_upgrade_code'),
    path('api/table/<int:table_id>/cards/upgrade-classes/', views.api_upgrade_all_classes, name='api_upgrade_all_classes'),
    path('api/table/<int:table_id>/cards/bulk-upload/', views.api_idcard_bulk_upload, name='api_idcard_bulk_upload'),
    path('api/table/<int:table_id>/cards/search/', views.api_idcard_search, name='api_idcard_search'),
    path('api/table/<int:table_id>/status-counts/', views.api_table_status_counts, name='api_table_status_counts'),
    path('api/table/<int:table_id>/cards/download-images/', export_views.api_export_images, name='api_idcard_download_images'),
    path('api/table/<int:table_id>/cards/reupload-images/', views.api_idcard_reupload_images, name='api_idcard_reupload_images'),
    path('api/table/<int:table_id>/modals-html/', views.api_idcard_modals_html, name='api_idcard_modals_html'),
    path('api/table/<int:table_id>/cards/download-docx/', export_views.api_export_docx, name='api_idcard_download_docx'),
    path('api/table/<int:table_id>/cards/download-xlsx/', export_views.api_export_xlsx, name='api_idcard_download_xlsx'),
    path('api/table/<int:table_id>/cards/download-pdf/', export_views.api_export_pdf, name='api_idcard_download_pdf'),
    path('api/table/<int:table_id>/cards/download-pdf-async/', export_views.api_export_pdf_async, name='api_idcard_download_pdf_async'),
    path('api/export/status/<str:task_id>/', export_views.api_export_status, name='api_export_status'),
    path('api/table/<int:table_id>/cards/download-all/', export_views.api_download_all_cards, name='api_idcard_download_all'),
    
    # Background Task APIs (for async bulk operations)
    path('api/task-status/<int:task_id>/', views.api_task_status, name='api_task_status'),
    path('api/task-download/<int:task_id>/', views.api_task_download, name='api_task_download'),
    path('api/task-cancel/<int:task_id>/', views.api_task_cancel, name='api_task_cancel'),
    path('api/tasks/', views.api_task_list, name='api_task_list'),
    path('api/task-active/', views.api_task_active, name='api_task_active'),
    path('api/task-progress-center/', views.api_task_progress_center, name='api_task_progress_center'),
    path('api/table/<int:table_id>/bulk-upload-task/', views.api_create_bulk_upload_task, name='api_create_bulk_upload_task'),
    path('api/table/<int:table_id>/reupload-task/', views.api_create_reupload_task, name='api_create_reupload_task'),
    path('api/table/<int:table_id>/export-task/', views.api_create_export_task, name='api_create_export_task'),
    
    # Export Settings APIs
    path('api/export-settings/', views.api_export_settings_get, name='api_export_settings_get'),
    path('api/export-settings/update/', views.api_export_settings_update, name='api_export_settings_update'),

    # Export Template APIs
    path('api/export-templates/', views.api_export_templates_list, name='api_export_templates_list'),
    path('api/export-templates/import-doc/', views.api_export_template_import_doc, name='api_export_template_import_doc'),
    path('api/export-templates/create/', views.api_export_template_create, name='api_export_template_create'),
    path('api/export-templates/<int:template_id>/update/', views.api_export_template_update, name='api_export_template_update'),
    path('api/export-templates/<int:template_id>/delete/', views.api_export_template_delete, name='api_export_template_delete'),

    # Activity Logs API
    path('api/activity-logs/', views.api_activity_logs, name='api_activity_logs'),
    path('api/activity-logs/clear/state/', views.api_activity_log_clear_state, name='api_activity_log_clear_state'),
    path('api/activity-logs/clear/generate-code/', views.api_activity_log_clear_generate_code, name='api_activity_log_clear_generate_code'),
    path('api/activity-logs/clear/', views.api_clear_activity_logs, name='api_clear_activity_logs'),

    # Pro User data deletion guard API
    path('api/pro-user/data-guard/clients/', views.api_pro_user_data_guard_clients, name='api_pro_user_data_guard_clients'),
    path('api/pro-user/data-guard/tables/', views.api_pro_user_data_guard_tables, name='api_pro_user_data_guard_tables'),
    path('api/pro-user/data-guard/preview/', views.api_pro_user_data_guard_preview, name='api_pro_user_data_guard_preview'),
    path('api/pro-user/data-guard/generate-code/', views.api_pro_user_data_guard_generate_code, name='api_pro_user_data_guard_generate_code'),
    path('api/pro-user/data-guard/delete/', views.api_pro_user_data_guard_delete, name='api_pro_user_data_guard_delete'),
    path('api/pro-user/super-mode/users/', views.api_pro_user_super_mode_users, name='api_pro_user_super_mode_users'),
    path('api/pro-user/super-mode/assign/', views.api_pro_user_super_mode_assign, name='api_pro_user_super_mode_assign'),
    path('api/pro-user/super-mode/self/', views.api_pro_user_super_mode_self, name='api_pro_user_super_mode_self'),
    path('api/pro-user/guest-users/', views.api_pro_user_guest_users, name='api_pro_user_guest_users'),
    path('api/pro-user/guest-users/clients/', views.api_pro_user_guest_source_clients, name='api_pro_user_guest_source_clients'),
    path('api/pro-user/guest-users/create/', views.api_pro_user_guest_user_create, name='api_pro_user_guest_user_create'),
    path('api/pro-user/guest-users/convert/', views.api_pro_user_guest_user_convert, name='api_pro_user_guest_user_convert'),
    path('api/pro-user/guest-users/restore/', views.api_pro_user_guest_user_restore, name='api_pro_user_guest_user_restore'),
    path('api/pro-user/sessions/revoke/', views.api_pro_user_revoke_sessions, name='api_pro_user_revoke_sessions'),
    path('api/pro-user/sessions/list/', views.api_pro_user_list_sessions, name='api_pro_user_list_sessions'),
    path('api/pro-user/sessions/revoke-single/', views.api_pro_user_revoke_session_key, name='api_pro_user_revoke_session_key'),

    # Settings/Profile APIs (for all user types)
    path('api/profile/', views.api_get_profile, name='api_get_profile'),
    path('api/profile/update/', views.api_update_profile, name='api_update_profile'),
    path('api/profile/change-password/', views.api_change_password, name='api_change_password'),
    path('api/profile/security-settings/update/', views.api_update_security_settings, name='api_update_security_settings'),
    path('api/profile/super-mode/toggle/', views.api_toggle_super_mode, name='api_toggle_super_mode'),
    path('api/profile/upload-image/', views.api_upload_profile_image, name='api_upload_profile_image'),
    path('api/profile/remove-image/', views.api_remove_profile_image, name='api_remove_profile_image'),

    # Health / Version
    path('api/health/', views.api_health, name='api_health'),

    # Allowed transitions for a card (any authenticated user)
    path('api/card/<int:card_id>/allowed-transitions/', views.api_card_allowed_transitions, name='api_card_allowed_transitions'),

    # Client-side error reporting (from error-monitor.js)
    path('api/client-errors/', views.api_client_errors, name='api_client_errors'),

    # Monitoring dashboard data (super_admin only)
    path('api/monitoring/', views.api_monitoring_data, name='api_monitoring_data'),
    path('api/operations-feed/', views.api_operations_feed, name='api_operations_feed'),
    path('api/server-info/', views.api_server_info_snapshot, name='api_server_info_snapshot'),
]

# Debug endpoints — only available when DEBUG=True
from django.conf import settings as _settings
if _settings.DEBUG:
    urlpatterns += [
        path('api/debug/permissions/', views.api_debug_permissions, name='api_debug_permissions'),
        path('api/debug/workflow-check/', views.api_debug_workflow, name='api_debug_workflow'),
        path('api/debug/image-integrity/', views.api_debug_image_integrity, name='api_debug_image_integrity'),
    ]
