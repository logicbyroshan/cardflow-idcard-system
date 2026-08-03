import boto3
from django.conf import settings
from contracts.storage import StorageContract

class MinioStorage(StorageContract):
    def __init__(self):
        self.client = boto3.client(
            's3',
            endpoint_url=settings.MINIO_ENDPOINT_URL,
            aws_access_key_id=settings.MINIO_ACCESS_KEY,
            aws_secret_access_key=settings.MINIO_SECRET_KEY
        )
        self.bucket = settings.MINIO_BUCKET_NAME
    def save(self, name: str, content) -> str:
        self.client.upload_fileobj(content, self.bucket, name)
        return name
    def url(self, name: str) -> str:
        return f"{settings.MINIO_ENDPOINT_URL}/{self.bucket}/{name}"
    def delete(self, name: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=name)
    def exists(self, name: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=name)
            return True
        except:
            return False\n