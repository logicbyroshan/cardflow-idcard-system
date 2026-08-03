from rest_framework import serializers

class OverridePermissionSerializer(serializers.Serializer):
    user_id = serializers.UUIDField(required=True)
    permission_code = serializers.CharField(required=True)
    is_granted = serializers.BooleanField(required=True)
