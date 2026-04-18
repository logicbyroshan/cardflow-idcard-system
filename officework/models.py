from django.db import models
from django.utils import timezone


def office_work_shared_file_upload_to(instance, filename):
    import os

    safe_name = os.path.basename(str(filename or '').strip()) or 'shared-file'
    return f'office-work/shared/{timezone.now():%Y/%m/%d}/{safe_name}'


class OfficeWorkChatMessage(models.Model):
    """Simple team chat stream for super_admin/admin_staff collaboration."""

    sender = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='office_work_chat_messages',
    )
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-id']
        db_table = 'core_officeworkchatmessage'
        indexes = [
            models.Index(fields=['-created_at'], name='owchat_created_idx'),
        ]
        verbose_name = 'Office Work Chat Message'
        verbose_name_plural = 'Office Work Chat Messages'

    def __str__(self):
        author = self.sender.get_full_name() if self.sender else 'Unknown'
        author = author or (self.sender.username if self.sender else 'Unknown')
        return f'OfficeChat<{author}: {self.message[:40]}>'


class OfficeWorkTask(models.Model):
    """Shared task tracker for office work planning and follow-up."""

    STATUS_TODO = 'todo'
    STATUS_IN_PROGRESS = 'in_progress'
    STATUS_DONE = 'done'

    STATUS_CHOICES = [
        (STATUS_TODO, 'Todo'),
        (STATUS_IN_PROGRESS, 'In Progress'),
        (STATUS_DONE, 'Done'),
    ]

    PRIORITY_LOW = 'low'
    PRIORITY_NORMAL = 'normal'
    PRIORITY_HIGH = 'high'

    PRIORITY_CHOICES = [
        (PRIORITY_LOW, 'Low'),
        (PRIORITY_NORMAL, 'Normal'),
        (PRIORITY_HIGH, 'High'),
    ]

    title = models.CharField(max_length=180)
    description = models.TextField(blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_TODO, db_index=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default=PRIORITY_NORMAL, db_index=True)
    created_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='office_work_tasks_created',
    )
    assigned_to = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='office_work_tasks_assigned',
    )
    due_date = models.DateField(null=True, blank=True, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at', '-id']
        db_table = 'core_officeworktask'
        indexes = [
            models.Index(fields=['status', '-updated_at'], name='owtask_status_updated_idx'),
            models.Index(fields=['assigned_to', 'status'], name='owtask_assigned_status_idx'),
        ]
        verbose_name = 'Office Work Task'
        verbose_name_plural = 'Office Work Tasks'

    def __str__(self):
        return f'OfficeTask<{self.id}:{self.title}>'


class OfficeWorkSharedFile(models.Model):
    """Files shared between admin and operator inside Office Work module."""

    uploaded_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='office_work_shared_files',
    )
    title = models.CharField(max_length=200, blank=True, default='')
    note = models.TextField(blank=True, default='')
    original_name = models.CharField(max_length=255, blank=True, default='')
    file = models.FileField(upload_to=office_work_shared_file_upload_to)
    size_bytes = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        db_table = 'core_officeworksharedfile'
        indexes = [
            models.Index(fields=['-created_at'], name='owfile_created_idx'),
        ]
        verbose_name = 'Office Work Shared File'
        verbose_name_plural = 'Office Work Shared Files'

    def __str__(self):
        return self.title or self.original_name or f'OfficeFile<{self.id}>'

    def save(self, *args, **kwargs):
        if self.file:
            self.original_name = self.original_name or self.file.name.rsplit('/', 1)[-1]
            try:
                self.size_bytes = int(getattr(self.file, 'size', 0) or 0)
            except Exception:
                self.size_bytes = 0
        super().save(*args, **kwargs)
