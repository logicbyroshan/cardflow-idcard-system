import uuid

from django.conf import settings
from django.db import models


class Message(models.Model):
    """Internal mail message between panel users.

    Supports two modes:
      1. Internal user-to-user mail (sender/recipient FKs)
      2. External email simulation (from_email/to_email strings)

    The ``direction`` and ``status`` fields power the email-infrastructure
    layer.  When a real provider (Brevo SMTP for sending, Mailgun inbound
    webhook for receiving) is wired in later, these fields drive routing.
    """

    DIRECTION_CHOICES = [
        ('incoming', 'Incoming'),
        ('outgoing', 'Outgoing'),
    ]
    STATUS_CHOICES = [
        ('sent', 'Sent'),
        ('received', 'Received'),
        ('failed', 'Failed'),
    ]

    # Unique public ID — used in API URLs instead of sequential PK
    uuid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)

    # ── Internal user links (nullable for external/webhook emails) ────
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='sent_mail',
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='received_mail',
    )

    # ── Email-address fields (for external / webhook emails) ──────────
    from_email = models.EmailField(max_length=254, blank=True, default='')
    to_email = models.EmailField(max_length=254, blank=True, default='')

    subject = models.CharField(max_length=255)
    body = models.TextField()

    # ── Email infrastructure fields ───────────────────────────────────
    direction = models.CharField(
        max_length=10, choices=DIRECTION_CHOICES, default='outgoing',
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default='sent',
    )

    is_read = models.BooleanField(default=False)
    sender_trashed = models.BooleanField(default=False)
    recipient_trashed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        src = self.from_email or str(self.sender or '?')
        dst = self.to_email or str(self.recipient or '?')
        return f'{self.subject} ({src} → {dst})'
