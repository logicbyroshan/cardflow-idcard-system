from django.conf import settings
from contracts.storage import StorageContract
from apps.mediafiles.storage.providers import LocalStorage, R2Storage, MinIOStorage

class StorageFactory:
    @staticmethod
    def get_storage(provider: str = None) -> StorageContract:
        provider = provider or getattr(settings, 'STORAGE_PROVIDER', 'local')
        provider = provider.lower()
        
        if provider == 'local':
            return LocalStorage()
        elif provider == 'r2':
            config = getattr(settings, 'STORAGE_R2_CONFIG', {})
            return R2Storage(
                endpoint_url=config.get('endpoint_url'),
                bucket_name=config.get('bucket_name'),
                access_key=config.get('access_key'),
                secret_key=config.get('secret_key'),
            )
        elif provider == 'minio':
            config = getattr(settings, 'STORAGE_MINIO_CONFIG', {})
            return MinIOStorage(
                endpoint_url=config.get('endpoint_url'),
                bucket_name=config.get('bucket_name'),
                access_key=config.get('access_key'),
                secret_key=config.get('secret_key'),
            )
        else:
            raise ValueError(f"Unknown storage provider: {provider}")
