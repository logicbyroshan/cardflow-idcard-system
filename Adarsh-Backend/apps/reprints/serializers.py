from rest_framework import serializers
from apps.reprints.models import ReprintRequest, ReprintHistory, ReprintExportSession
from apps.cards.serializers import CardSerializer

class ReprintRequestSerializer(serializers.ModelSerializer):
    card_details = CardSerializer(source='card', read_only=True)
    requested_by_username = serializers.CharField(source='requested_by.username', read_only=True)
    approved_by_username = serializers.CharField(source='approved_by.username', read_only=True)
    printed_by_username = serializers.CharField(source='printed_by.username', read_only=True)

    class Meta:
        model = ReprintRequest
        fields = [
            'id', 'card', 'card_details', 'table', 'organization', 'client',
            'requested_by', 'requested_by_username',
            'approved_by', 'approved_by_username',
            'printed_by', 'printed_by_username',
            'status', 'draft_data', 'draft_media_changes', 'request_count',
            'created_at', 'approved_at', 'printed_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'client', 'requested_by', 'approved_by', 'printed_by',
            'status', 'request_count', 'created_at', 'approved_at', 'printed_at', 'updated_at'
        ]

class ReprintHistorySerializer(serializers.ModelSerializer):
    performed_by_username = serializers.CharField(source='performed_by.username', read_only=True)

    class Meta:
        model = ReprintHistory
        fields = ['id', 'reprint_request', 'card', 'action', 'performed_by', 'performed_by_username', 'created_at', 'details']

class ReprintExportSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReprintExportSession
        fields = ['id', 'reprint_requests', 'export_format', 'status', 'created_by', 'download_url', 'created_at', 'updated_at']
        read_only_fields = ['id', 'status', 'created_by', 'download_url', 'created_at', 'updated_at']
