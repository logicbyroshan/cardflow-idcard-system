import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied
from django.http import HttpResponse, FileResponse

from apps.exports.models import ExportTemplate, ExportSession, ExportArtifact
from apps.exports.serializers import ExportTemplateSerializer, ExportSessionSerializer, ExportArtifactSerializer
from apps.exports.services import ExportService
from apps.exports.constants import ExportType, PageBreak, XlsxFieldScope
from apps.tables.selectors import TableSelector
from apps.jobs.models import Job, JobType, JobStatus
from apps.jobs.services import JobService
from apps.mediafiles.storage.factory import StorageFactory
from shared.constants import Role

logger = logging.getLogger(__name__)


class ExportTemplateViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ExportTemplateSerializer

    def get_queryset(self):
        qs = ExportTemplate.objects.filter(
            organization_id=self.request.user.organization_id,
            is_active=True
        )
        table_id = self.request.query_params.get('table_id')
        if table_id:
            qs = qs.filter(table_id=table_id)
        return qs

    def perform_create(self, serializer):
        table_id = self.request.data.get('table_id')
        if not table_id:
            raise ValidationError("table_id is required.")
        table = TableSelector.get_table(table_id)
        if not table:
            raise ValidationError("Table not found.")
        if str(table.organization_id) != str(self.request.user.organization_id):
            raise PermissionDenied("Access denied.")

        # Save snapshot as TemplateVersion 1
        template = serializer.save(
            organization_id=self.request.user.organization_id,
            table=table,
            created_by=self.request.user,
        )
        from apps.exports.models import TemplateVersion
        TemplateVersion.objects.create(
            template=template,
            version_number=1,
            body=template.body or '',
            changed_by=self.request.user,
        )

    def perform_update(self, serializer):
        template = self.get_object()
        last_version = template.versions.first()
        next_ver = (last_version.version_number + 1) if last_version else 1
        updated = serializer.save()
        if updated.body:
            from apps.exports.models import TemplateVersion
            TemplateVersion.objects.create(
                template=updated,
                version_number=next_ver,
                body=updated.body,
                changed_by=self.request.user,
            )

    @action(detail=True, methods=['get'], url_path='versions')
    def versions(self, request, pk=None):
        template = self.get_object()
        from apps.exports.models import TemplateVersion
        from apps.exports.serializers import TemplateVersionSerializer
        versions = template.versions.all()
        return Response(TemplateVersionSerializer(versions, many=True).data)

    @action(detail=True, methods=['post'], url_path='validate-placeholders')
    def validate_placeholders(self, request, pk=None):
        template = self.get_object()
        from apps.exports.placeholder import PlaceholderParser
        from apps.fields.models import Field
        fields = Field.objects.filter(table=template.table, is_deleted=False)
        field_names = [f.name for f in fields]
        unknown = PlaceholderParser.validate_placeholders(template.body or '', field_names)
        return Response({'unknown_placeholders': unknown})


class ExportSessionViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ExportSessionSerializer
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        qs = ExportSession.objects.filter(
            organization_id=self.request.user.organization_id
        ).prefetch_related('artifacts', 'results')
        table_id = self.request.query_params.get('table_id')
        if table_id:
            qs = qs.filter(table_id=table_id)
        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)
        return qs

    def create(self, request):
        """
        Kick off an export.

        POST /api/v1/exports/sessions/
        {
          "table_id": "<uuid>",
          "export_type": "PDF",           // PDF | DOCX | XLSX | ZIP
          "template_id": "<uuid>",        // optional for PDF/DOCX
          "card_ids": ["<uuid>", ...],    // optional; drives scope
          "status": "APPROVED",           // optional filter
          "page_break": "BY_CLASS",       // NONE | BY_CLASS | BY_SECTION  (PDF/DOCX)
          "field_scope": "ALL",           // ALL | VISIBLE  (XLSX)
          "rename_pattern": "{name}_{class}" // (ZIP)
        }
        """
        data = request.data
        table_id = data.get('table_id')
        export_type = data.get('export_type', '').upper()
        template_id = data.get('template_id')
        card_ids = data.get('card_ids', [])
        status_filter = data.get('status')
        page_break = data.get('page_break', PageBreak.NONE)
        field_scope = data.get('field_scope', XlsxFieldScope.ALL)
        rename_pattern = data.get('rename_pattern', '{display_id}')

        if not table_id:
            return Response({'error': 'table_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if export_type not in [ExportType.PDF, ExportType.DOCX, ExportType.XLSX, ExportType.ZIP]:
            return Response({'error': f'Invalid export_type: {export_type}.'}, status=status.HTTP_400_BAD_REQUEST)

        table = TableSelector.get_table(table_id)
        if not table:
            return Response({'error': 'Table not found.'}, status=status.HTTP_404_NOT_FOUND)
        if str(table.organization_id) != str(request.user.organization_id):
            return Response({'error': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)

        template = None
        if template_id:
            try:
                template = ExportTemplate.objects.get(
                    id=template_id,
                    organization_id=request.user.organization_id,
                    is_active=True,
                )
            except ExportTemplate.DoesNotExist:
                return Response({'error': 'Template not found.'}, status=status.HTTP_404_NOT_FOUND)

        options = {
            'card_ids': card_ids,
            'status': status_filter,
            'page_break': page_break,
            'field_scope': field_scope,
            'rename_pattern': rename_pattern,
        }

        export_session = ExportService.start_export(
            user=request.user,
            table=table,
            export_type=export_type,
            template=template,
            options=options,
        )

        # Create a Job to run the export in Celery
        job_type_map = {
            ExportType.PDF: JobType.EXPORT_PDF,
            ExportType.DOCX: JobType.EXPORT_DOCX,
            ExportType.XLSX: JobType.EXPORT_XLSX,
            ExportType.ZIP: JobType.EXPORT_ZIP,
        }
        job = Job.objects.create(
            type=job_type_map[export_type],
            status=JobStatus.QUEUED,
            payload={'export_session_id': str(export_session.id)},
            created_by=request.user,
        )

        from apps.jobs.tasks import run_job_task
        run_job_task.delay(str(job.id))

        return Response({
            'export_session_id': str(export_session.id),
            'job_id': str(job.id),
            'status': export_session.status,
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='download')
    def download(self, request, pk=None):
        """Stream the first artifact of a completed export session."""
        export_session = self.get_object()
        if export_session.status != 'COMPLETED':
            return Response({'error': 'Export not yet completed.'}, status=status.HTTP_400_BAD_REQUEST)

        artifact = export_session.artifacts.first()
        if not artifact:
            return Response({'error': 'No artifact found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            storage = StorageFactory.get_storage()
            data = storage.read(artifact.stored_path)
            response = HttpResponse(data, content_type=artifact.mime_type)
            response['Content-Disposition'] = f'attachment; filename="{artifact.file_name}"'
            response['Content-Length'] = str(artifact.file_size)
            return response
        except Exception as e:
            logger.error(f"Failed to stream artifact {artifact.id}: {e}")
            return Response({'error': 'Failed to retrieve file.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
