from rest_framework import serializers
from apps.organizations.models import Organization

class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ['id', 'name', 'owner_client', 'client_information', 'created_at']
        read_only_fields = ['id', 'created_at']

class CreateOrganizationRequestSerializer(serializers.Serializer):
    name = serializers.CharField(required=True)
    client_information = serializers.JSONField(required=False, default=dict)
    owner_email = serializers.EmailField(required=True)
    owner_username = serializers.CharField(required=True)
    owner_password = serializers.CharField(required=True)
