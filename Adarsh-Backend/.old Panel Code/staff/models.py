from django.db import models
from django.conf import settings
from client.models import Client


class Staff(models.Model):
    """
    Staff model - can be admin staff or client staff
    
    For admin_staff: assigned_clients controls which clients they can access
    For client_staff: client field controls which single client they belong to
                      assigned_groups controls which ID card groups they can manage
    
    NOTE: app_label='core' preserved for migration compatibility.
    Model code moved from core/models.py to staff/models.py
    """
    STAFF_TYPE_CHOICES = [
        ('admin_staff', 'Admin Staff'),
        ('client_staff', 'Client Staff'),
    ]
    
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='staff_profile')
    staff_type = models.CharField(max_length=20, choices=STAFF_TYPE_CHOICES, db_index=True)
    
    # For client_staff: single client they belong to
    client = models.ForeignKey(Client, on_delete=models.CASCADE, null=True, blank=True, related_name='staff_members')
    
    # For admin_staff: multiple clients they can operate on
    assigned_clients = models.ManyToManyField(Client, blank=True, related_name='assigned_admin_staff')
    
    # For client_staff: which ID card groups (classes/sections) they can manage
    # Empty means all groups accessible (backward compatible)
    assigned_groups = models.ManyToManyField(
        'core.IDCardGroup', blank=True, related_name='assigned_staff',
        help_text='ID Card groups this staff can manage. Empty = all groups.'
    )

    # Optional table-level scope for clients that keep all lists under one
    # default group. Empty means no table-level restriction.
    assigned_table_ids = models.JSONField(
        default=list,
        blank=True,
        help_text='Optional table IDs this staff can access. Empty = no table-level restriction.'
    )
    
    # For client_staff: class/section/branch filters (empty = all)
    allowed_classes = models.JSONField(
        default=list, blank=True,
        help_text='Allowed class values. Empty list = all classes.'
    )
    allowed_sections = models.JSONField(
        default=list, blank=True,
        help_text='Allowed section values. Empty list = all sections.'
    )
    allowed_branches = models.JSONField(
        default=list, blank=True,
        help_text='Allowed branch values (colleges). Empty list = all branches.'
    )

    # Per-assignment row filters scoped to a specific group/table selection.
    # Example item:
    # {"scope_type":"table","scope_id":12,"group_id":5,
    #  "classes":["I","II"],"sections":["A"],"branches":[]}
    assignment_scopes = models.JSONField(
        default=list,
        blank=True,
        help_text='Per-scope class/section/branch filters for client staff assignments.'
    )
    
    address = models.TextField(blank=True, null=True)
    department = models.CharField(max_length=100, blank=True, null=True)
    designation = models.CharField(max_length=100, blank=True, null=True)
    
    # ID Card Client List Permission
    perm_idcard_client_list = models.BooleanField(default=False)
    perm_manage_client_staff = models.BooleanField(default=False)
    
    # ID Card Setting Permissions
    perm_idcard_setting_list = models.BooleanField(default=False)
    perm_idcard_setting_add = models.BooleanField(default=False)
    perm_idcard_setting_edit = models.BooleanField(default=False)
    perm_idcard_setting_delete = models.BooleanField(default=False)
    perm_idcard_setting_status = models.BooleanField(default=False)
    
    
    # ID Card List Permissions
    perm_idcard_pending_list = models.BooleanField(default=False)
    perm_idcard_verified_list = models.BooleanField(default=False)
    perm_idcard_pool_list = models.BooleanField(default=False)
    perm_idcard_approved_list = models.BooleanField(default=False)
    perm_idcard_download_list = models.BooleanField(default=False)
    perm_idcard_reprint_list = models.BooleanField(default=False)
    perm_reprint_request_list = models.BooleanField(default=False)
    perm_confirmed_list = models.BooleanField(default=False)

    
    # ID Card Action Permissions (work in Pending and Verified lists only)
    perm_idcard_add = models.BooleanField(default=False)
    perm_idcard_edit = models.BooleanField(default=False)
    perm_idcard_delete = models.BooleanField(default=False)
    perm_idcard_info = models.BooleanField(default=False)
    perm_idcard_approve = models.BooleanField(default=False)
    perm_idcard_verify = models.BooleanField(default=False)
    perm_idcard_updated_at = models.BooleanField(default=False)
    perm_idcard_delete_from_pool = models.BooleanField(default=False)
    perm_reupload_idcard_image = models.BooleanField(default=False)  # Single card reupload
    perm_idcard_retrieve = models.BooleanField(default=False)
    
    # ID Card Bulk Action Permissions (work across all lists)
    perm_idcard_bulk_upload = models.BooleanField(default=False)
    perm_idcard_bulk_download = models.BooleanField(default=False)
    perm_idcard_download_image_rename_mode = models.BooleanField(default=False)
    perm_idcard_download_image_generate_mode = models.BooleanField(default=False)
    perm_idcard_bulk_reupload = models.BooleanField(default=False)  # Bulk reupload for all lists
    perm_idcard_upgrade_all = models.BooleanField(default=False)  # Upgrade All Class
    
    # Mobile App (PWA) Permission
    perm_mobile_app = models.BooleanField(default=False, help_text='Allow access to mobile PWA app')

    # Manage Panel Permissions (admin staff)
    perm_manage_panel_backup = models.BooleanField(default=False)
    perm_manage_panel_email = models.BooleanField(default=False)

    # Pro Features (for admin/superadmin users to use pro tools)
    perm_pro_user_options = models.BooleanField(default=False, help_text='Allow User Options (Impersonation/Login as User)')
    perm_pro_log_deletion_guard = models.BooleanField(default=False, help_text='Allow Log Deletion Guard')
    perm_pro_data_deletion_guard = models.BooleanField(default=False, help_text='Allow Data Deletion Guard')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.get_full_name()} - {self.get_staff_type_display()}"
    
    def can_access_client(self, client_id: int) -> bool:
        """Check if this admin staff can access a specific client."""
        if self.staff_type != 'admin_staff':
            return False
        return self.assigned_clients.filter(id=client_id).exists()
    
    def get_accessible_client_ids(self) -> list:
        """Get list of client IDs this admin staff can access."""
        if self.staff_type != 'admin_staff':
            return []
        return list(self.assigned_clients.values_list('id', flat=True))
    
    class Meta:
        app_label = 'core'  # Keep migration compatibility - model stays in core migrations
        verbose_name_plural = "Staff"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['staff_type', 'created_at']),
            models.Index(fields=['created_at']),
            models.Index(fields=['client', 'staff_type']),
            models.Index(fields=['client', 'staff_type', '-created_at'], name='staff_client_type_time_idx'),
        ]
