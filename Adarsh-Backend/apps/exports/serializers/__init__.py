from rest_framework import serializers
from apps.exports.models import ExportTemplate, TemplateVersion, TemplateAsset, ExportSession, ExportResult, ExportArtifact


class TemplateAssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = TemplateAsset
        fields = ['id', 'asset_name', 'stored_path', 'mime_type', 'file_size', 'created_at']


class TemplateVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TemplateVersion
        fields = ['id', 'version_number', 'body', 'changed_by', 'created_at']


class ExportTemplateSerializer(serializers.ModelSerializer):
    assets = TemplateAssetSerializer(many=True, read_only=True)

    class Meta:
        model = ExportTemplate
        fields = [
            'id', 'organization', 'table', 'name', 'export_type',
            'description', 'body', 'is_active', 'created_by', 'created_at', 'updated_at',
            'assets',
        ]
        read_only_fields = ['id', 'organization', 'table', 'created_by', 'created_at', 'updated_at']


class ExportArtifactSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExportArtifact
        fields = ['id', 'file_name', 'stored_path', 'mime_type', 'file_size', 'created_at']


class ExportResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExportResult
        fields = ['id', 'card', 'success', 'error_message', 'created_at']


class ExportSessionSerializer(serializers.ModelSerializer):
    artifacts = ExportArtifactSerializer(many=True, read_only=True)
    results_count = serializers.SerializerMethodField()
    error_count = serializers.SerializerMethodField()

    class Meta:
        model = ExportSession
        fields = [
            'id', 'user', 'organization', 'table', 'template',
            'export_type', 'status', 'options',
            'started_at', 'completed_at', 'duration',
            'record_count', 'file_size', 'error_message',
            'created_at', 'updated_at',
            'artifacts', 'results_count', 'error_count',
        ]
        read_only_fields = [
            'id', 'user', 'organization', 'status', 'started_at', 'completed_at',
            'duration', 'record_count', 'file_size', 'error_message',
            'created_at', 'updated_at',
        ]

    def get_results_count(self, obj):
        return obj.results.count()

    def get_error_count(self, obj):
        return obj.results.filter(success=False).count()
