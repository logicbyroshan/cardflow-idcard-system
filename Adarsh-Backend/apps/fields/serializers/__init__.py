from rest_framework import serializers
from apps.fields.models import Field

class FieldSerializer(serializers.ModelSerializer):
    class Meta:
        model = Field
        fields = '__all__'
