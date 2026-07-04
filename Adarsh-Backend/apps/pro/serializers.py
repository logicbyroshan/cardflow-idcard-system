"""Pro User Platform — DRF Serializers."""
from rest_framework import serializers
from apps.pro.models import (
    ImpersonationSession, ImpersonationAudit,
    MaintenanceMode, Announcement, FeatureFlag, ClientFeatureFlag,
    StatisticsSnapshot, BackupSession, BackupArtifact,
)


class ImpersonationSessionSerializer(serializers.ModelSerializer):
    target_user_email = serializers.CharField(source='target_user.email', read_only=True)
    target_user_role = serializers.CharField(source='target_user.role', read_only=True)

    class Meta:
        model = ImpersonationSession
        fields = [
            'id', 'target_user', 'target_user_email', 'target_user_role',
            'reason', 'ip_address', 'user_agent',
            'started_at', 'ended_at', 'is_active',
        ]
        read_only_fields = fields


class ImpersonationAuditSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImpersonationAudit
        fields = ['id', 'event_type', 'detail', 'timestamp']
        read_only_fields = fields


class MaintenanceModeSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaintenanceMode
        fields = ['id', 'scope', 'target_organization', 'message', 'is_active', 'created_at', 'deactivated_at']
        read_only_fields = ['id', 'is_active', 'created_at', 'deactivated_at']


class AnnouncementSerializer(serializers.ModelSerializer):
    is_expired = serializers.ReadOnlyField()

    class Meta:
        model = Announcement
        fields = [
            'id', 'title', 'body', 'target_type', 'target_organization',
            'is_active', 'is_pinned', 'is_expired', 'created_at', 'expires_at',
        ]
        read_only_fields = ['id', 'created_at', 'is_expired']


class FeatureFlagSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeatureFlag
        fields = ['id', 'key', 'label', 'is_enabled', 'updated_at']
        read_only_fields = ['id', 'key', 'label', 'updated_at']


class ClientFeatureFlagSerializer(serializers.ModelSerializer):
    key = serializers.CharField(source='feature_flag.key', read_only=True)
    label = serializers.CharField(source='feature_flag.label', read_only=True)

    class Meta:
        model = ClientFeatureFlag
        fields = ['id', 'key', 'label', 'organization', 'is_enabled', 'updated_at']
        read_only_fields = ['id', 'updated_at']


class StatisticsSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model = StatisticsSnapshot
        fields = [
            'id', 'snapshot_at',
            'total_organizations', 'total_clients', 'total_users',
            'total_tables', 'total_fields', 'total_cards',
            'total_imports', 'total_exports', 'total_media',
            'total_jobs', 'active_sandbox_sessions', 'storage_bytes',
            'breakdown',
        ]
        read_only_fields = fields


class BackupArtifactSerializer(serializers.ModelSerializer):
    class Meta:
        model = BackupArtifact
        fields = ['id', 'file_name', 'file_size', 'checksum', 'download_count', 'last_downloaded_at', 'created_at']
        read_only_fields = fields


class BackupSessionSerializer(serializers.ModelSerializer):
    artifact = BackupArtifactSerializer(read_only=True)

    class Meta:
        model = BackupSession
        fields = [
            'id', 'scope', 'target_organization', 'status',
            'error_message', 'started_at', 'completed_at', 'duration',
            'created_at', 'artifact',
        ]
        read_only_fields = fields
