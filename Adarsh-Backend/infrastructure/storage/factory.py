from django.conf import settings
from contracts.storage import StorageContract
from .local import LocalStorage
from .r2 import R2Storage
from .minio import MinioStorage

class StorageFactory:
    @staticmethod
    def get_storage() -> StorageContract:
        backend = getattr(settings, 'STORAGE_BACKEND', 'local')
        if backend == 'r2':
            return R2Storage()
        elif backend == 'minio':
            return MinioStorage()
        return LocalStorage()\n