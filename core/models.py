from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models

# Import Client from its new home (preserves backward compatibility)
from client.models import Client, generate_folder_code_from_name, generate_unique_suffix

# Import Staff from its new home (preserves backward compatibility)
from staff.models import Staff

# Import IDCard models from their new home (preserves backward compatibility)
from workflows.models import IDCardGroup, IDCardTable, IDCard


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
        Both directions are enforced:
        - is_superuser=True  ↔  role='super_admin'
        - role='super_admin'  →  is_superuser=True, is_staff=True
        - role != 'super_admin' AND was previously super_admin  →  clear is_superuser
        """
        if self.is_superuser:
            self.role = 'super_admin'
            self.is_staff = True
        elif self.role == 'super_admin':
            self.is_superuser = True
            self.is_staff = True
        else:
            # Role is not super_admin — make sure is_superuser is cleared
            self.is_superuser = False
        super().save(*args, **kwargs)
    
    class Meta:
        indexes = [
            # email index is auto-created by unique=True constraint below
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['email'],
                name='unique_user_email',
            ),
        ]

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
        """Get a setting value by key, returning default if not found. Cached 5 min."""
        from django.core.cache import cache
        cache_key = f'sys_setting:{key}'
        value = cache.get(cache_key)
        if value is not None:
            return value
        try:
            value = cls.objects.get(key=key).value
            cache.set(cache_key, value, 300)
            return value
        except cls.DoesNotExist:
            fallback = default if default is not None else cls.EXPORT_DEFAULTS.get(key, '')
            return fallback

    @classmethod
    def set_value(cls, key, value, description=None):
        """Set a setting value, creating or updating. Invalidates cache."""
        from django.core.cache import cache
        obj, created = cls.objects.update_or_create(
            key=key,
            defaults={'value': value}
        )
        cache.delete(f'sys_setting:{key}')
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


class ExportTemplate(models.Model):
    """
    User-defined export templates with custom footer instructions.
    Admins create templates in Settings → Export Templates, then choose
    one when downloading PDF or Word files.
    """
    name = models.CharField(max_length=100, unique=True, help_text='Template name shown in the download dropdown')
    instructions = models.TextField(
        help_text='Footer instructions printed at the bottom of PDF/Word exports'
    )
    is_default = models.BooleanField(default=False, help_text='Mark as default selection in download modals')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Export Template'
        verbose_name_plural = 'Export Templates'

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        # Ensure only one default template
        if self.is_default:
            ExportTemplate.objects.filter(is_default=True).exclude(pk=self.pk).update(is_default=False)
        super().save(*args, **kwargs)

    @classmethod
    def get_default(cls):
        """Return the default template or None."""
        return cls.objects.filter(is_default=True).first()

    @classmethod
    def get_all_as_choices(cls):
        """Return list of dicts for JSON serialisation."""
        templates = list(cls.objects.values('id', 'name', 'instructions', 'is_default'))
        return templates


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
            models.Index(fields=['user', '-created_at'], name='actlog_user_time_idx'),
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


# ============================================================================
# NOTIFICATION SYSTEM
# ============================================================================

class Notification(models.Model):
    """
    Notification model for sending messages to users.
    
    Supports:
    - Broadcast to all users / all of a role
    - Targeted to specific users
    - Priority levels and categories
    - Read/unread tracking per-user via NotificationRead
    """
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('normal', 'Normal'),
        ('high', 'High'),
        ('urgent', 'Urgent'),
    ]
    CATEGORY_CHOICES = [
        ('general', 'General'),
        ('announcement', 'Announcement'),
        ('update', 'System Update'),
        ('maintenance', 'Maintenance'),
        ('alert', 'Alert'),
    ]
    TARGET_CHOICES = [
        ('all', 'All Users'),
        ('super_admin', 'Super Admins'),
        ('admin_staff', 'Admin Staff'),
        ('client', 'Clients'),
        ('client_staff', 'Client Staff'),
        ('selected', 'Selected Users'),
    ]
    CATEGORY_ICONS = {
        'general': 'fa-circle-info',
        'announcement': 'fa-bullhorn',
        'update': 'fa-arrow-up-right-dots',
        'maintenance': 'fa-wrench',
        'alert': 'fa-triangle-exclamation',
    }
    PRIORITY_COLORS = {
        'low': '#94a3b8',
        'normal': '#667eea',
        'high': '#f59e0b',
        'urgent': '#ef4444',
    }

    title = models.CharField(max_length=200)
    message = models.TextField()
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='normal', db_index=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='general', db_index=True)
    target = models.CharField(max_length=20, choices=TARGET_CHOICES, default='all')

    # For target='selected', track which users were selected
    target_users = models.ManyToManyField(User, blank=True, related_name='targeted_notifications')

    # Sender
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='sent_notifications')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    # Optional: schedule or expiry
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at', 'target'], name='notif_time_target_idx'),
            models.Index(fields=['is_active', '-created_at'], name='notif_active_time_idx'),
        ]

    def __str__(self):
        return f"[{self.get_priority_display()}] {self.title}"

    @property
    def icon_class(self):
        return self.CATEGORY_ICONS.get(self.category, 'fa-circle-info')

    @property
    def priority_color(self):
        return self.PRIORITY_COLORS.get(self.priority, '#667eea')


class NotificationRead(models.Model):
    """
    Tracks which users have read which notifications.
    One row per (user, notification) pair.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notification_reads')
    notification = models.ForeignKey(Notification, on_delete=models.CASCADE, related_name='reads')
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'notification')
        indexes = [
            models.Index(fields=['user', '-read_at'], name='notifread_user_time_idx'),
        ]

    def __str__(self):
        return f"{self.user} read {self.notification}"


class BackgroundTask(models.Model):
    """
    Tracks background tasks for async processing.
    
    CRITICAL: Only ONE heavy task per user at a time to prevent RAM exhaustion.
    """
    TASK_TYPES = [
        ("bulk_upload", "Bulk Upload"),
        ("reupload_images", "Reupload Images"),
        ("export_zip", "Export Zip"),
        ("export_pdf", "Export PDF"),
        ("export_docx", "Export DOCX"),
        ("export_excel", "Export Excel"),
    ]
    
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("processing", "Processing"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]
    
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='background_tasks'
    )
    task_type = models.CharField(max_length=30, choices=TASK_TYPES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending", db_index=True)
    
    # Progress tracking
    progress = models.IntegerField(default=0)
    total = models.IntegerField(default=0)
    
    # File paths (relative to MEDIA_ROOT)
    file_path = models.CharField(max_length=500, blank=True, null=True)  # Input file
    result_path = models.CharField(max_length=500, blank=True, null=True)  # Output file
    
    # Additional metadata stored as JSON
    metadata = models.JSONField(default=dict, blank=True)
    
    # Error message if failed
    error_message = models.TextField(blank=True, null=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    started_at = models.DateTimeField(blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['task_type', 'status']),
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['status', '-created_at']),
            models.Index(fields=['created_at']),
            models.Index(fields=['completed_at']),
        ]
    
    def __str__(self):
        return f"{self.get_task_type_display()} - {self.get_status_display()} ({self.progress}/{self.total})"
    
    @property
    def progress_percentage(self):
        """Get progress as percentage (0-100)"""
        if self.total <= 0:
            return 0
        return min(100, int((self.progress / self.total) * 100))
    
    @property
    def is_active(self):
        """Check if task is currently running"""
        return self.status in ("pending", "processing")
    
    @property
    def is_done(self):
        """Check if task has finished (completed, failed, or cancelled)"""
        return self.status in ("completed", "failed", "cancelled")
    
    def cleanup_files(self):
        """
        Remove temporary files associated with this task.
        Call this after task completion or on failure.
        
        Cleans up:
        - Main input file (file_path)
        - Field-specific ZIP files (metadata['zip_paths'])
        - Unified ZIP files (metadata['unified_zip_paths'])
        """
        import os
        import logging
        from django.conf import settings
        
        logger = logging.getLogger(__name__)
        
        def safe_delete(file_path):
            """Safely delete a file by relative or absolute path."""
            if not file_path:
                return
            try:
                # Convert relative path to absolute if needed
                if not os.path.isabs(file_path):
                    full_path = os.path.join(settings.MEDIA_ROOT, file_path)
                else:
                    full_path = file_path
                
                if os.path.exists(full_path):
                    os.remove(full_path)
                    logger.info("Cleaned up file: %s", file_path)
            except Exception as e:
                logger.warning("Failed to cleanup file %s: %s", file_path, e)
        
        # Cleanup main input file
        if self.file_path:
            safe_delete(self.file_path)
        
        # Cleanup ZIP files from metadata
        metadata = self.metadata or {}
        
        # Field-specific ZIPs: {'field_name': 'relative/path.zip', ...}
        zip_paths = metadata.get('zip_paths', {})
        for field_name, zip_path in zip_paths.items():
            safe_delete(zip_path)
        
        # Unified ZIPs: ['relative/path1.zip', 'relative/path2.zip', ...]
        unified_zip_paths = metadata.get('unified_zip_paths', [])
        for zip_path in unified_zip_paths:
            safe_delete(zip_path)
    
    def mark_started(self):
        """Mark task as started processing.
        Uses atomic conditional update to prevent double-start races.
        """
        from django.utils import timezone
        from django.db import transaction
        with transaction.atomic():
            updated = type(self).objects.filter(
                pk=self.pk, status='pending'
            ).update(status='processing', started_at=timezone.now())
            if updated == 0:
                raise RuntimeError(
                    f'Task {self.pk} is no longer pending (current status may have changed)'
                )
        self.refresh_from_db(fields=['status', 'started_at'])
    
    def mark_completed(self, result_path=None):
        """Mark task as successfully completed"""
        from django.utils import timezone
        self.status = "completed"
        self.completed_at = timezone.now()
        if result_path:
            self.result_path = result_path
        self.save(update_fields=["status", "completed_at", "result_path", "updated_at"])
    
    def mark_failed(self, error_message):
        """Mark task as failed with error message"""
        from django.utils import timezone
        self.status = "failed"
        self.error_message = str(error_message)[:2000]  # Truncate long errors
        self.completed_at = timezone.now()
        self.save(update_fields=["status", "error_message", "completed_at", "updated_at"])
        self.cleanup_files()
    
    def update_progress(self, progress, total=None):
        """Update progress counter efficiently"""
        update_fields = ["progress", "updated_at"]
        self.progress = progress
        if total is not None:
            self.total = total
            update_fields.append("total")
        self.save(update_fields=update_fields)
    
    @classmethod
    def has_active_task(cls, user, task_type=None):
        """
        Check if user has an active (pending/processing) task.
        Used to prevent multiple concurrent heavy operations.
        
        Args:
            user: User instance
            task_type: Optional task type to filter by
            
        Returns:
            BackgroundTask instance if active task exists, None otherwise
        """
        qs = cls.objects.filter(user=user, status__in=["pending", "processing"])
        if task_type:
            qs = qs.filter(task_type=task_type)
        return qs.first()
    
    @classmethod
    def create_if_no_active(cls, user, task_type, **kwargs):
        """
        Atomically create a task only if user has no active tasks
        AND the system-wide queue is not full.
        
        Args:
            user: User instance
            task_type: Task type string
            **kwargs: Additional fields for BackgroundTask
            
        Returns:
            tuple: (task, error_message) - task is None if creation failed
        """
        from django.db import transaction
        
        MAX_QUEUED_TASKS = 10  # system-wide limit
        
        with transaction.atomic():
            # Lock the user's active tasks for update
            active = cls.objects.select_for_update().filter(
                user=user,
                status__in=["pending", "processing"]
            ).first()
            
            if active:
                return None, f"You already have an active task ({active.get_task_type_display()}). Please wait for it to complete."
            
            # Check system-wide queue depth
            pending_count = cls.objects.filter(
                status__in=["pending", "processing"]
            ).count()
            if pending_count >= MAX_QUEUED_TASKS:
                return None, f"System is busy ({pending_count} tasks queued). Please try again later."
            
            # Safe to create new task
            task = cls.objects.create(
                user=user,
                task_type=task_type,
                status='pending',
                **kwargs
            )
            return task, None
    
    @classmethod
    def cleanup_stale_tasks(cls, hours=24):
        """
        Mark stale tasks (stuck in processing for too long) as failed.
        Should be called periodically (e.g., on server startup).
        
        Args:
            hours: Number of hours after which a processing task is considered stale
        """
        import logging
        from django.utils import timezone
        from datetime import timedelta
        
        logger = logging.getLogger(__name__)
        stale_threshold = timezone.now() - timedelta(hours=hours)
        stale_tasks = cls.objects.filter(
            status="processing",
            started_at__lt=stale_threshold
        )
        
        count = 0
        for task in stale_tasks:
            task.mark_failed(f"Task timed out after {hours} hours")
            count += 1
        
        if count:
            logger.info("Cleaned up %d stale background tasks", count)
        
        return count
    
    @classmethod
    def cleanup_old_results(cls, days=7):
        """
        Delete old completed task records and their result files.
        Should be called periodically.
        
        Args:
            days: Number of days to keep completed tasks
        """
        import logging
        from django.utils import timezone
        from datetime import timedelta
        from django.core.files.storage import default_storage
        
        logger = logging.getLogger(__name__)
        old_threshold = timezone.now() - timedelta(days=days)
        old_tasks = cls.objects.filter(
            status__in=["completed", "failed", "cancelled"],
            completed_at__lt=old_threshold
        )
        
        count = 0
        for task in old_tasks:
            # Clean up result file if exists
            if task.result_path:
                try:
                    if default_storage.exists(task.result_path):
                        default_storage.delete(task.result_path)
                except Exception as e:
                    logger.warning("Failed to cleanup result file %s: %s", task.result_path, e)
            
            task.delete()
            count += 1
        
        if count:
            logger.info("Cleaned up %d old background task records", count)
        
        return count


# ═══════════════════════════════════════════════════════════════════════════
#  Cropper Auto-Update — Tracks published Face Cropper releases
# ═══════════════════════════════════════════════════════════════════════════

class CropperRelease(models.Model):
    """
    Stores metadata about each published Adarsh Cropper build.

    Created automatically by the GitHub Actions CI/CD workflow via
    the ``/api/cropper/release-webhook/`` endpoint after a successful
    build & upload of the installer EXE.

    The admin panel's Cropper page compares the installed engine version
    against the latest release stored here to show an "Update Available"
    banner with a download link.
    """

    version = models.CharField(
        max_length=30,
        unique=True,
        help_text='Semantic version string, e.g. "3.0.1"',
    )
    download_url = models.URLField(
        max_length=500,
        help_text="Direct URL to the installer EXE (GitHub Release asset or self-hosted).",
    )
    changelog = models.TextField(
        blank=True,
        default="",
        help_text="Human-readable changelog / release notes (Markdown OK).",
    )
    is_latest = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Only one release should be marked as latest at a time.",
    )
    released_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-released_at"]
        verbose_name = "Cropper Release"
        verbose_name_plural = "Cropper Releases"

    def __str__(self):
        tag = " [latest]" if self.is_latest else ""
        return f"Adarsh Cropper v{self.version}{tag}"

    def save(self, *args, **kwargs):
        """Ensure only ONE release is marked ``is_latest`` at any time."""
        if self.is_latest:
            CropperRelease.objects.filter(is_latest=True).exclude(pk=self.pk).update(is_latest=False)
        super().save(*args, **kwargs)