import os
import shutil
from io import BytesIO
from typing import BinaryIO
from django.conf import settings
from contracts.storage import StorageContract

class LocalStorage:
    def __init__(self, base_dir=None, base_url=None):
        self.base_dir = base_dir or getattr(settings, 'LOCAL_STORAGE_DIR', os.path.join(settings.BASE_DIR, 'media'))
        self.base_url = base_url or getattr(settings, 'LOCAL_STORAGE_URL', '/media/')
        os.makedirs(self.base_dir, exist_ok=True)

    def save(self, name: str, content: BinaryIO) -> str:
        filepath = os.path.join(self.base_dir, name)
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        content.seek(0)
        with open(filepath, 'wb') as f:
            shutil.copyfileobj(content, f)
        return name

    def read(self, name: str) -> bytes:
        filepath = os.path.join(self.base_dir, name)
        with open(filepath, 'rb') as f:
            return f.read()

    def url(self, name: str) -> str:
        return f"{self.base_url}{name}"

    def delete(self, name: str) -> None:
        filepath = os.path.join(self.base_dir, name)
        if os.path.exists(filepath):
            os.remove(filepath)

    def exists(self, name: str) -> bool:
        return os.path.exists(os.path.join(self.base_dir, name))


class S3CompatibleStorage:
    def __init__(self, endpoint_url: str, bucket_name: str, access_key: str, secret_key: str, region_name: str = None):
        self.bucket_name = bucket_name
        import boto3
        self.s3 = boto3.client(
            's3',
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region_name or 'auto'
        )

    def save(self, name: str, content: BinaryIO) -> str:
        content.seek(0)
        self.s3.upload_fileobj(content, self.bucket_name, name)
        return name

    def read(self, name: str) -> bytes:
        buf = BytesIO()
        self.s3.download_fileobj(self.bucket_name, name, buf)
        buf.seek(0)
        return buf.read()

    def url(self, name: str) -> str:
        try:
            return self.s3.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': name},
                ExpiresIn=3600
            )
        except Exception:
            return f"https://{self.bucket_name}/{name}"

    def delete(self, name: str) -> None:
        try:
            self.s3.delete_object(Bucket=self.bucket_name, Key=name)
        except Exception:
            pass

    def exists(self, name: str) -> bool:
        try:
            self.s3.head_object(Bucket=self.bucket_name, Key=name)
            return True
        except Exception:
            return False


class R2Storage(S3CompatibleStorage):
    def __init__(self, endpoint_url: str, bucket_name: str, access_key: str, secret_key: str):
        super().__init__(endpoint_url, bucket_name, access_key, secret_key, region_name='auto')


class MinIOStorage(S3CompatibleStorage):
    def __init__(self, endpoint_url: str, bucket_name: str, access_key: str, secret_key: str):
        super().__init__(endpoint_url, bucket_name, access_key, secret_key, region_name='us-east-1')
