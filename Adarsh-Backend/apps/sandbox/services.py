"""
SandboxResolver — the core rendering engine.

Merges production data + sandbox diffs to produce the sandbox view.
Never reads from production cards for mutation. Never writes to production.

Rendered card shape:
{
    'id': str(uuid),          # real card id OR sandbox-only card id (prefixed 'sb_')
    'display_id': str,
    'table_id': str,
    'organization_id': str,
    'status': str,            # sandbox status (may differ from production)
    'data': dict,             # merged field values
    'is_sandbox_only': bool,  # True for SandboxCardCreate rows
    'is_deleted_in_sandbox': bool,
}
"""
import copy
import logging
from typing import List, Dict, Optional

from apps.sandbox.models import (
    SandboxSession,
    SandboxChange,
    SandboxCardCreate,
    SandboxCardDelete,
    SandboxCardStatus,
    SandboxWorkflowHistory,
    SandboxImportSession,
    SandboxExportSession,
)
from apps.sandbox.constants import (
    SESSION_TTL_DAYS,
    SandboxImportStatus,
    SandboxExportStatus,
)
from apps.cards.models import Card
from apps.fields.models import Field, FieldType
from apps.tables.models import Table
from apps.workflow.constants import TRANSITION_MAP, WorkflowState, WorkflowAction
from apps.auditlogs.models import AuditLog
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

logger = logging.getLogger(__name__)

# Re-use production transition map for sandbox workflow
_SANDBOX_TRANSITION_MAP = TRANSITION_MAP


class SandboxResolver:
    """
    Core rendering engine. Applies all sandbox diffs to the production queryset
    and returns a merged view without touching any production data.
    """

    @staticmethod
    def get_or_create_session(user, device_id: str) -> SandboxSession:
        """Get existing active session for (user, device_id) or create a new one."""
        now = timezone.now()
        session, created = SandboxSession.objects.get_or_create(
            user=user,
            device_id=device_id,
            defaults={
                'organization_id': user.organization_id,
                'expires_at': now + timezone.timedelta(days=SESSION_TTL_DAYS),
                'is_active': True,
            }
        )
        if not created:
            # Re-activate if expired and user explicitly resumes
            if not session.is_active or session.is_expired:
                session.is_active = True
                session.expires_at = now + timezone.timedelta(days=SESSION_TTL_DAYS)
                session.save(update_fields=['is_active', 'expires_at'])
            else:
                session.touch()
        return session

    @staticmethod
    def resolve_cards(session: SandboxSession, table: Table) -> List[Dict]:
        """
        Returns the full merged card list for a given table in the context of this session:
          1. Start with production cards (not real-deleted)
          2. Apply sandbox field changes
          3. Apply sandbox status overrides
          4. Exclude sandbox-deleted production cards
          5. Append sandbox-only created cards
        """
        from apps.workflow.constants import WorkflowState

        # 1. Production cards (non-deleted)
        prod_cards = list(
            Card.objects.filter(table=table)
                        .exclude(status=WorkflowState.DELETED)
                        .select_related('table', 'organization')
        )

        # Pre-build lookup dicts
        deleted_ids = set(
            SandboxCardDelete.objects.filter(session=session, card__table=table)
                             .values_list('card_id', flat=True)
        )
        # field changes: {card_id: {field_id: new_value}}
        raw_changes = SandboxChange.objects.filter(session=session, table=table).values(
            'card_id', 'field_id', 'new_value'
        )
        changes_map: Dict[str, Dict[str, str]] = {}
        for ch in raw_changes:
            cid = str(ch['card_id'])
            fid = str(ch['field_id'])
            changes_map.setdefault(cid, {})[fid] = ch['new_value']

        # status overrides
        status_map: Dict[str, str] = {
            str(sc.card_id): sc.status
            for sc in SandboxCardStatus.objects.filter(session=session, card__table=table)
        }

        merged = []
        for card in prod_cards:
            cid = str(card.id)
            if cid in deleted_ids:
                continue  # deleted in sandbox

            data = copy.deepcopy(card.data)
            # Apply field-level diffs
            if cid in changes_map:
                data.update(changes_map[cid])

            merged.append({
                'id': cid,
                'display_id': card.display_id,
                'table_id': str(card.table_id),
                'organization_id': str(card.organization_id),
                'status': status_map.get(cid, card.status),
                'version': card.version,
                'data': data,
                'is_sandbox_only': False,
                'is_deleted_in_sandbox': False,
            })

        # 5. Append sandbox-only created cards
        for sc in SandboxCardCreate.objects.filter(session=session, table=table):
            merged.append({
                'id': f'sb_{sc.id}',
                'display_id': sc.display_id,
                'table_id': str(sc.table_id),
                'organization_id': str(sc.organization_id),
                'status': sc.status,
                'version': 1,
                'data': sc.data,
                'is_sandbox_only': True,
                'is_deleted_in_sandbox': False,
            })

        return merged

    @staticmethod
    def resolve_single_card(session: SandboxSession, card_id: str) -> Optional[Dict]:
        """
        Resolve a single card (real or sandbox-only) in sandbox context.
        Returns None if card is sandbox-deleted or doesn't exist.
        """
        # Check sandbox-only cards first
        if card_id.startswith('sb_'):
            sb_uuid = card_id[3:]
            try:
                sc = SandboxCardCreate.objects.get(id=sb_uuid, session=session)
                return {
                    'id': card_id,
                    'display_id': sc.display_id,
                    'table_id': str(sc.table_id),
                    'organization_id': str(sc.organization_id),
                    'status': sc.status,
                    'version': 1,
                    'data': sc.data,
                    'is_sandbox_only': True,
                    'is_deleted_in_sandbox': False,
                }
            except SandboxCardCreate.DoesNotExist:
                return None

        try:
            card = Card.objects.get(id=card_id)
        except Card.DoesNotExist:
            return None

        # Check sandbox-delete
        if SandboxCardDelete.objects.filter(session=session, card_id=card_id).exists():
            return None

        # Apply changes
        data = copy.deepcopy(card.data)
        for ch in SandboxChange.objects.filter(session=session, card_id=card_id):
            data[str(ch.field_id)] = ch.new_value

        # Status override
        try:
            status_override = SandboxCardStatus.objects.get(session=session, card_id=card_id)
            status = status_override.status
        except SandboxCardStatus.DoesNotExist:
            status = card.status

        return {
            'id': card_id,
            'display_id': card.display_id,
            'table_id': str(card.table_id),
            'organization_id': str(card.organization_id),
            'status': status,
            'version': card.version,
            'data': data,
            'is_sandbox_only': False,
            'is_deleted_in_sandbox': False,
        }


class SandboxEditService:
    """Handles field-level edits to sandbox cards."""

    @staticmethod
    @transaction.atomic
    def edit_card(session: SandboxSession, card_id: str, field_updates: Dict[str, str], user) -> Dict:
        """
        Apply field updates to a card inside the sandbox.
        Works for both real cards and sandbox-only cards.
        Never touches production data.
        """
        session.touch()

        if card_id.startswith('sb_'):
            # Sandbox-only card — mutate SandboxCardCreate directly
            sb_uuid = card_id[3:]
            try:
                sc = SandboxCardCreate.objects.get(id=sb_uuid, session=session)
            except SandboxCardCreate.DoesNotExist:
                raise ValidationError("Sandbox card not found.")
            new_data = {**sc.data, **field_updates}
            sc.data = new_data
            sc.save(update_fields=['data'])
            AuditLog.objects.create(
                event_type='SANDBOX_EDIT',
                actor=user,
                target_organization=session.organization,
                details={'sandbox_session_id': str(session.id), 'sandbox_card_id': card_id},
            )
            return {'id': card_id, 'data': sc.data}

        # Real card — write SandboxChange rows (upsert per field)
        try:
            card = Card.objects.get(id=card_id)
        except Card.DoesNotExist:
            raise ValidationError("Card not found.")

        for field_id, new_value in field_updates.items():
            # Get old value: latest sandbox change or production value
            old_value = card.data.get(field_id)
            try:
                existing = SandboxChange.objects.get(session=session, card_id=card_id, field_id=field_id)
                old_value = existing.new_value
                existing.new_value = new_value
                existing.user = user
                existing.save(update_fields=['new_value', 'user'])
            except SandboxChange.DoesNotExist:
                SandboxChange.objects.create(
                    session=session,
                    table_id=card.table_id,
                    card_id=card_id,
                    field_id=field_id,
                    old_value=str(old_value) if old_value is not None else None,
                    new_value=new_value,
                    user=user,
                )

        AuditLog.objects.create(
            event_type='SANDBOX_EDIT',
            actor=user,
            target_organization=session.organization,
            details={
                'sandbox_session_id': str(session.id),
                'card_id': card_id,
                'field_updates': field_updates,
            },
        )

        return SandboxResolver.resolve_single_card(session, card_id)


class SandboxCardService:
    """Handles card creation and deletion inside sandbox."""

    @staticmethod
    @transaction.atomic
    def create_card(session: SandboxSession, table: Table, data: dict, user) -> Dict:
        """Create a sandbox-only card. Never writes to production."""
        session.touch()
        from django.db.models import F
        # Use a simple display_id based on existing sandbox card count
        count = SandboxCardCreate.objects.filter(session=session, table=table).count()
        display_id = f'SB-{count + 1}'
        sc = SandboxCardCreate.objects.create(
            session=session,
            table=table,
            organization=session.organization,
            display_id=display_id,
            data=data,
            status='PENDING',
            created_by=user,
        )
        AuditLog.objects.create(
            event_type='SANDBOX_EDIT',
            actor=user,
            target_organization=session.organization,
            details={'sandbox_session_id': str(session.id), 'action': 'create_card', 'sandbox_card_id': str(sc.id)},
        )
        return {
            'id': f'sb_{sc.id}',
            'display_id': sc.display_id,
            'status': sc.status,
            'data': sc.data,
            'is_sandbox_only': True,
        }

    @staticmethod
    @transaction.atomic
    def delete_card(session: SandboxSession, card_id: str, user) -> None:
        """Mark a card as deleted in sandbox. Never touches production."""
        session.touch()
        if card_id.startswith('sb_'):
            sb_uuid = card_id[3:]
            SandboxCardCreate.objects.filter(id=sb_uuid, session=session).delete()
        else:
            SandboxCardDelete.objects.get_or_create(
                session=session,
                card_id=card_id,
                defaults={'user': user},
            )
        AuditLog.objects.create(
            event_type='SANDBOX_EDIT',
            actor=user,
            target_organization=session.organization,
            details={'sandbox_session_id': str(session.id), 'action': 'delete_card', 'card_id': card_id},
        )


class SandboxWorkflowService:
    """Handles sandbox-only workflow transitions."""

    @staticmethod
    @transaction.atomic
    def transition_card(session: SandboxSession, card_id: str, action: str, user, reason: str = '') -> Dict:
        """
        Apply a workflow transition inside sandbox only.
        Production card statuses are never modified.
        """
        session.touch()

        is_sandbox_only = card_id.startswith('sb_')

        if is_sandbox_only:
            sb_uuid = card_id[3:]
            sc = SandboxCardCreate.objects.get(id=sb_uuid, session=session)
            old_status = sc.status
            new_status = SandboxWorkflowService._resolve_transition(old_status, action)
            sc.status = new_status
            sc.save(update_fields=['status'])
            SandboxWorkflowHistory.objects.create(
                session=session,
                sandbox_card=sc,
                old_status=old_status,
                new_status=new_status,
                action=action,
                user=user,
                reason=reason,
            )
            return {'id': card_id, 'status': new_status}

        # Real card — get current sandbox status (or production status)
        card = Card.objects.get(id=card_id)
        try:
            sc_status = SandboxCardStatus.objects.get(session=session, card=card)
            old_status = sc_status.status
        except SandboxCardStatus.DoesNotExist:
            old_status = card.status

        new_status = SandboxWorkflowService._resolve_transition(old_status, action)

        SandboxCardStatus.objects.update_or_create(
            session=session,
            card=card,
            defaults={'status': new_status},
        )

        SandboxWorkflowHistory.objects.create(
            session=session,
            card=card,
            old_status=old_status,
            new_status=new_status,
            action=action,
            user=user,
            reason=reason,
        )

        AuditLog.objects.create(
            event_type='SANDBOX_WORKFLOW',
            actor=user,
            target_organization=session.organization,
            details={
                'sandbox_session_id': str(session.id),
                'card_id': card_id,
                'action': action,
                'old_status': old_status,
                'new_status': new_status,
            },
        )

        return {'id': card_id, 'status': new_status}

    @staticmethod
    def _resolve_transition(old_status: str, action: str) -> str:
        new_status = _SANDBOX_TRANSITION_MAP.get((old_status, action))
        if new_status is None:
            raise ValidationError(
                f"Sandbox workflow: invalid transition from '{old_status}' via '{action}'."
            )
        # Handle RESTORE: return to PENDING (sandbox doesn't track pre-delete status)
        if action == WorkflowAction.RESTORE:
            return WorkflowState.PENDING
        return new_status


class SandboxImportService:
    """
    Runs imports that create SandboxCardCreate rows instead of real cards.
    Re-uses openpyxl parsing logic but writes to sandbox tables only.
    """

    @staticmethod
    def process_import(
        sandbox_import_session: SandboxImportSession,
        excel_path: str,
        progress_callback=None,
    ):
        import openpyxl
        from apps.fields.models import Field

        session = sandbox_import_session.sandbox_session
        table = sandbox_import_session.table

        sandbox_import_session.status = SandboxImportStatus.PROCESSING
        sandbox_import_session.started_at = timezone.now()
        sandbox_import_session.save()

        AuditLog.objects.create(
            event_type='SANDBOX_IMPORT',
            actor=sandbox_import_session.user,
            target_organization=sandbox_import_session.organization,
            details={
                'sandbox_session_id': str(session.id),
                'sandbox_import_session_id': str(sandbox_import_session.id),
            },
        )

        try:
            wb = openpyxl.load_workbook(excel_path, read_only=True, data_only=True)
            ws = wb.active
            rows_iter = ws.iter_rows(values_only=True)
            headers = [str(h).strip() for h in next(rows_iter) if h is not None]
            fields = Field.objects.filter(table=table, is_deleted=False)
            field_by_name = {f.name.lower(): f for f in fields}

            total = success = failed = 0
            seq = SandboxCardCreate.objects.filter(session=session, table=table).count()

            for row in rows_iter:
                if not any(v is not None for v in row):
                    continue
                total += 1
                seq += 1
                row_data = {}
                for col_idx, val in enumerate(row):
                    if col_idx < len(headers):
                        h = headers[col_idx].lower()
                        if h in field_by_name:
                            row_data[str(field_by_name[h].id)] = val
                try:
                    SandboxCardCreate.objects.create(
                        session=session,
                        table=table,
                        organization=sandbox_import_session.organization,
                        display_id=f'SB-{seq}',
                        data=row_data,
                        status='PENDING',
                        created_by=sandbox_import_session.user,
                    )
                    success += 1
                except Exception as e:
                    failed += 1
                    logger.warning(f"Sandbox import row {total} failed: {e}")

                if progress_callback and total % 500 == 0:
                    progress_callback(int(20 + (total / 5000) * 70), f"Imported {total} rows")

            completed = timezone.now()
            sandbox_import_session.status = SandboxImportStatus.COMPLETED
            sandbox_import_session.completed_at = completed
            sandbox_import_session.total_rows = total
            sandbox_import_session.success_rows = success
            sandbox_import_session.failed_rows = failed
            if sandbox_import_session.started_at:
                sandbox_import_session.duration = (completed - sandbox_import_session.started_at).total_seconds()
            sandbox_import_session.save()

        except Exception as exc:
            sandbox_import_session.status = SandboxImportStatus.FAILED
            sandbox_import_session.error_message = str(exc)
            sandbox_import_session.completed_at = timezone.now()
            sandbox_import_session.save()
            raise


class SandboxExportService:
    """
    Exports using the sandbox-merged view instead of production data.
    Writes results to sandbox_export_session only.
    """

    @staticmethod
    def process_export(
        sandbox_export_session: SandboxExportSession,
        progress_callback=None,
    ):
        from io import BytesIO
        from apps.exports.services import XlsxRenderer, ZipRenderer
        from apps.exports.constants import ExportType
        from apps.mediafiles.storage.factory import StorageFactory
        import uuid as _uuid

        session = sandbox_export_session.sandbox_session
        table = sandbox_export_session.table
        options = sandbox_export_session.options or {}

        sandbox_export_session.status = SandboxExportStatus.PROCESSING
        sandbox_export_session.started_at = timezone.now()
        sandbox_export_session.save()

        AuditLog.objects.create(
            event_type='SANDBOX_EXPORT',
            actor=sandbox_export_session.user,
            target_organization=sandbox_export_session.organization,
            details={
                'sandbox_session_id': str(session.id),
                'export_type': sandbox_export_session.export_type,
            },
        )

        try:
            # Get merged sandbox card list
            merged_cards = SandboxResolver.resolve_cards(session, table)
            fields = list(Field.objects.filter(table=table, is_deleted=False).order_by('display_order', 'created_at'))

            # Convert merged dicts to card-like objects for renderer compatibility
            card_proxies = [_SandboxCardProxy(c) for c in merged_cards]

            export_type = sandbox_export_session.export_type

            if export_type == ExportType.XLSX:
                from apps.exports.models import ExportSession
                # Use a lightweight dummy session object for renderer
                class _FakeSession:
                    id = sandbox_export_session.id
                data = XlsxRenderer.render(
                    export_session=_FakeSession(),
                    cards=card_proxies,
                    fields=fields,
                )
                filename = f"sandbox_export_{sandbox_export_session.id}.xlsx"
                mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

            elif export_type == ExportType.ZIP:
                rename_pattern = options.get('rename_pattern', '{display_id}')
                class _FakeSession:
                    id = sandbox_export_session.id
                data = ZipRenderer.render(
                    export_session=_FakeSession(),
                    cards=card_proxies,
                    fields=fields,
                    rename_pattern=rename_pattern,
                )
                filename = f"sandbox_export_{sandbox_export_session.id}.zip"
                mime = 'application/zip'
            else:
                raise ValueError(f"Unsupported sandbox export type: {export_type}")

            # Store artifact
            storage = StorageFactory.get_storage()
            uid = str(_uuid.uuid4())
            stored_path = f"sandbox_exports/{uid[:2]}/{uid[2:4]}/{uid}_{filename}"
            storage.save(stored_path, BytesIO(data))

            completed = timezone.now()
            sandbox_export_session.status = SandboxExportStatus.COMPLETED
            sandbox_export_session.completed_at = completed
            sandbox_export_session.file_name = filename
            sandbox_export_session.stored_path = stored_path
            sandbox_export_session.file_size = len(data)
            sandbox_export_session.record_count = len(card_proxies)
            if sandbox_export_session.started_at:
                sandbox_export_session.duration = (completed - sandbox_export_session.started_at).total_seconds()
            sandbox_export_session.save()

        except Exception as exc:
            sandbox_export_session.status = SandboxExportStatus.FAILED
            sandbox_export_session.error_message = str(exc)
            sandbox_export_session.completed_at = timezone.now()
            sandbox_export_session.save()
            raise


class _SandboxCardProxy:
    """
    Lightweight proxy to make sandbox merged card dicts compatible with
    the existing XlsxRenderer / ZipRenderer / sort_cards interfaces.
    """
    def __init__(self, merged: dict):
        self.id = merged['id']
        self.display_id = merged['display_id']
        self.status = merged['status']
        self.data = merged['data']
        self.table_id = merged.get('table_id')
        self.organization_id = merged.get('organization_id')

    def refresh_from_db(self, fields=None):
        pass  # no-op for proxy


class SandboxCleanupService:
    """Cleans up expired sandbox sessions and all associated data."""

    @staticmethod
    def cleanup_expired_sessions():
        """Delete all sessions past their expiry date and all linked data."""
        now = timezone.now()
        expired = SandboxSession.objects.filter(expires_at__lte=now, is_active=True)
        count = expired.count()
        for session in expired:
            AuditLog.objects.create(
                event_type='SANDBOX_EXPIRED',
                actor=session.user,
                target_organization=session.organization,
                details={'sandbox_session_id': str(session.id)},
            )
        # CASCADE deletes handle all related changes/cards/history/imports/exports
        expired.delete()
        logger.info(f"SandboxCleanupService: deleted {count} expired sessions.")
        return count

    @staticmethod
    def deactivate_session(session: SandboxSession, user):
        """Manually deactivate a sandbox session."""
        session.is_active = False
        session.save(update_fields=['is_active'])
        AuditLog.objects.create(
            event_type='SANDBOX_EXPIRED',
            actor=user,
            target_organization=session.organization,
            details={'sandbox_session_id': str(session.id), 'reason': 'manual_deactivation'},
        )
