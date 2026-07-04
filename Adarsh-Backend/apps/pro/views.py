"""
Pro User Platform — API Views

All views enforce PRO_USER role at the service layer.
Standard users receive 403 via _require_pro().
"""
import logging
from django.http import HttpResponse
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import ValidationError, NotFound

from apps.pro.services import (
    ImpersonationService,
    ClientActivationService,
    MaintenanceModeService,
    AnnouncementService,
    FeatureFlagService,
    StatisticsService,
    BackupService,
    AuditDashboardService,
)
from apps.pro.models import (
    ImpersonationSession, MaintenanceMode, Announcement,
    FeatureFlag, ClientFeatureFlag, StatisticsSnapshot,
    BackupSession,
)
from apps.pro.serializers import (
    ImpersonationSessionSerializer, MaintenanceModeSerializer,
    AnnouncementSerializer, FeatureFlagSerializer,
    StatisticsSnapshotSerializer, BackupSessionSerializer,
)
from apps.pro.constants import BackupStatus
from apps.organizations.models import Organization
from apps.users.models import User

logger = logging.getLogger(__name__)


def _get_org(org_id):
    try:
        return Organization.objects.get(id=org_id)
    except Organization.DoesNotExist:
        raise NotFound("Organization not found.")


# ─── Impersonation ────────────────────────────────────────────────────────────

class ImpersonationStartView(APIView):
    """POST /pro/impersonate/start/"""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        target_user_id = request.data.get('target_user_id')
        reason = request.data.get('reason', '')
        if not target_user_id:
            raise ValidationError("target_user_id is required.")
        try:
            target = User.objects.get(id=target_user_id)
        except User.DoesNotExist:
            raise NotFound("Target user not found.")
        ip = request.META.get('REMOTE_ADDR')
        ua = request.META.get('HTTP_USER_AGENT', '')
        session = ImpersonationService.start_impersonation(request.user, target, reason, ip, ua)
        return Response(ImpersonationSessionSerializer(session).data, status=status.HTTP_201_CREATED)


class ImpersonationEndView(APIView):
    """POST /pro/impersonate/<session_id>/end/"""
    permission_classes = [IsAuthenticated]

    def post(self, request, session_id):
        session = ImpersonationService.end_impersonation(session_id, request.user)
        return Response(ImpersonationSessionSerializer(session).data)


class ImpersonationListView(APIView):
    """GET /pro/impersonate/ — List active sessions for this PRO_USER"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        sessions = ImpersonationService.get_active_sessions(request.user)
        return Response(ImpersonationSessionSerializer(sessions, many=True).data)


# ─── Client Activation ────────────────────────────────────────────────────────

class ClientActivationView(APIView):
    """
    POST /pro/clients/<org_id>/activate/
    POST /pro/clients/<org_id>/deactivate/
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, org_id, action):
        org = _get_org(org_id)
        if action == 'activate':
            ClientActivationService.activate_client(request.user, org)
            return Response({'detail': f'Organization {org.name} activated.'})
        elif action == 'deactivate':
            ClientActivationService.deactivate_client(request.user, org)
            return Response({'detail': f'Organization {org.name} deactivated.'})
        raise ValidationError("Action must be 'activate' or 'deactivate'.")


# ─── Maintenance Mode ─────────────────────────────────────────────────────────

class MaintenanceModeListView(APIView):
    """
    GET  /pro/maintenance/           — List active maintenance modes
    POST /pro/maintenance/global/    — Enable global maintenance
    POST /pro/maintenance/client/    — Enable per-client maintenance
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        modes = MaintenanceModeService.get_active()
        return Response(MaintenanceModeSerializer(modes, many=True).data)

    def post(self, request):
        scope = request.data.get('scope', 'GLOBAL')
        message = request.data.get('message', '')
        if scope == 'GLOBAL':
            m = MaintenanceModeService.enable_global(request.user, message)
        elif scope == 'PER_CLIENT':
            org_id = request.data.get('organization_id')
            if not org_id:
                raise ValidationError("organization_id is required for PER_CLIENT scope.")
            m = MaintenanceModeService.enable_per_client(request.user, _get_org(org_id), message)
        else:
            raise ValidationError("scope must be GLOBAL or PER_CLIENT.")
        return Response(MaintenanceModeSerializer(m).data, status=status.HTTP_201_CREATED)


class MaintenanceModeDisableView(APIView):
    """DELETE /pro/maintenance/<id>/"""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        m = MaintenanceModeService.disable(request.user, pk)
        return Response(MaintenanceModeSerializer(m).data)


# ─── Announcements ────────────────────────────────────────────────────────────

class AnnouncementListView(APIView):
    """
    GET  /pro/announcements/  — All active announcements
    POST /pro/announcements/  — Create announcement
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = AnnouncementService.get_active()
        return Response(AnnouncementSerializer(qs, many=True).data)

    def post(self, request):
        target_type = request.data.get('target_type', 'GLOBAL')
        org_id = request.data.get('organization_id')
        org = _get_org(org_id) if org_id else None
        a = AnnouncementService.create(
            request.user,
            title=request.data.get('title', ''),
            body=request.data.get('body', ''),
            target_type=target_type,
            target_organization=org,
            is_pinned=request.data.get('is_pinned', False),
            expires_at=request.data.get('expires_at'),
        )
        return Response(AnnouncementSerializer(a).data, status=status.HTTP_201_CREATED)


class AnnouncementDeactivateView(APIView):
    """DELETE /pro/announcements/<id>/"""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        a = AnnouncementService.deactivate(request.user, pk)
        return Response(AnnouncementSerializer(a).data)


# ─── Feature Flags ────────────────────────────────────────────────────────────

class FeatureFlagListView(APIView):
    """
    GET   /pro/flags/                  — All global flags
    PATCH /pro/flags/<key>/            — Set global flag
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        flags = FeatureFlag.objects.all()
        return Response(FeatureFlagSerializer(flags, many=True).data)

    def patch(self, request, key):
        is_enabled = request.data.get('is_enabled')
        if is_enabled is None:
            raise ValidationError("is_enabled is required.")
        flag = FeatureFlagService.set_global(request.user, key, bool(is_enabled))
        return Response(FeatureFlagSerializer(flag).data)


class ClientFeatureFlagView(APIView):
    """
    GET   /pro/flags/<org_id>/client/  — All flags for this client
    PATCH /pro/flags/<org_id>/client/  — Set per-client flag
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, org_id):
        org = _get_org(org_id)
        result = FeatureFlagService.get_all_for_client(org)
        return Response(result)

    def patch(self, request, org_id):
        org = _get_org(org_id)
        key = request.data.get('key')
        is_enabled = request.data.get('is_enabled')
        if not key or is_enabled is None:
            raise ValidationError("key and is_enabled are required.")
        override = FeatureFlagService.set_for_client(request.user, key, org, bool(is_enabled))
        return Response({'key': key, 'is_enabled': override.is_enabled})


# ─── Statistics ───────────────────────────────────────────────────────────────

class StatisticsView(APIView):
    """
    GET  /pro/statistics/          — Latest snapshot summary
    POST /pro/statistics/generate/ — Trigger new snapshot
    GET  /pro/statistics/history/  — All snapshots
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        summary = StatisticsService.platform_summary()
        return Response(summary)

    def post(self, request):
        snap = StatisticsService.generate_snapshot()
        return Response(StatisticsSnapshotSerializer(snap).data, status=status.HTTP_201_CREATED)


class StatisticsHistoryView(APIView):
    """GET /pro/statistics/history/"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        snaps = StatisticsSnapshot.objects.all()[:20]
        return Response(StatisticsSnapshotSerializer(snaps, many=True).data)


# ─── Audit Dashboard ──────────────────────────────────────────────────────────

class AuditDashboardView(APIView):
    """GET /pro/audit/"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.auditlogs.models import AuditLog
        params = request.query_params
        result = AuditDashboardService.get_logs(
            pro_user=request.user,
            organization_id=params.get('organization_id'),
            user_id=params.get('user_id'),
            event_type=params.get('event_type'),
            date_from=params.get('date_from'),
            date_to=params.get('date_to'),
            limit=int(params.get('limit', 100)),
            offset=int(params.get('offset', 0)),
        )
        records = result.pop('records')
        from apps.auditlogs.serializers import AuditLogSerializer
        return Response({**result, 'results': AuditLogSerializer(records, many=True).data})


# ─── Backup ───────────────────────────────────────────────────────────────────

class BackupListView(APIView):
    """
    GET  /pro/backups/              — List backups
    POST /pro/backups/              — Create backup
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        sessions = BackupSession.objects.select_related('artifact', 'target_organization').all()[:50]
        return Response(BackupSessionSerializer(sessions, many=True).data)

    def post(self, request):
        org_id = request.data.get('organization_id')
        org = _get_org(org_id) if org_id else None
        session = BackupService.create_backup(request.user, org)
        return Response(BackupSessionSerializer(session).data, status=status.HTTP_201_CREATED)


class BackupDownloadView(APIView):
    """GET /pro/backups/<id>/download/"""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        data, filename = BackupService.download(request.user, pk)
        response = HttpResponse(data, content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


# ─── Dashboard ────────────────────────────────────────────────────────────────

class ProDashboardView(APIView):
    """GET /pro/dashboard/ — Platform health summary"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.pro.services import _require_pro
        _require_pro(request.user)

        from django.core.cache import cache
        cache_key = "pro_dashboard_data"
        cached_response = cache.get(cache_key)
        if cached_response is not None:
            return Response(cached_response)

        from apps.jobs.models import Job, JobStatus
        from apps.imports.models import ImportSession
        from apps.exports.models import ExportSession
        from apps.mediafiles.models import MediaFile

        stats = StatisticsService.platform_summary()
        recent_imports = list(ImportSession.objects.order_by('-created_at')[:5].values(
            'id', 'status', 'total_rows', 'success_rows', 'failed_rows', 'created_at'
        ))
        recent_exports = list(ExportSession.objects.order_by('-created_at')[:5].values(
            'id', 'export_type', 'status', 'record_count', 'created_at'
        ))
        failed_jobs = list(Job.objects.filter(status=JobStatus.FAILED).order_by('-created_at')[:10].values(
            'id', 'type', 'status', 'error_details', 'created_at'
        ))
        recent_backups = BackupSessionSerializer(
            BackupSession.objects.select_related('artifact').order_by('-created_at')[:5], many=True
        ).data
        active_announcements = AnnouncementSerializer(
            AnnouncementService.get_active(), many=True
        ).data
        maintenance = MaintenanceModeSerializer(
            MaintenanceModeService.get_active(), many=True
        ).data

        response_data = {
            'statistics': stats,
            'recent_imports': recent_imports,
            'recent_exports': recent_exports,
            'failed_jobs': failed_jobs,
            'recent_backups': recent_backups,
            'active_announcements': active_announcements,
            'maintenance_status': maintenance,
        }
        
        # Cache for 60 seconds
        cache.set(cache_key, response_data, timeout=60)
        return Response(response_data)
