from rest_framework import serializers
from apps.imports.models import ImportSession, ImportRowResult, ImportWarning, ReuploadSession

class ImportWarningSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportWarning
        fields = '__all__'

class ImportRowResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportRowResult
        fields = '__all__'

class ImportSessionSerializer(serializers.ModelSerializer):
    warnings_count = serializers.SerializerMethodField()
    results_count = serializers.SerializerMethodField()

    class Meta:
        model = ImportSession
        fields = [
            'id', 'user', 'organization', 'table', 'status', 
            'started_at', 'completed_at', 'total_rows', 'success_rows', 
            'warning_rows', 'failed_rows', 'duration', 'created_at', 'updated_at',
            'warnings_count', 'results_count'
        ]
        read_only_fields = ['id', 'user', 'organization', 'status', 'started_at', 'completed_at', 'duration']

    def get_warnings_count(self, obj):
        return obj.warnings.count()

    def get_results_count(self, obj):
        return obj.row_results.count()

class ReuploadSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReuploadSession
        fields = '__all__'
        read_only_fields = ['id', 'user', 'organization', 'status', 'started_at', 'completed_at', 'duration']
