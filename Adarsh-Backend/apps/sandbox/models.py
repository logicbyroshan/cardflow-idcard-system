"""
Sandbox Models — Phase 12

Overlay architecture:
  Real Data × Sandbox Diffs = Rendered Sandbox View

No production data is ever mutated by sandbox operations.
"""
import uuid
from django.db import models
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone
from apps.sandbox.constants import SESSION_TTL_DAYS


# ──────────────────────────────────────────────────
# Session
# ──────────────────────────────────────────────────

class SandboxSession(models.Model):
    """One sandbox per (user, device). Changes are isolated per session."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey('users.User', on_delete=models.CASCADE, related_name='sandbox_sessions')
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE, related_name='sandbox_sessions')
    device_id = models.CharField(max_length=255)  # client-supplied device fingerprint
    token = models.UUIDField(default=uuid.uuid4, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_activity_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'sandbox_session'
        unique_together = [('user', 'device_id')]
        indexes = [
            models.Index(fields=['user', 'device_id']),
            models.Index(fields=['token']),
            models.Index(fields=['expires_at']),
            models.Index(fields=['is_active']),
        ]

    def save(self, *args, **kwargs):
        if not self.expires_at:
            self.expires_at = timezone.now() + timezone.timedelta(days=SESSION_TTL_DAYS)
        super().save(*args, **kwargs)

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at

    def touch(self):
        self.last_activity_at = timezone.now()
        self.save(update_fields=['last_activity_at'])


# ──────────────────────────────────────────────────
# Field-level diffs on existing cards
# ──────────────────────────────────────────────────

class SandboxChange(models.Model):
    """
    Records a field-level edit made to an existing production card inside a sandbox session.
    Only the latest change per (session, card, field) is ever needed for rendering.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(SandboxSession, on_delete=models.CASCADE, related_name='changes')
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE)
    card = models.ForeignKey('cards.Card', on_delete=models.CASCADE, related_name='sandbox_changes')
    field = models.ForeignKey('fields.Field', on_delete=models.CASCADE)
    old_value = models.TextField(null=True, blank=True)
    new_value = models.TextField(null=True, blank=True)
    user = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sandbox_change'
        # One row per (session, card, field) — upserted on every edit
        unique_together = [('session', 'card', 'field')]
        indexes = [
            models.Index(fields=['session', 'card']),
            models.Index(fields=['session', 'table']),
            models.Index(fields=['timestamp']),
        ]


# ──────────────────────────────────────────────────
# Virtual card creation / deletion
# ──────────────────────────────────────────────────

class SandboxCardCreate(models.Model):
    """
    A card that exists ONLY inside a sandbox session.
    Never written to the production cards table.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(SandboxSession, on_delete=models.CASCADE, related_name='created_cards')
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE)
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE)
    display_id = models.CharField(max_length=100)
    data = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    status = models.CharField(max_length=50, default='PENDING')
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sandbox_card_create'
        indexes = [
            models.Index(fields=['session', 'table']),
        ]


class SandboxCardDelete(models.Model):
    """
    Marks a production card as deleted inside a sandbox session.
    The real card is untouched.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(SandboxSession, on_delete=models.CASCADE, related_name='deleted_cards')
    card = models.ForeignKey('cards.Card', on_delete=models.CASCADE, related_name='sandbox_deletes')
    user = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sandbox_card_delete'
        unique_together = [('session', 'card')]
        indexes = [
            models.Index(fields=['session']),
        ]


# ──────────────────────────────────────────────────
# Sandbox workflow
# ──────────────────────────────────────────────────

class SandboxWorkflowHistory(models.Model):
    """Sandbox-only workflow state changes. Production card statuses never change."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(SandboxSession, on_delete=models.CASCADE, related_name='workflow_history')
    # card may be a real card (FK) or a sandbox-only card (sandbox_card)
    card = models.ForeignKey('cards.Card', on_delete=models.CASCADE, null=True, blank=True,
                             related_name='sandbox_workflow_history')
    sandbox_card = models.ForeignKey(SandboxCardCreate, on_delete=models.CASCADE, null=True, blank=True,
                                     related_name='workflow_history')
    old_status = models.CharField(max_length=50)
    new_status = models.CharField(max_length=50)
    action = models.CharField(max_length=50)
    user = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    reason = models.TextField(blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sandbox_workflow_history'
        indexes = [
            models.Index(fields=['session', 'card']),
            models.Index(fields=['session', 'sandbox_card']),
        ]


# ──────────────────────────────────────────────────
# Sandbox-only workflow status overrides
# (latest status per session+card, separate from history)
# ──────────────────────────────────────────────────

class SandboxCardStatus(models.Model):
    """Tracks current sandbox workflow status for a real card."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(SandboxSession, on_delete=models.CASCADE, related_name='card_statuses')
    card = models.ForeignKey('cards.Card', on_delete=models.CASCADE, related_name='sandbox_statuses')
    status = models.CharField(max_length=50)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'sandbox_card_status'
        unique_together = [('session', 'card')]
        indexes = [
            models.Index(fields=['session']),
        ]


# ──────────────────────────────────────────────────
# Sandbox Imports
# ──────────────────────────────────────────────────

class SandboxImportSession(models.Model):
    """Import session that creates sandbox-only cards (SandboxCardCreate rows)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sandbox_session = models.ForeignKey(SandboxSession, on_delete=models.CASCADE, related_name='import_sessions')
    user = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE)
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE)
    status = models.CharField(max_length=50, default='PENDING')
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    total_rows = models.IntegerField(default=0)
    success_rows = models.IntegerField(default=0)
    warning_rows = models.IntegerField(default=0)
    failed_rows = models.IntegerField(default=0)
    duration = models.FloatField(null=True, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sandbox_import_session'
        indexes = [
            models.Index(fields=['sandbox_session']),
            models.Index(fields=['table']),
        ]


# ──────────────────────────────────────────────────
# Sandbox Exports
# ──────────────────────────────────────────────────

class SandboxExportSession(models.Model):
    """Export session that reads from the sandbox-merged view."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sandbox_session = models.ForeignKey(SandboxSession, on_delete=models.CASCADE, related_name='export_sessions')
    user = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE)
    table = models.ForeignKey('tables.Table', on_delete=models.CASCADE)
    export_type = models.CharField(max_length=20)
    status = models.CharField(max_length=50, default='PENDING')
    options = models.JSONField(default=dict, blank=True)
    file_name = models.CharField(max_length=255, blank=True)
    stored_path = models.CharField(max_length=500, blank=True)
    file_size = models.BigIntegerField(default=0)
    record_count = models.IntegerField(default=0)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    duration = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sandbox_export_session'
        indexes = [
            models.Index(fields=['sandbox_session']),
            models.Index(fields=['table']),
        ]
