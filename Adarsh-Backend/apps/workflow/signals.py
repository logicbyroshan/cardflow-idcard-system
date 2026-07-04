from django.db.models.signals import pre_save
from django.dispatch import receiver
from apps.cards.models import Card
from apps.workflow.constants import WorkflowState

@receiver(pre_save, sender=Card)
def set_pending_status(sender, instance, **kwargs):
    # Set default status to PENDING if not set or set to default ACTIVE
    if not instance.status or instance.status == 'ACTIVE':
        instance.status = WorkflowState.PENDING
