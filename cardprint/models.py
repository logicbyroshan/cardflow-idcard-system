"""
Card Print Models
=================
Tracks print requests for ID cards (approved → print_list → finalized → pool).
Modelled after ReprintRequest but for the print workflow.

The PrintRequest is a SEPARATE model that references the original IDCard
without modifying it — the card's main status stays 'approved'.
"""
import logging

from django.conf import settings
from django.db import models

logger = logging.getLogger(__name__)


class PrintRequest(models.Model):
    """
    Tracks print requests for approved ID cards.
    Workflow: print_list → finalized (via Generate task) → pool
    """
    PRINT_STATUS_CHOICES = [
        ('print_list', 'Print List'),
        ('finalized', 'Finalized'),
        ('pool', 'Pool'),
    ]

    card = models.ForeignKey(
        'core.IDCard',
        on_delete=models.CASCADE,
        related_name='print_requests',
    )
    table = models.ForeignKey(
        'core.IDCardTable',
        on_delete=models.CASCADE,
        related_name='print_requests',
    )
    status = models.CharField(
        max_length=20,
        choices=PRINT_STATUS_CHOICES,
        default='print_list',
        db_index=True,
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='print_requests',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Print #{self.id} — Card #{self.card_id} ({self.status})"

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['table', 'status']),
            models.Index(fields=['table', 'status', '-created_at']),
            models.Index(fields=['card']),
            models.Index(fields=['created_at']),
        ]
