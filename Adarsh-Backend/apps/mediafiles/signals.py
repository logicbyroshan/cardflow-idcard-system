from django.db.models.signals import post_delete
from django.dispatch import receiver
from apps.mediafiles.models import MediaFile, MediaVariant
from apps.mediafiles.services import StorageService

@receiver(post_delete, sender=MediaFile)
def delete_media_file_from_storage(sender, instance, **kwargs):
    try:
        storage = StorageService.get_storage()
        if storage.exists(instance.stored_name):
            storage.delete(instance.stored_name)
    except Exception:
        pass

@receiver(post_delete, sender=MediaVariant)
def delete_media_variant_from_storage(sender, instance, **kwargs):
    try:
        storage = StorageService.get_storage()
        if storage.exists(instance.stored_name):
            storage.delete(instance.stored_name)
    except Exception:
        pass
