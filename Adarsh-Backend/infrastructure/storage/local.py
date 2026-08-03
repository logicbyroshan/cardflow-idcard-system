import os
from django.core.files.storage import FileSystemStorage
from contracts.storage import StorageContract

class LocalStorage(StorageContract):
    def __init__(self):
        self.storage = FileSystemStorage()
    def save(self, name: str, content) -> str:
        return self.storage.save(name, content)
    def url(self, name: str) -> str:
        return self.storage.url(name)
    def delete(self, name: str) -> None:
        self.storage.delete(name)
    def exists(self, name: str) -> bool:
        return self.storage.exists(name)\n