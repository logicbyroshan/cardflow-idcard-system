from rest_framework import serializers
from apps.mediafiles.models import MediaFile, MediaVariant
from apps.mediafiles.services import StorageService

class MediaVariantSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = MediaVariant
        fields = ['id', 'variant_name', 'stored_name', 'file_size', 'width', 'height', 'url', 'created_at']

    def get_url(self, obj) -> str:
        return StorageService.get_storage().url(obj.stored_name)

class MediaFileSerializer(serializers.ModelSerializer):
    variants = MediaVariantSerializer(many=True, read_only=True)
    url = serializers.SerializerMethodField()

    class Meta:
        model = MediaFile
        fields = ['id', 'organization', 'table', 'card', 'field', 'original_name', 'stored_name',
                  'mime_type', 'extension', 'file_size', 'width', 'height', 'checksum', 'storage_provider',
                  'is_deleted', 'deleted_at', 'created_at', 'created_by', 'url', 'variants']

    def get_url(self, obj) -> str:
        return StorageService.get_storage().url(obj.stored_name)
