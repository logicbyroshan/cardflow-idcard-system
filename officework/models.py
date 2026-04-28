from django.db import models
from django.utils import timezone


def office_work_chat_attachment_upload_to(instance, filename):
    import os

    safe_name = os.path.basename(str(filename or '').strip()) or 'chat-file'
    group_id = getattr(instance, 'group_id', None) or 'general'
    return f'office-work/chat/{group_id}/{timezone.now():%Y/%m/%d}/{safe_name}'


def office_work_task_comment_attachment_upload_to(instance, filename):
    import os

    safe_name = os.path.basename(str(filename or '').strip()) or 'task-comment-file'
    task_id = getattr(instance, 'task_id', None) or 'task'
    return f'office-work/tasks/{task_id}/{timezone.now():%Y/%m/%d}/{safe_name}'


class OfficeWorkChatGroup(models.Model):
    """Office Work chat group visible to selected members."""

    name = models.CharField(max_length=120)
    created_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='office_work_chat_groups_created',
    )
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name', 'id']
        db_table = 'core_officeworkchatgroup'
        indexes = [
            models.Index(fields=['is_active', 'name'], name='owchatgrp_active_name_idx'),
        ]
        verbose_name = 'Office Work Chat Group'
        verbose_name_plural = 'Office Work Chat Groups'

    def __str__(self):
        return self.name


class OfficeWorkChatGroupMember(models.Model):
    """Membership map for Office Work chat groups."""

    group = models.ForeignKey(
        OfficeWorkChatGroup,
        on_delete=models.CASCADE,
        related_name='memberships',
    )
    user = models.ForeignKey(
        'core.User',
        on_delete=models.CASCADE,
        related_name='office_work_chat_memberships',
    )
    added_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='office_work_chat_members_added',
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['id']
        db_table = 'core_officeworkchatgroupmember'
        constraints = [
            models.UniqueConstraint(fields=['group', 'user'], name='owchat_group_user_unique'),
        ]
        indexes = [
            models.Index(fields=['user', 'group'], name='owchatgm_user_group_idx'),
            models.Index(fields=['group', 'created_at'], name='owchatgm_group_created_idx'),
        ]
        verbose_name = 'Office Work Chat Group Member'
        verbose_name_plural = 'Office Work Chat Group Members'

    def __str__(self):
        return f'{self.user_id} in {self.group_id}'


class OfficeWorkChatMessage(models.Model):
    """Simple team chat stream for super_admin/admin_staff collaboration."""

    group = models.ForeignKey(
        OfficeWorkChatGroup,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='messages',
    )

    sender = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='office_work_chat_messages',
    )
    message = models.TextField()
    attachment = models.FileField(upload_to=office_work_chat_attachment_upload_to, null=True, blank=True)
    attachment_original_name = models.CharField(max_length=255, blank=True, default='')
    attachment_size_bytes = models.BigIntegerField(default=0)
    attachment_content_type = models.CharField(max_length=160, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-id']
        db_table = 'core_officeworkchatmessage'
        indexes = [
            models.Index(fields=['group', '-id'], name='owchat_group_id_idx'),
            models.Index(fields=['-created_at'], name='owchat_created_idx'),
        ]
        verbose_name = 'Office Work Chat Message'
        verbose_name_plural = 'Office Work Chat Messages'

    def __str__(self):
        author = self.sender.get_full_name() if self.sender else 'Unknown'
        author = author or (self.sender.username if self.sender else 'Unknown')
        return f'OfficeChat<{author}: {self.message[:40]}>'

    def save(self, *args, **kwargs):
        if self.attachment:
            self.attachment_original_name = self.attachment_original_name or self.attachment.name.rsplit('/', 1)[-1]
            try:
                self.attachment_size_bytes = int(getattr(self.attachment, 'size', 0) or 0)
            except Exception:
                self.attachment_size_bytes = 0
        super().save(*args, **kwargs)


class OfficeWorkTask(models.Model):
    """Shared task tracker for office work planning and follow-up."""

    STATUS_TODO = 'todo'
    STATUS_IN_PROGRESS = 'in_progress'
    STATUS_DONE = 'done'
    STATUS_PENDING = 'pending'

    STATUS_CHOICES = [
        (STATUS_TODO, 'Todo'),
        (STATUS_IN_PROGRESS, 'In Progress'),
        (STATUS_DONE, 'Done'),
        (STATUS_PENDING, 'Pending'),
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
    collaborator_ids = models.JSONField(default=list, blank=True)
    follower_ids = models.JSONField(default=list, blank=True)
    checklist_items = models.JSONField(default=list, blank=True)
    due_date = models.DateField(null=True, blank=True, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    completion_requested_at = models.DateTimeField(null=True, blank=True)
    completion_requested_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='office_work_tasks_completion_requested',
    )
    completion_approved_at = models.DateTimeField(null=True, blank=True)
    completion_approved_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='office_work_tasks_completion_approved',
    )
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


class OfficeWorkTaskComment(models.Model):
    """Discussion stream for a task card, including optional attachments."""

    task = models.ForeignKey(
        OfficeWorkTask,
        on_delete=models.CASCADE,
        related_name='comments',
    )
    sender = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='office_work_task_comments',
    )
    message = models.TextField(blank=True, default='')
    attachment = models.FileField(upload_to=office_work_task_comment_attachment_upload_to, null=True, blank=True)
    attachment_original_name = models.CharField(max_length=255, blank=True, default='')
    attachment_size_bytes = models.BigIntegerField(default=0)
    attachment_content_type = models.CharField(max_length=160, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['id']
        db_table = 'core_officeworktaskcomment'
        indexes = [
            models.Index(fields=['task', 'id'], name='owtaskcomment_task_id_idx'),
            models.Index(fields=['-created_at'], name='owtaskcomment_created_idx'),
        ]
        verbose_name = 'Office Work Task Comment'
        verbose_name_plural = 'Office Work Task Comments'

    def __str__(self):
        author = self.sender.get_full_name() if self.sender else 'Unknown'
        author = author or (self.sender.username if self.sender else 'Unknown')
        return f'OfficeTaskComment<{author}: {self.message[:40]}>'

    def save(self, *args, **kwargs):
        if self.attachment:
            self.attachment_original_name = self.attachment_original_name or self.attachment.name.rsplit('/', 1)[-1]
            try:
                self.attachment_size_bytes = int(getattr(self.attachment, 'size', 0) or 0)
            except Exception:
                self.attachment_size_bytes = 0
        super().save(*args, **kwargs)
