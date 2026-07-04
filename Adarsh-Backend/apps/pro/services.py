"""
Pro User Platform Services — Phase 13

All mutating operations require the actor to be PRO_USER.
"""
import hashlib
import json
import logging
import tempfile
import os
import zipfile
from io import BytesIO
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.pro.models import (
    ImpersonationSession, ImpersonationAudit,
    MaintenanceMode, Announcement, FeatureFlag, ClientFeatureFlag,
    StatisticsSnapshot, BackupSession, BackupArtifact,
)
from apps.pro.constants import (
    ProAuditEvent, MaintenanceScope, FeatureFlagKey, BackupStatus,
)
from apps.auditlogs.models import AuditLog
from shared.constants import Role

logger = logging.getLogger(__name__)


def _require_pro(user):
    if user.role != Role.PRO_USER:
        raise PermissionDenied("This action requires PRO_USER role.")


def _audit(event_type, actor, target_user=None, target_org=None, details=None, ip=None):
    AuditLog.objects.create(
        event_type=event_type,
        actor=actor,
        target_user=target_user,
        target_organization=target_org,
        details=details or {},
        ip_address=ip,
    )


# ──────────────────────────────────────────────────
# Impersonation Service
# ──────────────────────────────────────────────────

class ImpersonationService:

    @staticmethod
    @transaction.atomic
    def start_impersonation(pro_user, target_user, reason='', ip_address=None, user_agent=''):
        _require_pro(pro_user)

        if target_user.role == Role.PRO_USER:
            raise ValidationError("PRO_USER cannot impersonate another PRO_USER.")

        # End any existing active session for this pro_user → target_user pair
        ImpersonationSession.objects.filter(
            pro_user=pro_user, target_user=target_user, is_active=True
        ).update(is_active=False, ended_at=timezone.now())

        session = ImpersonationSession.objects.create(
            pro_user=pro_user,
            target_user=target_user,
            reason=reason,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        ImpersonationAudit.objects.create(
            session=session,
            event_type='START',
            detail={
                'target_user_id': str(target_user.id),
                'target_role': target_user.role,
                'reason': reason,
            }
        )
        _audit(
            ProAuditEvent.IMPERSONATION_START, pro_user,
            target_user=target_user,
            details={'session_id': str(session.id), 'reason': reason},
            ip=ip_address,
        )
        return session

    @staticmethod
    @transaction.atomic
    def end_impersonation(session_id, pro_user):
        _require_pro(pro_user)
        try:
            session = ImpersonationSession.objects.get(id=session_id, pro_user=pro_user, is_active=True)
        except ImpersonationSession.DoesNotExist:
            raise ValidationError("Active impersonation session not found.")

        session.is_active = False
        session.ended_at = timezone.now()
        session.save(update_fields=['is_active', 'ended_at'])

        ImpersonationAudit.objects.create(
            session=session,
            event_type='END',
            detail={'ended_at': session.ended_at.isoformat()},
        )
        _audit(
            ProAuditEvent.IMPERSONATION_END, pro_user,
            target_user=session.target_user,
            details={'session_id': str(session.id)},
        )
        return session

    @staticmethod
    def get_active_sessions(pro_user):
        _require_pro(pro_user)
        return ImpersonationSession.objects.filter(pro_user=pro_user, is_active=True).select_related('target_user')


# ──────────────────────────────────────────────────
# Client Activation Service
# ──────────────────────────────────────────────────

class ClientActivationService:

    @staticmethod
    @transaction.atomic
    def activate_client(pro_user, organization):
        """Re-enable a deactivated client organisation and all its users."""
        _require_pro(pro_user)
        from apps.users.models import User
        User.objects.filter(organization=organization).update(is_active=True)
        organization.is_deleted = False
        organization.save(update_fields=['is_deleted'])
        _audit(
            ProAuditEvent.CLIENT_ACTIVATED, pro_user,
            target_org=organization,
            details={'organization_id': str(organization.id)},
        )

    @staticmethod
    @transaction.atomic
    def deactivate_client(pro_user, organization):
        """
        Disable all users under this organisation so they cannot log in.
        Data remains completely untouched.
        """
        _require_pro(pro_user)
        from apps.users.models import User
        # Never deactivate the PRO_USER themselves
        User.objects.filter(organization=organization).exclude(role=Role.PRO_USER).update(is_active=False)
        _audit(
            ProAuditEvent.CLIENT_DEACTIVATED, pro_user,
            target_org=organization,
            details={'organization_id': str(organization.id)},
        )


# ──────────────────────────────────────────────────
# Maintenance Mode Service
# ──────────────────────────────────────────────────

class MaintenanceModeService:

    @staticmethod
    def enable_global(pro_user, message=''):
        _require_pro(pro_user)
        # Deactivate any existing global maintenance first
        MaintenanceMode.objects.filter(scope=MaintenanceScope.GLOBAL, is_active=True).update(
            is_active=False, deactivated_at=timezone.now()
        )
        m = MaintenanceMode.objects.create(
            scope=MaintenanceScope.GLOBAL,
            message=message,
            is_active=True,
            created_by=pro_user,
        )
        _audit(ProAuditEvent.MAINTENANCE_ENABLED, pro_user, details={'scope': 'GLOBAL', 'message': message})
        return m

    @staticmethod
    def enable_per_client(pro_user, organization, message=''):
        _require_pro(pro_user)
        MaintenanceMode.objects.filter(
            scope=MaintenanceScope.PER_CLIENT, target_organization=organization, is_active=True
        ).update(is_active=False, deactivated_at=timezone.now())
        m = MaintenanceMode.objects.create(
            scope=MaintenanceScope.PER_CLIENT,
            target_organization=organization,
            message=message,
            is_active=True,
            created_by=pro_user,
        )
        _audit(ProAuditEvent.MAINTENANCE_ENABLED, pro_user,
               target_org=organization,
               details={'scope': 'PER_CLIENT', 'org_id': str(organization.id)})
        return m

    @staticmethod
    def disable(pro_user, maintenance_id):
        _require_pro(pro_user)
        try:
            m = MaintenanceMode.objects.get(id=maintenance_id, is_active=True)
        except MaintenanceMode.DoesNotExist:
            raise ValidationError("Maintenance mode not found or already inactive.")
        m.is_active = False
        m.deactivated_at = timezone.now()
        m.save(update_fields=['is_active', 'deactivated_at'])
        _audit(ProAuditEvent.MAINTENANCE_DISABLED, pro_user, details={'maintenance_id': str(maintenance_id)})
        return m

    @staticmethod
    def is_in_maintenance(user, organization=None) -> bool:
        """
        Check if the user/org is currently under maintenance.
        PRO_USER always bypasses maintenance.
        """
        if user.role == Role.PRO_USER:
            return False
        # Global maintenance
        if MaintenanceMode.objects.filter(scope=MaintenanceScope.GLOBAL, is_active=True).exists():
            return True
        # Per-client maintenance
        if organization and MaintenanceMode.objects.filter(
            scope=MaintenanceScope.PER_CLIENT,
            target_organization=organization,
            is_active=True
        ).exists():
            return True
        return False

    @staticmethod
    def get_active():
        return MaintenanceMode.objects.filter(is_active=True).select_related('target_organization')


# ──────────────────────────────────────────────────
# Announcement Service
# ──────────────────────────────────────────────────

class AnnouncementService:

    @staticmethod
    def create(pro_user, title, body, target_type='GLOBAL', target_organization=None,
               is_pinned=False, expires_at=None):
        _require_pro(pro_user)
        a = Announcement.objects.create(
            title=title,
            body=body,
            target_type=target_type,
            target_organization=target_organization,
            is_pinned=is_pinned,
            expires_at=expires_at,
            created_by=pro_user,
            is_active=True,
        )
        _audit(ProAuditEvent.ANNOUNCEMENT_CREATED, pro_user,
               target_org=target_organization,
               details={'announcement_id': str(a.id), 'title': title})
        return a

    @staticmethod
    def deactivate(pro_user, announcement_id):
        _require_pro(pro_user)
        try:
            a = Announcement.objects.get(id=announcement_id, is_active=True)
        except Announcement.DoesNotExist:
            raise ValidationError("Announcement not found.")
        a.is_active = False
        a.save(update_fields=['is_active'])
        _audit(ProAuditEvent.ANNOUNCEMENT_DELETED, pro_user, details={'announcement_id': str(announcement_id)})
        return a

    @staticmethod
    def get_active(organization=None):
        """Return active non-expired announcements for this org (or global)."""
        now = timezone.now()
        qs = Announcement.objects.filter(is_active=True).filter(
            models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=now)
        )
        if organization:
            qs = qs.filter(
                models.Q(target_type='GLOBAL') |
                models.Q(target_type='ORGANIZATION', target_organization=organization) |
                models.Q(target_type='CLIENT', target_organization=organization)
            )
        return qs.order_by('-is_pinned', '-created_at')


# ──────────────────────────────────────────────────
# Feature Flag Service
# ──────────────────────────────────────────────────

class FeatureFlagService:

    @staticmethod
    def bootstrap_defaults(pro_user):
        """Create default flags for all known feature flag keys (idempotent)."""
        _require_pro(pro_user)
        labels = {
            FeatureFlagKey.IMPORTS: 'Import System',
            FeatureFlagKey.EXPORTS: 'Export System',
            FeatureFlagKey.SANDBOX: 'Sandbox Mode',
            FeatureFlagKey.MOBILE_ACCESS: 'Mobile Access',
            FeatureFlagKey.DESKTOP_API: 'Desktop API',
            FeatureFlagKey.WORKFLOW: 'Workflow Engine',
            FeatureFlagKey.NOTIFICATIONS: 'Notifications',
        }
        created = []
        for key, label in labels.items():
            flag, made = FeatureFlag.objects.get_or_create(key=key, defaults={'label': label, 'is_enabled': True})
            if made:
                created.append(flag)
        return created

    @staticmethod
    def set_global(pro_user, key, is_enabled):
        _require_pro(pro_user)
        flag, _ = FeatureFlag.objects.get_or_create(key=key, defaults={'label': key, 'is_enabled': True})
        flag.is_enabled = is_enabled
        flag.updated_by = pro_user
        flag.save(update_fields=['is_enabled', 'updated_by', 'updated_at'])
        
        # Invalidate cache
        from django.core.cache import cache
        cache.delete(f"feature_flag:{key}:global")
        if hasattr(cache, 'delete_pattern'):
            cache.delete_pattern(f"feature_flag:{key}:*")
        else:
            cache.clear()
            
        _audit(ProAuditEvent.FEATURE_FLAG_CHANGED, pro_user,
               details={'key': key, 'is_enabled': is_enabled, 'scope': 'global'})
        return flag

    @staticmethod
    def set_for_client(pro_user, key, organization, is_enabled):
        _require_pro(pro_user)
        flag, _ = FeatureFlag.objects.get_or_create(key=key, defaults={'label': key, 'is_enabled': True})
        override, _ = ClientFeatureFlag.objects.update_or_create(
            feature_flag=flag,
            organization=organization,
            defaults={'is_enabled': is_enabled, 'updated_by': pro_user},
        )
        
        # Invalidate cache
        from django.core.cache import cache
        cache.delete(f"feature_flag:{key}:{organization.id}")
        cache.delete(f"feature_flag:{key}:global")
        
        _audit(ProAuditEvent.FEATURE_FLAG_CHANGED, pro_user,
               target_org=organization,
               details={'key': key, 'is_enabled': is_enabled, 'scope': 'client', 'org_id': str(organization.id)})
        return override

    @staticmethod
    def is_enabled(key, organization=None) -> bool:
        """Check if a feature is enabled globally or for the given org."""
        from django.core.cache import cache
        org_id = str(organization.id) if organization else 'global'
        cache_key = f"feature_flag:{key}:{org_id}"
        
        cached_val = cache.get(cache_key)
        if cached_val is not None:
            return cached_val
            
        try:
            flag = FeatureFlag.objects.get(key=key)
        except FeatureFlag.DoesNotExist:
            res = True
            cache.set(cache_key, res, timeout=600)
            return res

        if organization:
            try:
                override = ClientFeatureFlag.objects.get(feature_flag=flag, organization=organization)
                res = override.is_enabled
                cache.set(cache_key, res, timeout=600)
                return res
            except ClientFeatureFlag.DoesNotExist:
                pass
        res = flag.is_enabled
        cache.set(cache_key, res, timeout=600)
        return res

    @staticmethod
    def get_all_for_client(organization):
        flags = FeatureFlag.objects.all()
        overrides = {
            o.feature_flag_id: o.is_enabled
            for o in ClientFeatureFlag.objects.filter(organization=organization)
        }
        result = []
        for f in flags:
            result.append({
                'key': f.key,
                'label': f.label,
                'global_enabled': f.is_enabled,
                'client_enabled': overrides.get(f.id, f.is_enabled),
                'has_override': f.id in overrides,
            })
        return result


# ──────────────────────────────────────────────────
# Statistics Service
# ──────────────────────────────────────────────────

class StatisticsService:

    @staticmethod
    def generate_snapshot() -> StatisticsSnapshot:
        """
        Collect platform-wide statistics and persist a snapshot.
        Heavy — run via Celery beat.
        """
        from apps.organizations.models import Organization
        from apps.users.models import User
        from apps.tables.models import Table
        from apps.fields.models import Field
        from apps.cards.models import Card
        from apps.imports.models import ImportSession
        from apps.exports.models import ExportSession
        from apps.mediafiles.models import MediaFile
        from apps.jobs.models import Job
        from apps.sandbox.models import SandboxSession

        orgs = Organization.objects.filter(is_deleted=False)
        clients = User.objects.filter(role=Role.CLIENT, is_deleted=False)
        users = User.objects.filter(is_deleted=False)

        # Storage: sum of all media file sizes
        storage_bytes = MediaFile.objects.aggregate(
            total=models.Sum('file_size')
        )['total'] or 0

        # Breakdown per org
        breakdown = {}
        for org in orgs:
            breakdown[str(org.id)] = {
                'name': org.name,
                'cards': Card.objects.filter(organization=org).count(),
                'tables': Table.objects.filter(organization=org, is_deleted=False).count(),
                'users': User.objects.filter(organization=org).count(),
            }

        snap = StatisticsSnapshot.objects.create(
            total_organizations=orgs.count(),
            total_clients=clients.count(),
            total_users=users.count(),
            total_tables=Table.objects.filter(is_deleted=False).count(),
            total_fields=Field.objects.filter(is_deleted=False).count(),
            total_cards=Card.objects.count(),
            total_imports=ImportSession.objects.count(),
            total_exports=ExportSession.objects.count(),
            total_media=MediaFile.objects.count(),
            total_jobs=Job.objects.count(),
            active_sandbox_sessions=SandboxSession.objects.filter(is_active=True).count(),
            storage_bytes=storage_bytes,
            breakdown=breakdown,
        )
        return snap

    @staticmethod
    def latest() -> StatisticsSnapshot:
        return StatisticsSnapshot.objects.first()

    @staticmethod
    def platform_summary() -> dict:
        snap = StatisticsService.latest()
        if not snap:
            return {}
        return {
            'snapshot_at': snap.snapshot_at,
            'organizations': snap.total_organizations,
            'clients': snap.total_clients,
            'users': snap.total_users,
            'cards': snap.total_cards,
            'tables': snap.total_tables,
            'imports': snap.total_imports,
            'exports': snap.total_exports,
            'storage_bytes': snap.storage_bytes,
            'active_sandbox_sessions': snap.active_sandbox_sessions,
        }


# ──────────────────────────────────────────────────
# Backup Service
# ──────────────────────────────────────────────────

class BackupService:

    @staticmethod
    def create_backup(pro_user, organization=None) -> BackupSession:
        """
        Create a ZIP backup of:
          - All card data (JSON)
          - Table/field metadata (JSON)
          - Import/export session metadata (JSON)
        Does NOT restore — restore is future work.
        Heavy — run via Celery.
        """
        _require_pro(pro_user)
        from apps.pro.constants import BackupScope
        scope = BackupScope.ORGANIZATION if organization else BackupScope.CLIENT

        backup_session = BackupSession.objects.create(
            scope=scope,
            target_organization=organization,
            status=BackupStatus.PENDING,
            created_by=pro_user,
        )

        try:
            backup_session.status = BackupStatus.PROCESSING
            backup_session.started_at = timezone.now()
            backup_session.save(update_fields=['status', 'started_at'])

            data = BackupService._collect_data(organization)
            zip_bytes, checksum = BackupService._build_zip(data)

            # Store via storage backend
            from apps.mediafiles.storage.factory import StorageFactory
            import uuid as _uuid
            uid = str(_uuid.uuid4())
            org_label = str(organization.id) if organization else 'platform'
            filename = f"backup_{org_label}_{uid[:8]}.zip"
            stored_path = f"backups/{uid[:2]}/{uid[2:4]}/{filename}"
            StorageFactory.get_storage().save(stored_path, BytesIO(zip_bytes))

            completed = timezone.now()
            backup_session.status = BackupStatus.COMPLETED
            backup_session.completed_at = completed
            if backup_session.started_at:
                backup_session.duration = (completed - backup_session.started_at).total_seconds()
            backup_session.save(update_fields=['status', 'completed_at', 'duration'])

            BackupArtifact.objects.create(
                backup_session=backup_session,
                file_name=filename,
                stored_path=stored_path,
                file_size=len(zip_bytes),
                checksum=checksum,
            )

            _audit(ProAuditEvent.BACKUP_CREATED, pro_user,
                   target_org=organization,
                   details={'backup_session_id': str(backup_session.id), 'file_size': len(zip_bytes)})

        except Exception as exc:
            backup_session.status = BackupStatus.FAILED
            backup_session.error_message = str(exc)
            backup_session.completed_at = timezone.now()
            backup_session.save(update_fields=['status', 'error_message', 'completed_at'])
            raise

        return backup_session

    @staticmethod
    def _collect_data(organization=None) -> dict:
        """Gather all data for backup as serialisable dicts."""
        from apps.organizations.models import Organization
        from apps.tables.models import Table
        from apps.fields.models import Field
        from apps.cards.models import Card
        from apps.imports.models import ImportSession
        from apps.exports.models import ExportSession

        if organization:
            orgs = Organization.objects.filter(id=organization.id)
        else:
            orgs = Organization.objects.filter(is_deleted=False)

        org_ids = list(orgs.values_list('id', flat=True))
        org_ids_str = [str(i) for i in org_ids]

        tables = list(Table.objects.filter(organization_id__in=org_ids).values())
        table_ids = [t['id'] for t in tables]

        fields = list(Field.objects.filter(table_id__in=table_ids).values())
        cards = list(Card.objects.filter(organization_id__in=org_ids).values())
        imports = list(ImportSession.objects.filter(organization_id__in=org_ids).values())
        exports = list(ExportSession.objects.filter(organization_id__in=org_ids).values())

        # Serialize UUIDs/datetimes
        def serialise(lst):
            return json.loads(json.dumps(lst, default=str))

        return {
            'organizations': [{'id': str(o.id), 'name': o.name} for o in orgs],
            'tables': serialise(tables),
            'fields': serialise(fields),
            'cards': serialise(cards),
            'imports': serialise(imports),
            'exports': serialise(exports),
        }

    @staticmethod
    def _build_zip(data: dict):
        """Build ZIP bytes and compute SHA-256 checksum."""
        buf = BytesIO()
        with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            for key, records in data.items():
                content = json.dumps(records, indent=2, default=str).encode('utf-8')
                zf.writestr(f'{key}.json', content)
        zip_bytes = buf.getvalue()
        checksum = hashlib.sha256(zip_bytes).hexdigest()
        return zip_bytes, checksum

    @staticmethod
    def download(pro_user, backup_session_id):
        _require_pro(pro_user)
        try:
            session = BackupSession.objects.get(id=backup_session_id, status=BackupStatus.COMPLETED)
            artifact = session.artifact
        except (BackupSession.DoesNotExist, BackupArtifact.DoesNotExist):
            raise ValidationError("Backup not found or not completed.")

        from apps.mediafiles.storage.factory import StorageFactory
        data = StorageFactory.get_storage().read(artifact.stored_path)

        artifact.download_count += 1
        artifact.last_downloaded_at = timezone.now()
        artifact.save(update_fields=['download_count', 'last_downloaded_at'])

        _audit(ProAuditEvent.BACKUP_DOWNLOADED, pro_user,
               details={'backup_session_id': str(backup_session_id), 'file_name': artifact.file_name})
        return data, artifact.file_name


# ──────────────────────────────────────────────────
# Audit Dashboard Service
# ──────────────────────────────────────────────────

class AuditDashboardService:

    @staticmethod
    def get_logs(pro_user, organization_id=None, user_id=None,
                 event_type=None, date_from=None, date_to=None,
                 limit=100, offset=0):
        _require_pro(pro_user)
        qs = AuditLog.objects.all().select_related('actor', 'target_user', 'target_organization')
        if organization_id:
            qs = qs.filter(target_organization_id=organization_id)
        if user_id:
            qs = qs.filter(models.Q(actor_id=user_id) | models.Q(target_user_id=user_id))
        if event_type:
            qs = qs.filter(event_type=event_type)
        if date_from:
            qs = qs.filter(created_at__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__lte=date_to)
        total = qs.count()
        records = list(qs.order_by('-created_at')[offset:offset + limit])
        return {'total': total, 'records': records}


# Import models.Q for use within services
from django.db import models
