"""Desktop API serializers."""
from rest_framework import serializers
from apps.desktop_sync.models import DesktopApiKey, DesktopAccessLog, DesktopSyncSession
from apps.mediafiles.models import MediaFile


class DesktopApiKeySerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source='organization.name', read_only=True)

    class Meta:
        model = DesktopApiKey
        fields = ['id', 'name', 'organization', 'organization_name',
                  'created_at', 'last_used_at', 'is_active']
        read_only_fields = fields


class DesktopApiKeyCreateSerializer(serializers.ModelSerializer):
    """Used at creation time — includes the one-time raw_key field."""
    raw_key = serializers.CharField(read_only=True)

    class Meta:
        model = DesktopApiKey
        fields = ['id', 'name', 'organization', 'created_at', 'is_active', 'raw_key']
        read_only_fields = ['id', 'organization', 'created_at', 'is_active', 'raw_key']


class DesktopAccessLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = DesktopAccessLog
        fields = ['id', 'event_type', 'ip_address', 'details', 'timestamp']
        read_only_fields = fields


class DesktopSyncSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DesktopSyncSession
        fields = [
            'id', 'table', 'filters', 'status',
            'started_at', 'completed_at', 'duration',
            'card_count', 'image_count', 'downloaded_bytes',
            'error_message', 'created_at',
        ]
        read_only_fields = fields


class MediaFileMetaSerializer(serializers.ModelSerializer):
    field_name = serializers.CharField(source='field.name', default=None, read_only=True)

    class Meta:
        model = MediaFile
        fields = [
            'id', 'field', 'field_name', 'original_name',
            'mime_type', 'extension', 'file_size',
            'width', 'height', 'checksum', 'created_at',
        ]
        read_only_fields = fields


class DesktopCardSerializer(serializers.Serializer):
    """Flat card shape returned to desktop client."""
    id = serializers.UUIDField()
    display_id = serializers.CharField()
    status = serializers.CharField()
    data = serializers.DictField()
