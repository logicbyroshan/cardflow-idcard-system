from rest_framework import serializers
from apps.users.models import User, OperatorAssignment

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'username', 'phone', 'role', 'is_active', 'created_at']
        read_only_fields = ['id', 'created_at']

class LoginRequestSerializer(serializers.Serializer):
    identifier = serializers.CharField(required=True)
    password = serializers.CharField(required=True)

class TokenResponseSerializer(serializers.Serializer):
    access = serializers.CharField()
    refresh = serializers.CharField()

class OperatorAssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = OperatorAssignment
        fields = ['id', 'operator', 'client', 'assigned_by', 'assigned_at']
        read_only_fields = ['id', 'assigned_at']
