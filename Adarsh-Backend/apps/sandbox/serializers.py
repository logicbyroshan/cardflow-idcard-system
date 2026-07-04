"""Sandbox DRF serializers."""
from rest_framework import serializers
from apps.sandbox.models import (
    SandboxSession,
    SandboxChange,
    SandboxCardCreate,
    SandboxCardDelete,
    SandboxWorkflowHistory,
    SandboxCardStatus,
    SandboxImportSession,
    SandboxExportSession,
)


class SandboxSessionSerializer(serializers.ModelSerializer):
    is_expired = serializers.ReadOnlyField()

    class Meta:
        model = SandboxSession
        fields = [
            'id', 'user', 'device_id', 'token',
            'created_at', 'last_activity_at', 'expires_at',
            'is_active', 'is_expired',
        ]
        read_only_fields = [
            'id', 'user', 'token',
            'created_at', 'last_activity_at', 'expires_at', 'is_expired',
        ]


class SandboxChangeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SandboxChange
        fields = ['id', 'card', 'field', 'old_value', 'new_value', 'timestamp']
        read_only_fields = fields


class SandboxCardCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SandboxCardCreate
        fields = ['id', 'table', 'display_id', 'data', 'status', 'created_at']
        read_only_fields = ['id', 'display_id', 'status', 'created_at']


class SandboxWorkflowHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = SandboxWorkflowHistory
        fields = ['id', 'card', 'sandbox_card', 'old_status', 'new_status', 'action', 'reason', 'timestamp']
        read_only_fields = fields


class SandboxImportSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SandboxImportSession
        fields = [
            'id', 'table', 'status', 'total_rows', 'success_rows',
            'warning_rows', 'failed_rows', 'duration', 'error_message', 'created_at',
        ]
        read_only_fields = fields


class SandboxExportSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SandboxExportSession
        fields = [
            'id', 'table', 'export_type', 'status', 'file_name',
            'file_size', 'record_count', 'error_message',
            'started_at', 'completed_at', 'duration', 'created_at',
        ]
        read_only_fields = fields
