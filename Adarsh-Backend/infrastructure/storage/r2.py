import boto3
from django.conf import settings
from contracts.storage import StorageContract

class R2Storage(StorageContract):
    def __init__(self):
        self.client = boto3.client(
            's3',
            endpoint_url=settings.R2_ENDPOINT_URL,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY
        )
        self.bucket = settings.R2_BUCKET_NAME
    def save(self, name: str, content) -> str:
        self.client.upload_fileobj(content, self.bucket, name)
        return name
    def url(self, name: str) -> str:
        return f"https://{self.bucket}.r2.cloudflarestorage.com/{name}"
    def delete(self, name: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=name)
    def exists(self, name: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=name)
            return True
        except:
            return False\n