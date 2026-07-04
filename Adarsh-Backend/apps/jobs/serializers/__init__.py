from rest_framework import serializers
from apps.jobs.models import Job, JobLog, JobEvent

class JobLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobLog
        fields = '__all__'

class JobEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobEvent
        fields = '__all__'

class JobSerializer(serializers.ModelSerializer):
    logs = JobLogSerializer(many=True, read_only=True)
    events = JobEventSerializer(many=True, read_only=True)

    class Meta:
        model = Job
        fields = '__all__'
