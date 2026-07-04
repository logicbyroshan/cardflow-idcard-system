"""
Desktop Integration API Services — Phase 15

All public methods accept a DesktopApiKey (not a User) as the actor.
"""
import logging
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
from django.db import transaction
from django.utils import timezone
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied, ValidationError, NotFound

from apps.desktop_sync.models import DesktopApiKey, DesktopAccessLog, DesktopSyncSession
from apps.desktop_sync.constants import DesktopAuditEvent, DESKTOP_ALLOWED_STATUSES
from apps.auditlogs.models import AuditLog
from apps.cards.models import Card
from apps.fields.models import Field
from apps.tables.models import Table
from apps.mediafiles.models import MediaFile, MediaReference
from apps.mediafiles.storage.factory import StorageFactory
from apps.workflow.constants import WorkflowState, WorkflowAction, TRANSITION_MAP
from apps.workflow.models import WorkflowHistory

logger = logging.getLogger(__name__)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _desktop_audit(api_key: DesktopApiKey, event_type: str, ip: str = None, details: dict = None):
    """Write both DesktopAccessLog and AuditLog for a desktop action."""
    DesktopAccessLog.objects.create(
        api_key=api_key,
        organization=api_key.organization,
        event_type=event_type,
        ip_address=ip,
        details=details or {},
    )
    AuditLog.objects.create(
        event_type=event_type,
        actor=None,
        target_organization=api_key.organization,
        ip_address=ip,
        details={
            'desktop_key_id': str(api_key.id),
            'desktop_key_name': api_key.name,
            **(details or {}),
        },
    )


def _get_card(api_key: DesktopApiKey, card_id: str) -> Card:
    """Fetch a card scoped to the desktop key's org and allowed statuses."""
    try:
        card = Card.objects.get(
            id=card_id,
            organization=api_key.organization,
            status__in=DESKTOP_ALLOWED_STATUSES,
        )
        return card
    except Card.DoesNotExist:
        raise NotFound("Card not found or not accessible via desktop API.")


# ─── Key Management Service ───────────────────────────────────────────────────

class DesktopKeyService:

    @staticmethod
    def create_key(organization, name: str, created_by) -> tuple:
        """
        Create a new desktop API key. Returns (DesktopApiKey, raw_key_string).
        raw_key is returned only once — never stored.
        """
        instance, raw_key = DesktopApiKey.create_key(organization, name, created_by)
        AuditLog.objects.create(
            event_type=DesktopAuditEvent.DESKTOP_LOGIN,
            actor=created_by,
            target_organization=organization,
            details={'desktop_key_id': str(instance.id), 'key_name': name, 'action': 'created'},
        )
        return instance, raw_key

    @staticmethod
    def revoke_key(key_id: str, requested_by):
        """Deactivate (revoke) a desktop key. Non-destructive."""
        try:
            key = DesktopApiKey.objects.get(id=key_id)
        except DesktopApiKey.DoesNotExist:
            raise NotFound("Desktop API key not found.")
        key.is_active = False
        key.save(update_fields=['is_active'])
        AuditLog.objects.create(
            event_type=DesktopAuditEvent.DESKTOP_LOGIN,
            actor=requested_by,
            target_organization=key.organization,
            details={'desktop_key_id': str(key.id), 'action': 'revoked'},
        )
        return key

    @staticmethod
    def list_keys(organization):
        return DesktopApiKey.objects.filter(organization=organization).order_by('-created_at')

    @staticmethod
    def verify_key(api_key: DesktopApiKey, ip: str = None):
        """Record a login / verification event."""
        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_LOGIN, ip=ip,
                       details={'key_name': api_key.name})


# ─── Data Access Service ──────────────────────────────────────────────────────

class DesktopDataService:

    @staticmethod
    def list_tables(api_key: DesktopApiKey, ip: str = None):
        tables = Table.objects.filter(
            organization=api_key.organization, is_deleted=False
        ).order_by('name')
        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_DATA_ACCESS, ip=ip,
                       details={'action': 'list_tables', 'count': tables.count()})
        return tables

    @staticmethod
    def get_table_metadata(api_key: DesktopApiKey, table_id: str, ip: str = None):
        try:
            table = Table.objects.get(id=table_id, organization=api_key.organization, is_deleted=False)
        except Table.DoesNotExist:
            raise NotFound("Table not found.")
        fields = Field.objects.filter(table=table, is_deleted=False).order_by('display_order', 'created_at')
        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_DATA_ACCESS, ip=ip,
                       details={'action': 'get_table_metadata', 'table_id': table_id})
        return table, fields

    @staticmethod
    def list_cards(api_key: DesktopApiKey, table_id: str,
                   status_filter=None, search=None,
                   class_filter=None, section_filter=None, branch_filter=None,
                   page=1, page_size=100, ip: str = None):
        """
        Return APPROVED + DOWNLOADED cards only — never PENDING/VERIFIED/DELETED/SANDBOX.
        """
        try:
            table = Table.objects.get(id=table_id, organization=api_key.organization, is_deleted=False)
        except Table.DoesNotExist:
            raise NotFound("Table not found.")

        # Base: only allowed statuses
        allowed = list(status_filter) if status_filter else DESKTOP_ALLOWED_STATUSES
        # Enforce: never let PENDING/VERIFIED/DELETED/SANDBOX through
        allowed = [s for s in allowed if s in DESKTOP_ALLOWED_STATUSES]
        if not allowed:
            allowed = DESKTOP_ALLOWED_STATUSES

        qs = Card.objects.filter(
            table=table,
            organization=api_key.organization,
            status__in=allowed,
        )

        # Text search against JSON data (PostgreSQL jsonb or SQLite text scan)
        if search:
            qs = qs.filter(data__icontains=search)

        # Field-name based filters (look up field id from label)
        def _field_filter(label, value):
            field = Field.objects.filter(table=table, name__iexact=label, is_deleted=False).first()
            if field and value:
                qs_local = qs.filter(**{f'data__{str(field.id)}': value})
                return qs_local
            return qs

        if class_filter:
            qs = _field_filter('class', class_filter)
        if section_filter:
            qs = _field_filter('section', section_filter)
        if branch_filter:
            qs = _field_filter('branch', branch_filter)

        total = qs.count()
        offset = (page - 1) * page_size
        cards = list(qs.order_by('display_id')[offset:offset + page_size])

        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_DATA_ACCESS, ip=ip,
                       details={'action': 'list_cards', 'table_id': table_id,
                                'returned': len(cards), 'total': total})
        return cards, total

    @staticmethod
    def get_card_detail(api_key: DesktopApiKey, card_id: str, ip: str = None) -> Card:
        card = _get_card(api_key, card_id)
        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_DATA_ACCESS, ip=ip,
                       details={'action': 'get_card', 'card_id': card_id})
        return card

    @staticmethod
    def get_card_dataset(api_key: DesktopApiKey, table_id: str, ip: str = None) -> list:
        """
        Structured dataset for mail merge. Returns list of dicts:
        {display_id, status, <field_name>: value, ...}
        Desktop software performs its own merge — backend never generates DOCX/PDF here.
        """
        try:
            table = Table.objects.get(id=table_id, organization=api_key.organization, is_deleted=False)
        except Table.DoesNotExist:
            raise NotFound("Table not found.")

        fields = {str(f.id): f.name for f in Field.objects.filter(table=table, is_deleted=False)}
        cards = Card.objects.filter(
            table=table,
            organization=api_key.organization,
            status__in=DESKTOP_ALLOWED_STATUSES,
        ).order_by('display_id')

        dataset = []
        for card in cards:
            row = {'_card_id': str(card.id), '_display_id': card.display_id, '_status': card.status}
            for fid, fname in fields.items():
                row[fname] = card.data.get(fid, '')
            dataset.append(row)

        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_DATA_ACCESS, ip=ip,
                       details={'action': 'get_dataset', 'table_id': table_id, 'rows': len(dataset)})
        return dataset


# ─── Image Access Service ─────────────────────────────────────────────────────

class DesktopImageService:

    @staticmethod
    def get_image_metadata(api_key: DesktopApiKey, card_id: str, ip: str = None) -> list:
        """Return MediaFile metadata for a card's images."""
        card = _get_card(api_key, card_id)
        media_files = MediaFile.objects.filter(card=card).select_related('field')
        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_IMAGE_DOWNLOAD, ip=ip,
                       details={'action': 'get_image_metadata', 'card_id': card_id,
                                'count': media_files.count()})
        return list(media_files)

    @staticmethod
    def download_image(api_key: DesktopApiKey, media_file_id: str, ip: str = None) -> tuple:
        """Download a single image. Returns (bytes, filename, mime_type)."""
        try:
            media_file = MediaFile.objects.get(
                id=media_file_id,
                organization=api_key.organization,
            )
        except MediaFile.DoesNotExist:
            raise NotFound("Media file not found.")

        # Verify card is accessible
        if media_file.card_id:
            card = Card.objects.filter(
                id=media_file.card_id,
                organization=api_key.organization,
                status__in=DESKTOP_ALLOWED_STATUSES,
            ).first()
            if not card:
                raise PermissionDenied("Card is not in an accessible status for desktop.")

        storage = StorageFactory.get_storage()
        data = storage.read(media_file.stored_name)
        if not data:
            raise NotFound("Image file not found in storage.")

        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_IMAGE_DOWNLOAD, ip=ip,
                       details={'media_file_id': str(media_file.id),
                                'card_id': str(media_file.card_id),
                                'file_size': len(data)})
        return data, media_file.original_name, media_file.mime_type

    @staticmethod
    def download_image_batch(api_key: DesktopApiKey, card_ids: list, ip: str = None) -> tuple:
        """
        Download all images for a list of cards as a ZIP archive.
        Returns (zip_bytes, total_image_count, total_bytes).
        """
        buf = BytesIO()
        image_count = 0
        total_bytes = 0
        storage = StorageFactory.get_storage()

        with ZipFile(buf, 'w', compression=ZIP_DEFLATED) as zf:
            for card_id in card_ids:
                try:
                    card = Card.objects.get(
                        id=card_id,
                        organization=api_key.organization,
                        status__in=DESKTOP_ALLOWED_STATUSES,
                    )
                except Card.DoesNotExist:
                    continue

                for mf in MediaFile.objects.filter(card=card):
                    data = storage.read(mf.stored_name)
                    if data:
                        fname = f"{card.display_id}/{mf.original_name}"
                        zf.writestr(fname, data)
                        image_count += 1
                        total_bytes += len(data)

        zip_bytes = buf.getvalue()
        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_IMAGE_DOWNLOAD, ip=ip,
                       details={'action': 'batch_download', 'card_count': len(card_ids),
                                'image_count': image_count, 'bytes': total_bytes})
        return zip_bytes, image_count, total_bytes

    @staticmethod
    @transaction.atomic
    def replace_image(api_key: DesktopApiKey, card_id: str, field_id: str,
                      file_content: bytes, file_name: str, mime_type: str,
                      ip: str = None) -> MediaFile:
        """
        Replace a card image from desktop. Uses existing MediaService.
        Retains media history. Creates audit + workflow events.
        """
        from apps.mediafiles.services import MediaService
        card = _get_card(api_key, card_id)

        try:
            field = Field.objects.get(id=field_id, table=card.table, is_deleted=False)
        except Field.DoesNotExist:
            raise NotFound("Field not found.")

        # Use existing media service — pass a synthetic user-like object
        # MediaService.upload_image expects card, field, file_name, file_content, mime_type, user
        media_file = MediaService.upload_image(
            card=card,
            field=field,
            file_name=file_name,
            file_content=BytesIO(file_content),
            mime_type=mime_type,
            user=api_key.created_by,   # audit actor = key creator
        )

        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_IMAGE_REPLACE, ip=ip,
                       details={'card_id': card_id, 'field_id': field_id,
                                'media_file_id': str(media_file.id),
                                'file_name': file_name})
        return media_file


# ─── Print / Workflow Service ─────────────────────────────────────────────────

class DesktopWorkflowService:

    @staticmethod
    @transaction.atomic
    def request_print(api_key: DesktopApiKey, card_ids: list, ip: str = None) -> dict:
        """
        Desktop requests printing.
        APPROVED → DOWNLOADED automatically.
        Already DOWNLOADED → remains DOWNLOADED.
        Generates WorkflowHistory + AuditLog for each card.
        """
        transitioned = []
        already_downloaded = []
        skipped = []

        for card_id in card_ids:
            try:
                card = Card.objects.select_for_update().get(
                    id=card_id,
                    organization=api_key.organization,
                    status__in=DESKTOP_ALLOWED_STATUSES,
                )
            except Card.DoesNotExist:
                skipped.append(card_id)
                continue

            if card.status == WorkflowState.APPROVED:
                old_status = card.status
                card.status = WorkflowState.DOWNLOADED
                card.version += 1
                card.save(update_fields=['status', 'version'])

                WorkflowHistory.objects.create(
                    card=card,
                    old_status=old_status,
                    new_status=WorkflowState.DOWNLOADED,
                    user=api_key.created_by,
                    reason=f'Desktop print request — key: {api_key.name}',
                )
                AuditLog.objects.create(
                    event_type='CARD_DOWNLOADED',
                    actor=api_key.created_by,
                    target_organization=api_key.organization,
                    details={
                        'card_id': card_id,
                        'trigger': 'desktop_print',
                        'desktop_key': api_key.name,
                    }
                )
                transitioned.append(card_id)

            elif card.status == WorkflowState.DOWNLOADED:
                already_downloaded.append(card_id)

        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_PRINT_REQUEST, ip=ip,
                       details={'requested': len(card_ids),
                                'transitioned': len(transitioned),
                                'already_downloaded': len(already_downloaded),
                                'skipped': len(skipped)})
        return {
            'transitioned': transitioned,
            'already_downloaded': already_downloaded,
            'skipped': skipped,
        }


# ─── Sync Session Service ─────────────────────────────────────────────────────

class DesktopSyncService:

    @staticmethod
    def start_sync(api_key: DesktopApiKey, table_id: str = None,
                   filters: dict = None, ip: str = None) -> DesktopSyncSession:
        table = None
        if table_id:
            try:
                table = Table.objects.get(id=table_id, organization=api_key.organization)
            except Table.DoesNotExist:
                raise NotFound("Table not found.")

        session = DesktopSyncSession.objects.create(
            api_key=api_key,
            organization=api_key.organization,
            table=table,
            filters=filters or {},
            status='ACTIVE',
            started_at=timezone.now(),
        )
        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_SYNC_START, ip=ip,
                       details={'sync_session_id': str(session.id),
                                'table_id': table_id, 'filters': filters})
        return session

    @staticmethod
    def complete_sync(api_key: DesktopApiKey, sync_session_id: str,
                      card_count: int, image_count: int, downloaded_bytes: int,
                      ip: str = None) -> DesktopSyncSession:
        try:
            session = DesktopSyncSession.objects.get(id=sync_session_id, api_key=api_key)
        except DesktopSyncSession.DoesNotExist:
            raise NotFound("Sync session not found.")

        completed = timezone.now()
        session.status = 'COMPLETED'
        session.completed_at = completed
        session.card_count = card_count
        session.image_count = image_count
        session.downloaded_bytes = downloaded_bytes
        if session.started_at:
            session.duration = (completed - session.started_at).total_seconds()
        session.save()

        _desktop_audit(api_key, DesktopAuditEvent.DESKTOP_SYNC_COMPLETE, ip=ip,
                       details={'sync_session_id': str(session.id),
                                'card_count': card_count, 'image_count': image_count,
                                'bytes': downloaded_bytes})
        return session

    @staticmethod
    def list_sessions(api_key: DesktopApiKey) -> list:
        return list(DesktopSyncSession.objects.filter(api_key=api_key).order_by('-created_at')[:20])
