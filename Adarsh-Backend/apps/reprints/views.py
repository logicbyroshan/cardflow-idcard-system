from rest_framework import viewsets, status, permissions
from rest_framework.response import Response
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.views import APIView
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
from django.utils import timezone
from datetime import datetime

from apps.reprints.models import ReprintRequest, ReprintHistory, ReprintExportSession, ReprintStatus
from apps.reprints.serializers import ReprintRequestSerializer, ReprintHistorySerializer, ReprintExportSessionSerializer
from apps.reprints.services import ReprintService, ReprintReportService, ReprintExportService
from apps.cards.models import Card
from apps.cards.policies import CardPolicy
from apps.users.selectors import OperatorSelector
from apps.cards.selectors import CardSelector
from apps.desktop_sync.views import DesktopAPIView
from apps.desktop_sync.serializers import MediaFileMetaSerializer
from apps.mediafiles.models import MediaFile, MediaReference
from shared.constants import Role

class ReprintRequestViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def _get_base_queryset(self, user):
        """Scope requests based on role permissions."""
        if user.role in [Role.ADMIN, Role.PRO_USER]:
            return ReprintRequest.objects.all()
        elif user.role == Role.OPERATOR:
            assigned_clients = OperatorSelector.get_assigned_clients(user.id)
            return ReprintRequest.objects.filter(client__in=assigned_clients)
        elif user.role == Role.CLIENT:
            return ReprintRequest.objects.filter(organization_id=user.organization_id)
        elif user.role == Role.ASSISTANT:
            from apps.cards.models import AssistantFilter
            table_ids = AssistantFilter.objects.filter(assistant=user).values_list('table_id', flat=True)
            return ReprintRequest.objects.filter(table_id__in=table_ids)
        return ReprintRequest.objects.none()

    def create(self, request):
        card_id = request.data.get('card_id')
        if not card_id:
            raise ValidationError("card_id is required.")

        card = CardSelector.get_card(card_id)
        if not card:
            raise NotFound("Card not found.")

        # Permission check
        user = request.user
        if user.role == Role.OPERATOR:
            raise PermissionDenied("Operators cannot create reprint requests.")
        elif user.role == Role.CLIENT:
            if str(card.organization_id) != str(user.organization_id):
                raise PermissionDenied("Card organization does not match client organization.")
        elif user.role == Role.ASSISTANT:
            if not CardPolicy.can_access_card(user, card) or not CardPolicy.can_write_card_data(user, str(card.table_id), card.data):
                raise PermissionDenied("Assistant does not have permissions to request reprint for this card.")

        draft_data = request.data.get('draft_data', {})
        draft_media_changes = request.data.get('draft_media_changes', {})

        reprint_req = ReprintService.create_reprint_request(
            card=card,
            requested_by=user,
            draft_data=draft_data,
            draft_media_changes=draft_media_changes
        )
        return Response(ReprintRequestSerializer(reprint_req).data, status=status.HTTP_201_CREATED)

    def list(self, request):
        qs = self._get_base_queryset(request.user)
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return Response(ReprintRequestSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        qs = self._get_base_queryset(request.user)
        try:
            reprint_req = qs.get(id=pk)
        except ReprintRequest.DoesNotExist:
            raise NotFound("Reprint request not found or access denied.")
        return Response(ReprintRequestSerializer(reprint_req).data)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        user = request.user
        if user.role not in [Role.ADMIN, Role.PRO_USER, Role.OPERATOR]:
            raise PermissionDenied("Only admins, pro users, or operators can approve reprint requests.")

        qs = self._get_base_queryset(user)
        try:
            reprint_req = qs.get(id=pk)
        except ReprintRequest.DoesNotExist:
            raise NotFound("Reprint request not found or access denied.")

        approved = ReprintService.approve_reprint_request(reprint_req, user)
        return Response(ReprintRequestSerializer(approved).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        user = request.user
        if user.role not in [Role.ADMIN, Role.PRO_USER, Role.OPERATOR]:
            raise PermissionDenied("Only admins, pro users, or operators can reject reprint requests.")

        qs = self._get_base_queryset(user)
        try:
            reprint_req = qs.get(id=pk)
        except ReprintRequest.DoesNotExist:
            raise NotFound("Reprint request not found or access denied.")

        reason = request.data.get('reason', '')
        rejected = ReprintService.reject_reprint_request(reprint_req, user, reason=reason)
        return Response(ReprintRequestSerializer(rejected).data)

    @action(detail=True, methods=['post'])
    def print(self, request, pk=None):
        user = request.user
        if user.role not in [Role.ADMIN, Role.PRO_USER, Role.OPERATOR]:
            raise PermissionDenied("Only admins, pro users, or operators can mark reprints as printed.")

        qs = self._get_base_queryset(user)
        try:
            reprint_req = qs.get(id=pk)
        except ReprintRequest.DoesNotExist:
            raise NotFound("Reprint request not found or access denied.")

        printed = ReprintService.mark_reprint_printed(reprint_req, user)
        return Response(ReprintRequestSerializer(printed).data)


class ReprintDashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if user.role not in [Role.ADMIN, Role.PRO_USER, Role.OPERATOR, Role.CLIENT]:
            raise PermissionDenied("Access denied.")

        qs = ReprintRequest.objects.all()
        if user.role == Role.OPERATOR:
            assigned_clients = OperatorSelector.get_assigned_clients(user.id)
            qs = qs.filter(client__in=assigned_clients)
        elif user.role == Role.CLIENT:
            qs = qs.filter(organization_id=user.organization_id)

        now = timezone.now()
        start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        widgets = {
            'pending_requests': qs.filter(status=ReprintStatus.REQUESTED).count(),
            'confirmed_requests': qs.filter(status=ReprintStatus.CONFIRMED).count(),
            'printed_requests': qs.filter(status=ReprintStatus.PRINTED).count(),
            'rejected_requests': qs.filter(status=ReprintStatus.REJECTED).count(),
            'total_reprints': qs.filter(status=ReprintStatus.PRINTED).count(),
            'monthly_reprints': qs.filter(status=ReprintStatus.PRINTED, printed_at__gte=start_of_month).count()
        }
        return Response(widgets)


class ReprintReportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if user.role not in [Role.ADMIN, Role.PRO_USER, Role.OPERATOR, Role.CLIENT]:
            raise PermissionDenied("Access denied.")

        org_id = user.organization_id if user.role == Role.CLIENT else None

        # Filter reports by assigned clients if Operator
        if user.role == Role.OPERATOR:
            # For simplicity, we can pass org filter or let report service fetch all
            pass

        start_date_str = request.query_params.get('start_date')
        end_date_str = request.query_params.get('end_date')

        date_range_data = []
        if start_date_str and end_date_str:
            try:
                start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
                end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
                date_range_data = ReprintReportService.get_reprints_by_date_range(start_date, end_date, org_id=org_id)
            except ValueError:
                raise ValidationError("Invalid date format. Use YYYY-MM-DD.")

        reports = {
            'by_client': ReprintReportService.get_reprints_by_client(org_id=org_id),
            'by_organization': ReprintReportService.get_reprints_by_organization() if not org_id else [],
            'by_table': ReprintReportService.get_reprints_by_table(org_id=org_id),
            'by_month': ReprintReportService.get_reprints_by_month(org_id=org_id),
            'by_date_range': date_range_data
        }
        return Response(reports)


class ReprintExportSessionViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request):
        request_ids = request.data.get('reprint_request_ids', [])
        if isinstance(request_ids, str):
            request_ids = [request_ids]
        export_format = request.data.get('export_format')

        if not request_ids or not export_format:
            raise ValidationError("reprint_request_ids and export_format are required.")

        session = ReprintExportService.create_export_session(request.user, request_ids, export_format)
        return Response(ReprintExportSessionSerializer(session).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        try:
            session = ReprintExportSession.objects.get(id=pk)
        except ReprintExportSession.DoesNotExist:
            raise NotFound("Export session not found.")
        return Response(ReprintExportSessionSerializer(session).data)


# ──────────────────────────────────────────────────
# Desktop API Integration endpoints
# ──────────────────────────────────────────────────

class DesktopReprintListView(DesktopAPIView):
    """
    GET /desktop/reprints/ — Fetch all CONFIRMED reprint requests for this key's org.
    """
    def get(self, request):
        api_key = self.get_api_key(request)
        requests = ReprintRequest.objects.filter(
            organization=api_key.organization,
            status=ReprintStatus.CONFIRMED
        ).select_related('card', 'table')

        results = []
        for r in requests:
            results.append({
                'id': str(r.id),
                'card_id': str(r.card.id),
                'display_id': r.card.display_id,
                'table_id': str(r.table_id),
                'data': r.card.data,
                'status': r.status
            })

        return Response({'count': len(results), 'results': results})


class DesktopReprintImageMetaView(DesktopAPIView):
    """
    GET /desktop/reprints/<request_id>/images/ — Fetch all media file metas for reprint request card.
    """
    def get(self, request, pk):
        api_key = self.get_api_key(request)
        try:
            reprint_req = ReprintRequest.objects.get(id=pk, organization=api_key.organization)
        except ReprintRequest.DoesNotExist:
            raise NotFound("Reprint request not found.")

        media_references = MediaReference.objects.filter(card=reprint_req.card).select_related('media_file')
        media_files = [ref.media_file for ref in media_references if not ref.media_file.is_deleted]

        return Response(MediaFileMetaSerializer(media_files, many=True).data)


class DesktopReprintMarkPrintedView(DesktopAPIView):
    """
    POST /desktop/reprints/printed/ — Mark requests as PRINTED.
    """
    def post(self, request):
        api_key = self.get_api_key(request)
        request_ids = request.data.get('reprint_request_ids', [])
        if isinstance(request_ids, str):
            request_ids = [request_ids]
        if not request_ids:
            raise ValidationError("reprint_request_ids is required.")

        requests = ReprintRequest.objects.filter(
            id__in=request_ids,
            organization=api_key.organization,
            status=ReprintStatus.CONFIRMED
        )

        updated_count = 0
        # For Desktop API, set printed_by = api_key.created_by (if exists) or None
        printed_by = api_key.created_by

        for r in requests:
            ReprintService.mark_reprint_printed(r, printed_by)
            updated_count += 1

        return Response({'status': 'success', 'updated_count': updated_count})
