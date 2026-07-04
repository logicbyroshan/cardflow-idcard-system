"""
Sandbox API views.

All sandbox endpoints require:
  - IsAuthenticated
  - X-Sandbox-Token header (except session creation which uses X-Device-ID)

Sandbox cannot bypass assistant permission restrictions (AssistantFilter still applies).
"""
import os
import tempfile
import logging
from django.utils import timezone
from django.http import HttpResponse
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound

from apps.sandbox.models import (
    SandboxSession,
    SandboxImportSession,
    SandboxExportSession,
)
from apps.sandbox.services import (
    SandboxResolver,
    SandboxEditService,
    SandboxCardService,
    SandboxWorkflowService,
    SandboxImportService,
    SandboxExportService,
    SandboxCleanupService,
)
from apps.sandbox.serializers import (
    SandboxSessionSerializer,
    SandboxImportSessionSerializer,
    SandboxExportSessionSerializer,
    SandboxWorkflowHistorySerializer,
    SandboxChangeSerializer,
)
from apps.sandbox.constants import SandboxImportStatus, SandboxExportStatus
from apps.tables.models import Table
from apps.cards.models import Card
from apps.mediafiles.storage.factory import StorageFactory
from apps.exports.constants import ExportType

logger = logging.getLogger(__name__)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_session_from_request(request) -> SandboxSession:
    """Extract and validate sandbox session from X-Sandbox-Token header."""
    token = request.headers.get('X-Sandbox-Token')
    if not token:
        raise ValidationError("X-Sandbox-Token header is required.")
    try:
        session = SandboxSession.objects.get(token=token, is_active=True)
    except SandboxSession.DoesNotExist:
        raise PermissionDenied("Invalid or expired sandbox session token.")
    if session.is_expired:
        session.is_active = False
        session.save(update_fields=['is_active'])
        raise PermissionDenied("Sandbox session has expired.")
    if session.user != request.user:
        raise PermissionDenied("Sandbox session does not belong to this user.")
    return session


def _get_table(request, table_id: str) -> Table:
    """Fetch a table belonging to the user's organisation."""
    table = Table.objects.filter(
        id=table_id,
        organization_id=request.user.organization_id,
        is_deleted=False,
    ).first()
    if not table:
        raise NotFound("Table not found.")
    return table


# ─── Session Management ───────────────────────────────────────────────────────

class SandboxSessionView(APIView):
    """
    POST  /sandbox/sessions/          — Create or resume a session for this device
    GET   /sandbox/sessions/current/  — Get current session info (by token)
    DELETE /sandbox/sessions/current/ — Deactivate (clear) sandbox session
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        device_id = request.data.get('device_id') or request.headers.get('X-Device-ID')
        if not device_id:
            raise ValidationError("device_id is required.")
        session = SandboxResolver.get_or_create_session(request.user, device_id)
        return Response(SandboxSessionSerializer(session).data, status=status.HTTP_200_OK)

    def get(self, request):
        session = _get_session_from_request(request)
        return Response(SandboxSessionSerializer(session).data)

    def delete(self, request):
        session = _get_session_from_request(request)
        SandboxCleanupService.deactivate_session(session, request.user)
        return Response({'detail': 'Sandbox session deactivated.'}, status=status.HTTP_200_OK)


# ─── Card Listing (merged view) ───────────────────────────────────────────────

class SandboxCardListView(APIView):
    """
    GET /sandbox/cards/?table_id=<uuid>
    Returns the merged sandbox card list for a table.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        session = _get_session_from_request(request)
        table_id = request.query_params.get('table_id')
        if not table_id:
            raise ValidationError("table_id query parameter is required.")
        table = _get_table(request, table_id)
        merged = SandboxResolver.resolve_cards(session, table)
        return Response({'results': merged, 'count': len(merged)})


class SandboxCardDetailView(APIView):
    """
    GET   /sandbox/cards/<card_id>/        — Resolve a single card in sandbox context
    PATCH /sandbox/cards/<card_id>/        — Edit fields in sandbox
    DELETE /sandbox/cards/<card_id>/       — Mark card deleted in sandbox
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, card_id):
        session = _get_session_from_request(request)
        card = SandboxResolver.resolve_single_card(session, card_id)
        if not card:
            raise NotFound("Card not found in sandbox.")
        return Response(card)

    def patch(self, request, card_id):
        session = _get_session_from_request(request)
        field_updates = request.data.get('field_updates', {})
        if not field_updates:
            raise ValidationError("field_updates is required.")
        result = SandboxEditService.edit_card(session, card_id, field_updates, request.user)
        return Response(result)

    def delete(self, request, card_id):
        session = _get_session_from_request(request)
        SandboxCardService.delete_card(session, card_id, request.user)
        return Response({'detail': 'Card marked as deleted in sandbox.'})


class SandboxCardCreateView(APIView):
    """
    POST /sandbox/cards/ — Create a sandbox-only card.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        session = _get_session_from_request(request)
        table_id = request.data.get('table_id')
        data = request.data.get('data', {})
        if not table_id:
            raise ValidationError("table_id is required.")
        table = _get_table(request, table_id)
        result = SandboxCardService.create_card(session, table, data, request.user)
        return Response(result, status=status.HTTP_201_CREATED)


# ─── Workflow ─────────────────────────────────────────────────────────────────

class SandboxWorkflowView(APIView):
    """
    POST /sandbox/workflow/transition/
    Body: { card_id, action, reason }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        session = _get_session_from_request(request)
        card_id = request.data.get('card_id')
        action = request.data.get('action')
        reason = request.data.get('reason', '')
        if not card_id or not action:
            raise ValidationError("card_id and action are required.")
        result = SandboxWorkflowService.transition_card(session, card_id, action, request.user, reason)
        return Response(result)


class SandboxWorkflowHistoryView(APIView):
    """
    GET /sandbox/workflow/history/?card_id=<id>
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        session = _get_session_from_request(request)
        card_id = request.query_params.get('card_id')
        from apps.sandbox.models import SandboxWorkflowHistory
        qs = SandboxWorkflowHistory.objects.filter(session=session).order_by('-timestamp')
        if card_id:
            if card_id.startswith('sb_'):
                qs = qs.filter(sandbox_card_id=card_id[3:])
            else:
                qs = qs.filter(card_id=card_id)
        return Response(SandboxWorkflowHistorySerializer(qs, many=True).data)


# ─── Import ───────────────────────────────────────────────────────────────────

class SandboxImportView(APIView):
    """
    POST /sandbox/imports/
    Multipart: { table_id, excel_file }
    Creates sandbox-only cards. Never writes to production.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        session = _get_session_from_request(request)
        table_id = request.data.get('table_id')
        excel_file = request.FILES.get('excel_file')
        if not table_id or not excel_file:
            raise ValidationError("table_id and excel_file are required.")
        table = _get_table(request, table_id)

        suffix = os.path.splitext(excel_file.name)[1] or '.xlsx'
        fd, temp_path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, 'wb') as f:
            for chunk in excel_file.chunks():
                f.write(chunk)

        import_session = SandboxImportSession.objects.create(
            sandbox_session=session,
            user=request.user,
            organization_id=request.user.organization_id,
            table=table,
            status=SandboxImportStatus.PENDING,
        )

        try:
            SandboxImportService.process_import(import_session, temp_path)
        finally:
            try:
                os.remove(temp_path)
            except Exception:
                pass

        import_session.refresh_from_db()
        return Response(
            SandboxImportSessionSerializer(import_session).data,
            status=status.HTTP_201_CREATED
        )


# ─── Export ───────────────────────────────────────────────────────────────────

class SandboxExportView(APIView):
    """
    POST /sandbox/exports/              — Trigger a sandbox export
    GET  /sandbox/exports/<id>/download/ — Download the artifact
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        session = _get_session_from_request(request)
        table_id = request.data.get('table_id')
        export_type = request.data.get('export_type', ExportType.XLSX)
        options = request.data.get('options', {})
        if not table_id:
            raise ValidationError("table_id is required.")
        if export_type not in [ExportType.XLSX, ExportType.ZIP]:
            raise ValidationError("Sandbox supports XLSX and ZIP export types only.")
        table = _get_table(request, table_id)

        export_session = SandboxExportSession.objects.create(
            sandbox_session=session,
            user=request.user,
            organization_id=request.user.organization_id,
            table=table,
            export_type=export_type,
            options=options,
            status=SandboxExportStatus.PENDING,
        )

        try:
            SandboxExportService.process_export(export_session)
        except Exception as e:
            export_session.refresh_from_db()

        export_session.refresh_from_db()
        return Response(
            SandboxExportSessionSerializer(export_session).data,
            status=status.HTTP_201_CREATED
        )


class SandboxExportDownloadView(APIView):
    """GET /sandbox/exports/<id>/download/"""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        session = _get_session_from_request(request)
        try:
            export_session = SandboxExportSession.objects.get(
                id=pk, sandbox_session=session
            )
        except SandboxExportSession.DoesNotExist:
            raise NotFound("Sandbox export not found.")

        if export_session.status != SandboxExportStatus.COMPLETED:
            raise ValidationError("Export has not completed successfully.")

        storage = StorageFactory.get_storage()
        data = storage.read(export_session.stored_path)
        if not data:
            raise NotFound("Export file not found in storage.")

        content_type_map = {
            ExportType.XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ExportType.ZIP: 'application/zip',
        }
        ct = content_type_map.get(export_session.export_type, 'application/octet-stream')
        response = HttpResponse(data, content_type=ct)
        response['Content-Disposition'] = f'attachment; filename="{export_session.file_name}"'
        return response


# ─── Diffs listing ────────────────────────────────────────────────────────────

class SandboxChangesView(APIView):
    """GET /sandbox/changes/?table_id=<uuid> — List all field diffs in this session."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        session = _get_session_from_request(request)
        qs = session.changes.all().order_by('-timestamp')
        table_id = request.query_params.get('table_id')
        if table_id:
            qs = qs.filter(table_id=table_id)
        return Response(SandboxChangeSerializer(qs, many=True).data)
