"""
Desktop Integration API Views — Phase 15

Two authentication paths:
  1. JWT (IsAuthenticated) — admin endpoints for key management
  2. X-Desktop-Key header (DesktopKeyAuthentication) — all desktop data endpoints

Desktop views use a custom mixin that enforces key-based auth and org scoping.
"""
import logging
from django.http import HttpResponse
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import ValidationError, NotFound, PermissionDenied

from apps.desktop_sync.authentication import DesktopKeyAuthentication
from apps.desktop_sync.throttling import DesktopRateThrottle
from apps.desktop_sync.models import DesktopApiKey, DesktopSyncSession
from apps.desktop_sync.serializers import (
    DesktopApiKeySerializer, DesktopAccessLogSerializer,
    DesktopSyncSessionSerializer, MediaFileMetaSerializer,
    DesktopCardSerializer,
)
from apps.desktop_sync.services import (
    DesktopKeyService, DesktopDataService,
    DesktopImageService, DesktopWorkflowService,
    DesktopSyncService,
)
from apps.tables.models import Table
from apps.fields.models import Field

logger = logging.getLogger(__name__)


# ─── Desktop-key auth mixin ───────────────────────────────────────────────────

class DesktopAPIView(APIView):
    """Base view for all desktop data endpoints. Validates X-Desktop-Key."""
    authentication_classes = [DesktopKeyAuthentication]
    permission_classes = []   # No Django User permission required
    throttle_classes = [DesktopRateThrottle]

    def get_api_key(self, request) -> DesktopApiKey:
        if not isinstance(request.user, DesktopApiKey):
            raise PermissionDenied("Valid X-Desktop-Key header is required.")
        return request.user

    def get_ip(self, request) -> str:
        return request.META.get('REMOTE_ADDR')


# ─── Key Management (JWT-authed, admin/client only) ───────────────────────────

class DesktopKeyListView(APIView):
    """
    GET  /desktop/keys/         — List all keys for the current org
    POST /desktop/keys/         — Create new key
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        keys = DesktopKeyService.list_keys(request.user.organization)
        return Response(DesktopApiKeySerializer(keys, many=True).data)

    def post(self, request):
        name = request.data.get('name', '').strip()
        if not name:
            raise ValidationError("name is required.")
        instance, raw_key = DesktopKeyService.create_key(
            organization=request.user.organization,
            name=name,
            created_by=request.user,
        )
        data = DesktopApiKeySerializer(instance).data
        data['raw_key'] = raw_key   # one-time only
        return Response(data, status=status.HTTP_201_CREATED)


class DesktopKeyDetailView(APIView):
    """DELETE /desktop/keys/<id>/ — Revoke key"""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        key = DesktopKeyService.revoke_key(str(pk), request.user)
        return Response({'detail': f'Key "{key.name}" revoked.'})


# ─── Desktop Authentication Check ─────────────────────────────────────────────

class DesktopVerifyView(DesktopAPIView):
    """GET /desktop/verify/ — Ping to confirm key is valid."""
    def get(self, request):
        api_key = self.get_api_key(request)
        DesktopKeyService.verify_key(api_key, ip=self.get_ip(request))
        return Response({
            'valid': True,
            'key_name': api_key.name,
            'organization': api_key.organization.name,
        })


# ─── Table Endpoints ──────────────────────────────────────────────────────────

class DesktopTableListView(DesktopAPIView):
    """GET /desktop/tables/"""
    def get(self, request):
        api_key = self.get_api_key(request)
        tables = DesktopDataService.list_tables(api_key, ip=self.get_ip(request))
        data = [{'id': str(t.id), 'name': t.name, 'description': ""}
                for t in tables]
        return Response({'results': data, 'count': len(data)})


class DesktopTableMetaView(DesktopAPIView):
    """GET /desktop/tables/<table_id>/metadata/"""
    def get(self, request, table_id):
        api_key = self.get_api_key(request)
        table, fields = DesktopDataService.get_table_metadata(api_key, str(table_id),
                                                              ip=self.get_ip(request))
        fields_data = [{'id': str(f.id), 'name': f.name, 'type': f.type,
                        'display_order': f.display_order} for f in fields]
        return Response({
            'id': str(table.id),
            'name': table.name,
            'fields': fields_data,
        })


# ─── Card Endpoints ───────────────────────────────────────────────────────────

class DesktopCardListView(DesktopAPIView):
    """GET /desktop/tables/<table_id>/cards/"""
    def get(self, request, table_id):
        api_key = self.get_api_key(request)
        params = request.query_params
        cards, total = DesktopDataService.list_cards(
            api_key=api_key,
            table_id=str(table_id),
            status_filter=params.getlist('status') or None,
            search=params.get('search'),
            class_filter=params.get('class'),
            section_filter=params.get('section'),
            branch_filter=params.get('branch'),
            page=int(params.get('page', 1)),
            page_size=min(int(params.get('page_size', 100)), 500),
            ip=self.get_ip(request),
        )
        return Response({
            'count': total,
            'results': DesktopCardSerializer(cards, many=True).data,
        })


class DesktopCardDetailView(DesktopAPIView):
    """GET /desktop/cards/<card_id>/"""
    def get(self, request, card_id):
        api_key = self.get_api_key(request)
        card = DesktopDataService.get_card_detail(api_key, str(card_id), ip=self.get_ip(request))
        return Response(DesktopCardSerializer(card).data)


class DesktopCardDatasetView(DesktopAPIView):
    """GET /desktop/tables/<table_id>/dataset/ — Structured data for mail merge."""
    def get(self, request, table_id):
        api_key = self.get_api_key(request)
        dataset = DesktopDataService.get_card_dataset(api_key, str(table_id), ip=self.get_ip(request))
        return Response({'count': len(dataset), 'results': dataset})


# ─── Image Endpoints ──────────────────────────────────────────────────────────

class DesktopImageMetaView(DesktopAPIView):
    """GET /desktop/cards/<card_id>/images/"""
    def get(self, request, card_id):
        api_key = self.get_api_key(request)
        media_files = DesktopImageService.get_image_metadata(api_key, str(card_id),
                                                             ip=self.get_ip(request))
        return Response(MediaFileMetaSerializer(media_files, many=True).data)


class DesktopImageDownloadView(DesktopAPIView):
    """GET /desktop/images/<media_file_id>/download/"""
    def get(self, request, media_file_id):
        api_key = self.get_api_key(request)
        data, filename, mime_type = DesktopImageService.download_image(
            api_key, str(media_file_id), ip=self.get_ip(request)
        )
        response = HttpResponse(data, content_type=mime_type)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


class DesktopImageBatchView(DesktopAPIView):
    """POST /desktop/images/batch/ — Download ZIP of images for multiple cards."""
    def post(self, request):
        api_key = self.get_api_key(request)
        card_ids = request.data.get('card_ids', [])
        if not card_ids:
            raise ValidationError("card_ids list is required.")
        if len(card_ids) > 500:
            raise ValidationError("Maximum 500 cards per batch.")
        zip_bytes, image_count, total_bytes = DesktopImageService.download_image_batch(
            api_key, card_ids, ip=self.get_ip(request)
        )
        response = HttpResponse(zip_bytes, content_type='application/zip')
        response['Content-Disposition'] = 'attachment; filename="images_batch.zip"'
        response['X-Image-Count'] = str(image_count)
        response['X-Downloaded-Bytes'] = str(total_bytes)
        return response


class DesktopImageReplaceView(DesktopAPIView):
    """POST /desktop/cards/<card_id>/images/replace/"""
    def post(self, request, card_id):
        api_key = self.get_api_key(request)
        field_id = request.data.get('field_id')
        image_file = request.FILES.get('image')
        if not field_id or not image_file:
            raise ValidationError("field_id and image file are required.")
        content = image_file.read()
        media_file = DesktopImageService.replace_image(
            api_key=api_key,
            card_id=str(card_id),
            field_id=field_id,
            file_content=content,
            file_name=image_file.name,
            mime_type=image_file.content_type,
            ip=self.get_ip(request),
        )
        return Response(MediaFileMetaSerializer(media_file).data, status=status.HTTP_200_OK)


# ─── Print / Workflow ─────────────────────────────────────────────────────────

class DesktopPrintRequestView(DesktopAPIView):
    """POST /desktop/print/ — Mark APPROVED cards as DOWNLOADED."""
    def post(self, request):
        api_key = self.get_api_key(request)
        card_ids = request.data.get('card_ids', [])
        if not card_ids:
            raise ValidationError("card_ids is required.")
        result = DesktopWorkflowService.request_print(api_key, card_ids, ip=self.get_ip(request))
        return Response(result)


# ─── Sync Session ─────────────────────────────────────────────────────────────

class DesktopSyncStartView(DesktopAPIView):
    """POST /desktop/sync/start/"""
    def post(self, request):
        api_key = self.get_api_key(request)
        session = DesktopSyncService.start_sync(
            api_key=api_key,
            table_id=request.data.get('table_id'),
            filters=request.data.get('filters', {}),
            ip=self.get_ip(request),
        )
        return Response(DesktopSyncSessionSerializer(session).data, status=status.HTTP_201_CREATED)


class DesktopSyncCompleteView(DesktopAPIView):
    """POST /desktop/sync/<session_id>/complete/"""
    def post(self, request, session_id):
        api_key = self.get_api_key(request)
        session = DesktopSyncService.complete_sync(
            api_key=api_key,
            sync_session_id=str(session_id),
            card_count=request.data.get('card_count', 0),
            image_count=request.data.get('image_count', 0),
            downloaded_bytes=request.data.get('downloaded_bytes', 0),
            ip=self.get_ip(request),
        )
        return Response(DesktopSyncSessionSerializer(session).data)


class DesktopSyncListView(DesktopAPIView):
    """GET /desktop/sync/ — Recent sync sessions."""
    def get(self, request):
        api_key = self.get_api_key(request)
        sessions = DesktopSyncService.list_sessions(api_key)
        return Response(DesktopSyncSessionSerializer(sessions, many=True).data)


# ─── Audit Log (for desktop key) ──────────────────────────────────────────────

class DesktopAccessLogView(DesktopAPIView):
    """GET /desktop/logs/ — Recent access events for this key."""
    def get(self, request):
        api_key = self.get_api_key(request)
        logs = api_key.access_logs.order_by('-timestamp')[:100]
        return Response(DesktopAccessLogSerializer(logs, many=True).data)
