"""
Desktop Integration API Models — Phase 15

DesktopApiKey  — per-org API keys (no JWT)
DesktopAccessLog — every desktop API request
DesktopSyncSession — bulk download sessions
"""
import uuid
import secrets
import hashlib
from django.db import models
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone
from apps.desktop_sync.constants import KEY_PREFIX


def _generate_key():
    """Generate a 40-char random desktop API key."""
    raw = secrets.token_urlsafe(30)
    return f"{KEY_PREFIX}{raw}"


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class DesktopApiKey(models.Model):
    """
    Per-device API key for a client organization.
    Desktop software authenticates using X-Desktop-Key header.
    Keys are hashed at rest — raw key shown only once at creation.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        'organizations.Organization', on_delete=models.CASCADE,
        related_name='desktop_api_keys'
    )
    name = models.CharField(max_length=100)          # e.g. "Office PC", "Printing PC"
    key_hash = models.CharField(max_length=64, unique=True)  # SHA-256 of raw key
    created_by = models.ForeignKey(
        'users.User', on_delete=models.SET_NULL, null=True,
        related_name='desktop_keys_created'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'desktop_api_key'
        indexes = [
            models.Index(fields=['organization', 'is_active']),
            models.Index(fields=['key_hash']),
        ]

    def __str__(self):
        return f"{self.organization.name} / {self.name}"

    @classmethod
    def create_key(cls, organization, name, created_by):
        """
        Create a new key. Returns (instance, raw_key).
        raw_key is shown only once — not stored.
        """
        raw = _generate_key()
        hashed = _hash_key(raw)
        instance = cls.objects.create(
            organization=organization,
            name=name,
            key_hash=hashed,
            created_by=created_by,
        )
        return instance, raw

    @classmethod
    def authenticate(cls, raw_key: str):
        """
        Lookup a key by its hash. Returns the DesktopApiKey or None.
        Updates last_used_at on success.
        """
        hashed = _hash_key(raw_key)
        try:
            key = cls.objects.select_related('organization').get(
                key_hash=hashed, is_active=True
            )
            key.last_used_at = timezone.now()
            key.save(update_fields=['last_used_at'])
            return key
        except cls.DoesNotExist:
            return None


class DesktopAccessLog(models.Model):
    """Immutable log of every desktop API action."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    api_key = models.ForeignKey(
        DesktopApiKey, on_delete=models.SET_NULL, null=True,
        related_name='access_logs'
    )
    organization = models.ForeignKey(
        'organizations.Organization', on_delete=models.CASCADE,
        related_name='desktop_access_logs'
    )
    event_type = models.CharField(max_length=50)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    details = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'desktop_access_log'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['api_key', 'event_type']),
            models.Index(fields=['organization']),
            models.Index(fields=['timestamp']),
        ]


class DesktopSyncSession(models.Model):
    """Tracks a bulk sync / download session from the desktop client."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    api_key = models.ForeignKey(
        DesktopApiKey, on_delete=models.SET_NULL, null=True,
        related_name='sync_sessions'
    )
    organization = models.ForeignKey(
        'organizations.Organization', on_delete=models.CASCADE,
        related_name='desktop_sync_sessions'
    )
    table = models.ForeignKey(
        'tables.Table', on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='desktop_sync_sessions'
    )
    # Filters applied during this sync
    filters = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    status = models.CharField(
        max_length=20,
        choices=[('PENDING', 'Pending'), ('ACTIVE', 'Active'),
                 ('COMPLETED', 'Completed'), ('FAILED', 'Failed')],
        default='PENDING'
    )
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    duration = models.FloatField(null=True, blank=True)
    card_count = models.IntegerField(default=0)
    image_count = models.IntegerField(default=0)
    downloaded_bytes = models.BigIntegerField(default=0)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'desktop_sync_session'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['api_key']),
            models.Index(fields=['status']),
        ]
