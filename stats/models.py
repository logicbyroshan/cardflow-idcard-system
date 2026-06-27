from django.db import models
from django.utils import timezone

class StatsSnapshot(models.Model):
    """
    Stores aggregated statistics snapshots over time.
    Allows plotting historical active client/assistant user activities, 
    batch job stats, and peak usage counters.
    """
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)
    active_clients = models.IntegerField(default=0)
    active_assistants = models.IntegerField(default=0)
    peak_active_users = models.IntegerField(default=0)
    total_cards_created = models.IntegerField(default=0)
    total_cards_approved = models.IntegerField(default=0)
    batch_jobs_count = models.IntegerField(default=0)

    class Meta:
        verbose_name = "Stats Snapshot"
        verbose_name_plural = "Stats Snapshots"
        ordering = ['-timestamp']

    def __str__(self):
        return f"StatsSnapshot at {self.timestamp} (Clients: {self.active_clients}, Assistants: {self.active_assistants})"
