from django.db import transaction
from django.utils import timezone
from django.core.exceptions import ValidationError
from django.db.models import Count, Q
from django.db.models.functions import TruncMonth

from apps.cards.models import Card, CardStatus
from apps.fields.models import Field
from apps.mediafiles.models import MediaFile, MediaReference
from apps.reprints.models import ReprintRequest, ReprintHistory, ReprintExportSession, ReprintStatus
from apps.auditlogs.models import AuditLog, AuditEvent
from apps.notifications.services import NotificationService
from apps.users.models import User
from shared.constants import Role

class ReprintService:

    @staticmethod
    @transaction.atomic
    def create_reprint_request(
        card: Card,
        requested_by: User,
        draft_data: dict = None,
        draft_media_changes: dict = None
    ) -> ReprintRequest:
        """
        Creates a reprint request.
        The card must be in DOWNLOADED status.
        Changes are stored inside draft_data and draft_media_changes.
        """
        if card.status != CardStatus.DOWNLOADED:
            raise ValidationError("Reprints can only be requested for cards in DOWNLOADED status.")

        draft_data = draft_data or {}
        draft_media_changes = draft_media_changes or {}

        # Resolve organization and table from card
        org = card.organization
        table = card.table

        # Client is organization owner or the client user
        client = org.owner_client

        # Retrieve request count or default
        request_count = ReprintRequest.objects.filter(card=card).count() + 1

        request = ReprintRequest.objects.create(
            card=card,
            table=table,
            organization=org,
            client=client,
            requested_by=requested_by,
            status=ReprintStatus.REQUESTED,
            draft_data=draft_data,
            draft_media_changes=draft_media_changes,
            request_count=request_count
        )

        # Log Reprint Requested event
        AuditLog.objects.create(
            event_type=AuditEvent.REPRINT_REQUESTED,
            actor=requested_by,
            target_organization=org,
            details={
                'reprint_request_id': str(request.id),
                'card_id': str(card.id),
                'display_id': card.display_id
            }
        )

        # Create history entry
        ReprintHistory.objects.create(
            reprint_request=request,
            card=card,
            action='REQUESTED',
            performed_by=requested_by,
            details={'draft_data': draft_data, 'draft_media_changes': draft_media_changes}
        )

        # Notify
        NotificationService.create_notification_from_event(
            event_type='REPRINT_REQUESTED',
            source_user=requested_by,
            source_org=org,
            data={
                'reprint_request_id': str(request.id),
                'display_id': card.display_id,
                'card_id': str(card.id)
            }
        )

        return request

    @staticmethod
    @transaction.atomic
    def approve_reprint_request(request: ReprintRequest, approved_by: User) -> ReprintRequest:
        """
        Approves a requested reprint request.
        Updates status to CONFIRMED.
        Applies draft changes and media replacements to actual Card.
        """
        if request.status != ReprintStatus.REQUESTED:
            raise ValidationError("Only REQUESTED reprint requests can be approved.")

        card = request.card

        # Apply draft data
        if request.draft_data:
            card.data.update(request.draft_data)
            card.save()

            AuditLog.objects.create(
                event_type=AuditEvent.CARD_UPDATED_REPRINT,
                actor=approved_by,
                target_organization=request.organization,
                details={
                    'reprint_request_id': str(request.id),
                    'card_id': str(card.id),
                    'updated_fields': list(request.draft_data.keys())
                }
            )

        # Apply image replacements
        if request.draft_media_changes:
            for field_id, media_id in request.draft_media_changes.items():
                if not media_id:
                    continue
                try:
                    media_file = MediaFile.objects.get(id=media_id)
                    field = Field.objects.get(id=field_id)

                    existing_ref = MediaReference.objects.filter(card=card, field=field).first()
                    if existing_ref:
                        old_media = existing_ref.media_file
                        old_media.is_deleted = True
                        old_media.deleted_at = timezone.now()
                        old_media.save()
                        existing_ref.delete()

                    MediaReference.objects.create(
                        media_file=media_file,
                        card=card,
                        field=field
                    )

                    # Update card data pointer
                    card.data[str(field_id)] = str(media_id)
                except Exception as e:
                    pass
            card.save()

        # Update request status
        request.status = ReprintStatus.CONFIRMED
        request.approved_by = approved_by
        request.approved_at = timezone.now()
        request.save()

        # Log Reprint Approved
        AuditLog.objects.create(
            event_type=AuditEvent.REPRINT_APPROVED,
            actor=approved_by,
            target_organization=request.organization,
            details={
                'reprint_request_id': str(request.id),
                'card_id': str(card.id)
            }
        )

        # History
        ReprintHistory.objects.create(
            reprint_request=request,
            card=card,
            action='APPROVED',
            performed_by=approved_by
        )

        # Notify
        NotificationService.create_notification_from_event(
            event_type='REPRINT_APPROVED',
            source_user=approved_by,
            source_org=request.organization,
            data={
                'reprint_request_id': str(request.id),
                'display_id': card.display_id,
                'card_id': str(card.id)
            }
        )

        return request

    @staticmethod
    @transaction.atomic
    def reject_reprint_request(request: ReprintRequest, rejected_by: User, reason: str = None) -> ReprintRequest:
        """
        Rejects a requested reprint request.
        """
        if request.status != ReprintStatus.REQUESTED:
            raise ValidationError("Only REQUESTED reprint requests can be rejected.")

        request.status = ReprintStatus.REJECTED
        request.save()

        # Log Reprint Rejected
        AuditLog.objects.create(
            event_type=AuditEvent.REPRINT_REJECTED,
            actor=rejected_by,
            target_organization=request.organization,
            details={
                'reprint_request_id': str(request.id),
                'card_id': str(request.card.id),
                'reason': reason or ""
            }
        )

        # History
        ReprintHistory.objects.create(
            reprint_request=request,
            card=request.card,
            action='REJECTED',
            performed_by=rejected_by,
            details={'reason': reason or ""}
        )

        # Notify
        NotificationService.create_notification_from_event(
            event_type='REPRINT_REJECTED',
            source_user=rejected_by,
            source_org=request.organization,
            data={
                'reprint_request_id': str(request.id),
                'display_id': request.card.display_id,
                'card_id': str(request.card.id)
            }
        )

        return request

    @staticmethod
    @transaction.atomic
    def mark_reprint_printed(request: ReprintRequest, printed_by: User) -> ReprintRequest:
        """
        Marks a CONFIRMED reprint request as PRINTED.
        Increments print counters on Card.
        """
        if request.status != ReprintStatus.CONFIRMED:
            raise ValidationError("Only CONFIRMED reprint requests can be marked as printed.")

        card = request.card

        # Increment counters
        card.reprint_count += 1
        card.total_print_count += 1
        card.save()

        request.status = ReprintStatus.PRINTED
        request.printed_by = printed_by
        request.printed_at = timezone.now()
        request.save()

        # Log Reprint Printed
        AuditLog.objects.create(
            event_type=AuditEvent.REPRINT_PRINTED,
            actor=printed_by,
            target_organization=request.organization,
            details={
                'reprint_request_id': str(request.id),
                'card_id': str(card.id)
            }
        )

        # History
        ReprintHistory.objects.create(
            reprint_request=request,
            card=card,
            action='PRINTED',
            performed_by=printed_by
        )

        # Notify
        NotificationService.create_notification_from_event(
            event_type='REPRINT_PRINTED',
            source_user=printed_by,
            source_org=request.organization,
            data={
                'reprint_request_id': str(request.id),
                'display_id': card.display_id,
                'card_id': str(card.id)
            }
        )

        return request


class ReprintReportService:

    @staticmethod
    def get_reprints_by_client(org_id=None) -> list:
        qs = ReprintRequest.objects.all()
        if org_id:
            qs = qs.filter(organization_id=org_id)
        # Group by client/user
        res = qs.values('client_id', 'client__username').annotate(count=Count('id')).order_by('-count')
        return list(res)

    @staticmethod
    def get_reprints_by_organization() -> list:
        qs = ReprintRequest.objects.all()
        res = qs.values('organization_id', 'organization__name').annotate(count=Count('id')).order_by('-count')
        return list(res)

    @staticmethod
    def get_reprints_by_table(org_id=None) -> list:
        qs = ReprintRequest.objects.all()
        if org_id:
            qs = qs.filter(organization_id=org_id)
        res = qs.values('table_id', 'table__name').annotate(count=Count('id')).order_by('-count')
        return list(res)

    @staticmethod
    def get_reprints_by_month(org_id=None) -> list:
        qs = ReprintRequest.objects.all()
        if org_id:
            qs = qs.filter(organization_id=org_id)
        res = qs.annotate(month=TruncMonth('created_at')).values('month').annotate(count=Count('id')).order_by('month')
        return [
            {
                'month': item['month'].strftime('%Y-%m') if item['month'] else None,
                'count': item['count']
            } for item in res
        ]

    @staticmethod
    def get_reprints_by_date_range(start_date, end_date, org_id=None) -> list:
        qs = ReprintRequest.objects.filter(created_at__range=(start_date, end_date))
        if org_id:
            qs = qs.filter(organization_id=org_id)
        res = qs.values('status').annotate(count=Count('id')).order_by('status')
        return list(res)


class ReprintExportService:

    @staticmethod
    @transaction.atomic
    def create_export_session(user, request_ids, export_format) -> ReprintExportSession:
        """
        Creates a reprint export session.
        """
        if export_format not in ['PDF', 'DOCX', 'XLSX', 'ZIP']:
            raise ValidationError("Invalid export format.")

        requests = ReprintRequest.objects.filter(id__in=request_ids)
        if not requests.exists():
            raise ValidationError("No reprint requests found for given IDs.")

        session = ReprintExportSession.objects.create(
            export_format=export_format,
            created_by=user,
            status='PENDING'
        )
        session.reprint_requests.set(requests)
        session.save()

        # Run process synchronously/asynchronously. Since existing process runs in task, we can trigger rendering here.
        # Let's perform rendering synchronously or trigger a Celery task.
        # To make it robust and easy to test, let's run rendering logic synchronously in this service.
        ReprintExportService.process_export_session(session)

        return session

    @staticmethod
    def process_export_session(session: ReprintExportSession):
        session.status = 'PROCESSING'
        session.save()

        try:
            requests = list(session.reprint_requests.all().select_related('card', 'table', 'organization'))
            cards = [r.card for r in requests]
            if not cards:
                raise ValueError("No cards to export.")

            table = requests[0].table
            fields = Field.objects.filter(table=table, is_deleted=False).order_by('display_order', 'created_at')

            # We need a template for PDF/DOCX. We can check if any template is linked to the table.
            from apps.exports.models import ExportTemplate
            template = ExportTemplate.objects.filter(table=table).first()

            # Create a mock/temporary ExportSession to satisfy the renderer parameters
            from apps.exports.models import ExportSession
            mock_session = ExportSession.objects.create(
                user=session.created_by,
                organization=table.organization,
                table=table,
                export_type=session.export_format,
                status='PROCESSING'
            )

            # Import the renderers from apps.exports.services
            from apps.exports.services import PdfRenderer, DocxRenderer, XlsxRenderer, ZipRenderer

            data = None
            filename = None
            mime = None

            if session.export_format == 'PDF':
                data = PdfRenderer.render(
                    export_session=mock_session,
                    cards=cards,
                    fields=fields,
                    template=template
                )
                filename = f"reprint_export_{session.id}.pdf"
                mime = 'application/pdf'
            elif session.export_format == 'DOCX':
                data = DocxRenderer.render(
                    export_session=mock_session,
                    cards=cards,
                    fields=fields,
                    template=template
                )
                filename = f"reprint_export_{session.id}.docx"
                mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            elif session.export_format == 'XLSX':
                data = XlsxRenderer.render(
                    export_session=mock_session,
                    cards=cards,
                    fields=fields
                )
                filename = f"reprint_export_{session.id}.xlsx"
                mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            elif session.export_format == 'ZIP':
                data = ZipRenderer.render(
                    export_session=mock_session,
                    cards=cards,
                    fields=fields
                )
                filename = f"reprint_export_{session.id}.zip"
                mime = 'application/zip'

            # Save file to storage using StorageFactory
            from apps.mediafiles.storage.factory import StorageFactory
            storage = StorageFactory.get_storage()
            session_id_str = str(session.id)
            stored_path = f"reprints/{session_id_str[:2]}/{session_id_str}/{filename}"
            from io import BytesIO
            storage.save(stored_path, BytesIO(data))

            # Set download URL (we can construct a download URL or use the stored path)
            session.download_url = f"/api/v1/media/download/?path={stored_path}"
            session.status = 'COMPLETED'
            session.save()

            # Clean up the mock session
            mock_session.delete()

        except Exception as e:
            session.status = 'FAILED'
            session.save()
            raise e
