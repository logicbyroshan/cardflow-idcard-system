"""AuditLog serializer."""
from rest_framework import serializers
from apps.auditlogs.models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_email = serializers.CharField(source='actor.email', default=None, read_only=True)
    target_user_email = serializers.CharField(source='target_user.email', default=None, read_only=True)
    target_organization_name = serializers.CharField(source='target_organization.name', default=None, read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            'id', 'event_type',
            'actor', 'actor_email',
            'target_user', 'target_user_email',
            'target_organization', 'target_organization_name',
            'details', 'ip_address', 'created_at',
        ]
        read_only_fields = fields
