"""
Pro User Platform Models — Phase 13

Covers: Impersonation, Client Activation, Maintenance, Announcements,
        Feature Flags, Statistics Snapshots, Backups.
"""
import uuid
from django.db import models
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone
from apps.pro.constants import (
    MaintenanceScope, AnnouncementTarget as AT,
    FeatureFlagKey, BackupScope, BackupStatus,
)


# ──────────────────────────────────────────────────
# Impersonation
# ──────────────────────────────────────────────────

class ImpersonationSession(models.Model):
    """
    Tracks an active or completed impersonation by PRO_USER.
    One active session per (pro_user, target_user) at a time.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pro_user = models.ForeignKey(
        'users.User', on_delete=models.CASCADE,
        related_name='impersonation_sessions_started'
    )
    target_user = models.ForeignKey(
        'users.User', on_delete=models.CASCADE,
        related_name='impersonation_sessions_received'
    )
    reason = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'pro_impersonation_session'
        indexes = [
            models.Index(fields=['pro_user', 'is_active']),
            models.Index(fields=['target_user']),
            models.Index(fields=['started_at']),
        ]


class ImpersonationAudit(models.Model):
    """Append-only audit trail for every impersonation event."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(ImpersonationSession, on_delete=models.CASCADE, related_name='audit_events')
    event_type = models.CharField(max_length=50)   # START / END / ACTION
    detail = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pro_impersonation_audit'
        ordering = ['timestamp']


# ──────────────────────────────────────────────────
# Maintenance Mode
# ──────────────────────────────────────────────────

class MaintenanceMode(models.Model):
    """
    Global or per-client maintenance window.
    PRO_USER always bypasses maintenance checks.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scope = models.CharField(
        max_length=20,
        choices=[(MaintenanceScope.GLOBAL, 'Global'), (MaintenanceScope.PER_CLIENT, 'Per Client')],
        default=MaintenanceScope.GLOBAL,
    )
    # For PER_CLIENT scope — which client organization is affected
    target_organization = models.ForeignKey(
        'organizations.Organization', on_delete=models.CASCADE,
        null=True, blank=True, related_name='maintenance_modes'
    )
    message = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'pro_maintenance_mode'
        indexes = [
            models.Index(fields=['is_active', 'scope']),
        ]


# ──────────────────────────────────────────────────
# Announcements
# ──────────────────────────────────────────────────

class Announcement(models.Model):
    """Platform-wide or targeted announcements."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    body = models.TextField()
    target_type = models.CharField(
        max_length=20,
        choices=[
            (AT.GLOBAL, 'Global'),
            (AT.ORGANIZATION, 'Organization'),
            (AT.CLIENT, 'Client'),
        ],
        default=AT.GLOBAL,
    )
    # For non-global announcements
    target_organization = models.ForeignKey(
        'organizations.Organization', on_delete=models.CASCADE,
        null=True, blank=True, related_name='announcements'
    )
    is_active = models.BooleanField(default=True)
    is_pinned = models.BooleanField(default=False)
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'pro_announcement'
        ordering = ['-is_pinned', '-created_at']
        indexes = [
            models.Index(fields=['is_active', 'target_type']),
            models.Index(fields=['is_pinned']),
            models.Index(fields=['created_at']),
        ]

    @property
    def is_expired(self):
        return self.expires_at is not None and timezone.now() >= self.expires_at


# ──────────────────────────────────────────────────
# Feature Flags
# ──────────────────────────────────────────────────

class FeatureFlag(models.Model):
    """Platform-wide feature flag default."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=50, unique=True)
    label = models.CharField(max_length=100)
    is_enabled = models.BooleanField(default=True)
    updated_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pro_feature_flag'

    def __str__(self):
        return f'{self.key}={"ON" if self.is_enabled else "OFF"}'


class ClientFeatureFlag(models.Model):
    """Per-client override for a feature flag."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    feature_flag = models.ForeignKey(FeatureFlag, on_delete=models.CASCADE, related_name='client_overrides')
    organization = models.ForeignKey('organizations.Organization', on_delete=models.CASCADE, related_name='feature_flags')
    is_enabled = models.BooleanField(default=True)
    updated_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'pro_client_feature_flag'
        unique_together = [('feature_flag', 'organization')]


# ──────────────────────────────────────────────────
# Statistics Snapshots
# ──────────────────────────────────────────────────

class StatisticsSnapshot(models.Model):
    """
    Point-in-time platform statistics snapshot.
    Generated by Celery beat task, stored for dashboard display.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    snapshot_at = models.DateTimeField(auto_now_add=True)
    # Counts
    total_organizations = models.IntegerField(default=0)
    total_clients = models.IntegerField(default=0)
    total_users = models.IntegerField(default=0)
    total_tables = models.IntegerField(default=0)
    total_fields = models.IntegerField(default=0)
    total_cards = models.IntegerField(default=0)
    total_imports = models.IntegerField(default=0)
    total_exports = models.IntegerField(default=0)
    total_media = models.IntegerField(default=0)
    total_jobs = models.IntegerField(default=0)
    active_sandbox_sessions = models.IntegerField(default=0)
    storage_bytes = models.BigIntegerField(default=0)
    # Extended breakdown as JSON (per-org, per-status, etc.)
    breakdown = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)

    class Meta:
        db_table = 'pro_statistics_snapshot'
        ordering = ['-snapshot_at']


# ──────────────────────────────────────────────────
# Backups
# ──────────────────────────────────────────────────

class BackupSession(models.Model):
    """Tracks a backup creation job."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scope = models.CharField(
        max_length=20,
        choices=[(BackupScope.CLIENT, 'Client'), (BackupScope.ORGANIZATION, 'Organization')],
    )
    target_organization = models.ForeignKey(
        'organizations.Organization', on_delete=models.CASCADE,
        null=True, blank=True, related_name='backup_sessions'
    )
    status = models.CharField(max_length=20, default=BackupStatus.PENDING)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    duration = models.FloatField(null=True, blank=True)
    created_by = models.ForeignKey('users.User', on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pro_backup_session'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['created_at']),
        ]


class BackupArtifact(models.Model):
    """Stores metadata for a backup file."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    backup_session = models.OneToOneField(BackupSession, on_delete=models.CASCADE, related_name='artifact')
    file_name = models.CharField(max_length=255)
    stored_path = models.CharField(max_length=500)
    file_size = models.BigIntegerField(default=0)
    checksum = models.CharField(max_length=64, blank=True)  # SHA-256
    download_count = models.IntegerField(default=0)
    last_downloaded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pro_backup_artifact'
