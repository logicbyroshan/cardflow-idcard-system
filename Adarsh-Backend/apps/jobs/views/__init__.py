from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from apps.jobs.models import Job
from apps.jobs.serializers import JobSerializer, JobLogSerializer
from apps.jobs.services import JobService

class JobViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Job.objects.all()
    serializer_class = JobSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        job = self.get_object()
        JobService.cancel_job(job)
        return Response(JobSerializer(job).data)

    @action(detail=True, methods=['get'])
    def logs(self, request, pk=None):
        job = self.get_object()
        logs = job.logs.all()
        return Response(JobLogSerializer(logs, many=True).data)
