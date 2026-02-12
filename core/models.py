from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models

# Import Client from its new home (preserves backward compatibility)
from client.models import Client, generate_folder_code_from_name, generate_unique_suffix

# Import Staff from its new home (preserves backward compatibility)
from staff.models import Staff

# Import IDCard models from their new home (preserves backward compatibility)
from workflows.models import IDCardGroup, IDCardTable, IDCard, ReprintRequest


class CustomUserManager(UserManager):
    """
    Custom user manager that ensures superuser and super_admin role are synchronized.
    """
    
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        """
        Create a superuser with role='super_admin' automatically.
        """
        extra_fields.setdefault('role', 'super_admin')
        return super().create_superuser(username, email, password, **extra_fields)


class User(AbstractUser):
    """
    Custom user model with role support
    
    NOTE: This model remains in core for database/migration compatibility.
    Views and business logic have been moved to apps.accounts.
    
    IMPORTANT: superuser (is_superuser=True) and super_admin (role='super_admin')
    are now synchronized. Setting one will automatically set the other.
    """
    ROLE_CHOICES = [
        ('super_admin', 'Super Admin'),
        ('admin_staff', 'Admin Staff'),
        ('client', 'Client'),
        ('client_staff', 'Client Staff'),
    ]
    
    phone = models.CharField(max_length=15, blank=True, null=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='client', db_index=True)
    # DEPRECATED: profile_image removed - use frontend placeholder avatars instead
    # profile_image field removed in Phase 1 refactor
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    objects = CustomUserManager()

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"
    
    def save(self, *args, **kwargs):
        """
        Override save to synchronize is_superuser and role='super_admin'.
        - If is_superuser=True, set role to 'super_admin'
        - If role='super_admin', set is_superuser=True
        """
        if self.is_superuser:
            self.role = 'super_admin'
        elif self.role == 'super_admin':
            self.is_superuser = True
            self.is_staff = True  # Superusers should have staff access
        super().save(*args, **kwargs)
    
    @property
    def is_super_admin(self):
        """
        Check if user is super admin.
        Since superuser and super_admin are now synchronized, this will
        always return the same as is_superuser or role=='super_admin'.
        """
        return self.is_superuser or self.role == 'super_admin'
    
    @property
    def is_admin_staff(self):
        return self.role == 'admin_staff'
    
    @property
    def is_client(self):
        return self.role == 'client'
    
    @property
    def is_client_staff(self):
        return self.role == 'client_staff'


class WebsiteSettings(models.Model):
    """
    Website/CMS Settings
    """
    site_name = models.CharField(max_length=200, default='Adarsh ID Cards')
    site_logo = models.ImageField(upload_to='site/', blank=True, null=True)
    site_favicon = models.ImageField(upload_to='site/', blank=True, null=True)
    contact_email = models.EmailField(blank=True, null=True)
    contact_phone = models.CharField(max_length=15, blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    about_text = models.TextField(blank=True, null=True)
    facebook_url = models.URLField(blank=True, null=True)
    twitter_url = models.URLField(blank=True, null=True)
    instagram_url = models.URLField(blank=True, null=True)
    linkedin_url = models.URLField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.site_name
    
    class Meta:
        verbose_name = "Website Settings"
        verbose_name_plural = "Website Settings"


class SystemSettings(models.Model):
    """
    System/Application Settings
    """
    key = models.CharField(max_length=100, unique=True)
    value = models.TextField()
    description = models.CharField(max_length=255, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Default export footer messages
    EXPORT_DEFAULTS = {
        'export_note_line': 'Note: This document is computer generated. Please verify all details before printing ID cards.',
        'export_copyright_line': '© Adarsh ID Cards Management System - All Rights Reserved',
    }

    def __str__(self):
        return self.key

    class Meta:
        verbose_name = "System Setting"
        verbose_name_plural = "System Settings"

    @classmethod
    def get_value(cls, key, default=None):
        """Get a setting value by key, returning default if not found."""
        try:
            return cls.objects.get(key=key).value
        except cls.DoesNotExist:
            if default is None:
                return cls.EXPORT_DEFAULTS.get(key, '')
            return default

    @classmethod
    def set_value(cls, key, value, description=None):
        """Set a setting value, creating or updating."""
        obj, created = cls.objects.update_or_create(
            key=key,
            defaults={'value': value}
        )
        if description and (created or not obj.description):
            obj.description = description
            obj.save(update_fields=['description'])
        return obj

    @classmethod
    def get_export_settings(cls):
        """Return dict of all export-related settings."""
        keys = list(cls.EXPORT_DEFAULTS.keys())
        db_settings = {s.key: s.value for s in cls.objects.filter(key__in=keys)}
        return {key: db_settings.get(key, default_val) for key, default_val in cls.EXPORT_DEFAULTS.items()}


class ActivityLog(models.Model):
    """
    Tracks user activity across the system for the dashboard activity feed.
    Designed for lightweight, append-only logging of key actions.
    """

    # Action type choices grouped by category
    ACTION_CHOICES = [
        # Auth
        ('login', 'Logged in'),
        ('logout', 'Logged out'),
        # Client management
        ('client_create', 'Client created'),
        ('client_update', 'Client updated'),
        ('client_delete', 'Client deleted'),
        ('client_status', 'Client status changed'),
        # Staff management
        ('staff_create', 'Staff created'),
        ('staff_update', 'Staff updated'),
        ('staff_delete', 'Staff deleted'),
        ('staff_status', 'Staff status changed'),
        # ID Card operations
        ('card_create', 'ID cards added'),
        ('card_update', 'ID card updated'),
        ('card_delete', 'ID card deleted'),
        ('card_status', 'Card status changed'),
        ('card_bulk_status', 'Bulk card status change'),
        ('card_bulk_upload', 'Bulk card upload'),
        ('card_bulk_download', 'Bulk card download'),
        # Image operations
        ('image_upload', 'Images uploaded'),
        ('image_reupload', 'Images re-uploaded'),
        # ID Card group/table
        ('group_create', 'Group created'),
        ('group_update', 'Group updated'),
        ('group_delete', 'Group deleted'),
        ('table_create', 'Table created'),
        ('table_update', 'Table updated'),
        ('table_delete', 'Table deleted'),
        # Bulk operations
        ('bulk_delete', 'Bulk delete'),
        ('bulk_upgrade', 'Bulk upgrade'),
        # Website content
        ('website_update', 'Website content updated'),
        # Reprint
        ('reprint_request', 'Reprint requested'),
        ('reprint_status', 'Reprint status changed'),
        # Settings
        ('settings_update', 'Settings updated'),
        # Other
        ('other', 'Other action'),
    ]

    # Icon mapping for action types (used in templates)
    ACTION_ICONS = {
        'login': ('fa-right-to-bracket', 'verify'),
        'logout': ('fa-right-from-bracket', 'edit'),
        'client_create': ('fa-user-plus', 'add'),
        'client_update': ('fa-user-pen', 'edit'),
        'client_delete': ('fa-user-minus', 'delete'),
        'client_status': ('fa-user-check', 'verify'),
        'staff_create': ('fa-user-plus', 'add'),
        'staff_update': ('fa-user-pen', 'edit'),
        'staff_delete': ('fa-user-minus', 'delete'),
        'staff_status': ('fa-user-check', 'verify'),
        'card_create': ('fa-plus', 'add'),
        'card_update': ('fa-pen', 'edit'),
        'card_delete': ('fa-trash', 'delete'),
        'card_status': ('fa-check', 'verify'),
        'card_bulk_status': ('fa-check-double', 'approve'),
        'card_bulk_upload': ('fa-upload', 'add'),
        'card_bulk_download': ('fa-download', 'approve'),
        'image_upload': ('fa-image', 'add'),
        'image_reupload': ('fa-images', 'edit'),
        'group_create': ('fa-folder-plus', 'add'),
        'group_update': ('fa-folder-open', 'edit'),
        'group_delete': ('fa-folder-minus', 'delete'),
        'table_create': ('fa-table', 'add'),
        'table_update': ('fa-table', 'edit'),
        'table_delete': ('fa-table', 'delete'),
        'bulk_delete': ('fa-trash-can', 'delete'),
        'bulk_upgrade': ('fa-arrow-up', 'approve'),
        'website_update': ('fa-globe', 'edit'),
        'reprint_request': ('fa-print', 'add'),
        'reprint_status': ('fa-print', 'verify'),
        'settings_update': ('fa-gear', 'edit'),
        'other': ('fa-circle-info', 'edit'),
    }

    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='activity_logs',
        db_index=True,
    )
    action = models.CharField(max_length=30, choices=ACTION_CHOICES, db_index=True)
    description = models.CharField(max_length=500)
    target_model = models.CharField(max_length=50, blank=True, default='')
    target_id = models.PositiveIntegerField(null=True, blank=True)
    target_name = models.CharField(max_length=200, blank=True, default='')
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = 'Activity Log'
        verbose_name_plural = 'Activity Logs'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at', 'action'], name='actlog_time_action_idx'),
        ]

    def __str__(self):
        actor = self.user.get_full_name() or self.user.username if self.user else 'System'
        return f"{actor} — {self.description}"

    @property
    def icon_class(self):
        """Returns FA icon class for this action type."""
        return self.ACTION_ICONS.get(self.action, ('fa-circle-info', 'edit'))[0]

    @property
    def icon_color(self):
        """Returns CSS class (add/edit/delete/verify/approve) for this action type."""
        return self.ACTION_ICONS.get(self.action, ('fa-circle-info', 'edit'))[1]
