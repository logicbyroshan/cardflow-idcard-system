# Views Package - Split for better organization and debugging
# Import all views from sub-modules to maintain backward compatibility

from .base import (
    get_user_role,
    super_admin_required,
    adarsh_cropper,
    dashboard,
    api_global_search,
    api_recent_client_updates,
    api_recent_activity,
    api_health,
    api_debug_permissions,
    api_debug_workflow,
    api_debug_image_integrity,
    api_card_allowed_transitions,
    manage_staff,
    manage_clients,
    active_clients,
    idcard_group,
    idcard_actions,
    group_settings,
    manage_website,
    manage_panel,
    settings,
    api_export_settings_get,
    api_export_settings_update,
    api_export_templates_list,
    api_export_template_create,
    api_export_template_update,
    api_export_template_delete,
)

from .auth import (
    login_view,
    logout_view,
    api_check_email,
    api_login,
    api_forgot_password,
    api_verify_otp,
    api_reset_password,
    admin_staff_dashboard,
    client_dashboard,
    client_staff_dashboard,
    inactive_view,
)

from .client_api import (
    api_client_create,
    api_client_get,
    api_client_update,
    api_client_delete,
    api_client_toggle_status,
    api_client_staff,
    api_client_staff_toggle_status,
    api_client_staff_permissions,
    api_client_set_temp_password,
)

from .staff_api import (
    api_staff_create,
    api_staff_get,
    api_staff_update,
    api_staff_delete,
    api_staff_toggle_status,
    api_active_clients_list,
    api_staff_set_temp_password,
)

from .idcard_api import (
    api_idcard_table_create,
    api_idcard_table_get,
    api_idcard_table_update,
    api_idcard_table_delete,
    api_idcard_table_toggle_status,
    api_idcard_table_list,
    api_create_table_from_xlsx,
    api_idcard_list,
    api_idcard_cards_json,
    api_idcard_create,
    api_idcard_get,
    api_idcard_update,
    api_idcard_update_field,
    api_idcard_delete,
    api_idcard_change_status,
    api_idcard_bulk_status,
    api_idcard_bulk_delete,
    api_generate_delete_code,
    api_generate_upgrade_code,
    api_upgrade_all_classes,
    api_idcard_search,
    api_idcard_all_ids,
    api_idcard_filter_options,
    api_table_status_counts,
    api_idcard_bulk_upload,
    api_idcard_reupload_images,
    api_idcard_modals_html,
)

from .settings_api import (
    api_get_profile,
    api_update_profile,
    api_change_password,
    api_upload_profile_image,
    api_remove_profile_image,
)

# NOTE: Reprint API views moved to 'reprintcard' app

from .task_api import (
    api_task_status,
    api_task_download,
    api_task_cancel,
    api_task_list,
    api_task_active,
    api_create_bulk_upload_task,
    api_create_reupload_task,
    api_create_export_task,
)

from .monitoring_api import (
    api_client_errors,
)

from .engine_api import (
    api_engine_status,
    api_engine_process_folder,
    api_engine_preview,
    api_engine_serve_image,
)

from .cropper_api import (
    api_cropper_release_webhook,
    api_cropper_latest_version,
)

from .notification_api import (
    api_notifications_list,
    api_notifications_unread_count,
    api_notification_mark_read,
    api_notifications_mark_all_read,
    api_panel_notifications_list,
    api_panel_notification_create,
    api_panel_notification_delete,
    api_panel_target_users,
)
