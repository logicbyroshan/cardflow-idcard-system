from django.test import TestCase, override_settings
from django.utils import timezone
from datetime import timedelta
from django.core.cache import cache
from django.core.exceptions import ValidationError
from rest_framework.test import APITestCase
from rest_framework.exceptions import PermissionDenied, NotFound

from apps.organizations.models import Organization
from apps.tables.models import Table
from apps.fields.models import Field, FieldType
from apps.cards.models import Card, CardStatus, AssistantFilter
from apps.users.models import User, OperatorAssignment
from shared.constants import Role
from apps.reprints.models import ReprintRequest, ReprintHistory, ReprintExportSession, ReprintStatus
from apps.reprints.services import ReprintService, ReprintReportService, ReprintExportService
from apps.desktop_sync.models import DesktopApiKey
from apps.mediafiles.models import MediaFile, MediaReference
from apps.auditlogs.models import AuditLog, AuditEvent
from apps.notifications.models import Notification, NotificationDelivery

@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class ReprintBaseTest(TestCase):

    def setUp(self):
        super().setUp()
        cache.clear()
        
        # Users
        self.owner = User.objects.create_user(
            username="reprint_owner",
            password="password123",
            role=Role.CLIENT
        )
        self.org = Organization.objects.create(
            name="Reprint Org",
            owner_client=self.owner
        )
        self.owner.organization = self.org
        self.owner.save()

        self.assistant = User.objects.create_user(
            username="reprint_assistant",
            password="password123",
            role=Role.ASSISTANT,
            organization=self.org
        )

        self.operator = User.objects.create_user(
            username="reprint_operator",
            password="password123",
            role=Role.OPERATOR
        )
        # Assign client to operator
        OperatorAssignment.objects.create(
            operator=self.operator,
            client=self.owner,
            assigned_by=self.owner
        )

        self.admin = User.objects.create_user(
            username="reprint_admin",
            password="password123",
            role=Role.ADMIN
        )

        # Table & Field
        self.table = Table.objects.create(
            name="Reprint Table",
            organization=self.org
        )
        self.field = Field.objects.create(
            table=self.table,
            name="Student Name",
            type=FieldType.TEXT,
            display_order=1
        )
        self.image_field = Field.objects.create(
            table=self.table,
            name="Photo",
            type=FieldType.IMAGE,
            display_order=2
        )

        # Downloaded card (must be downloaded to request reprint)
        self.card = Card.objects.create(
            table=self.table,
            organization=self.org,
            display_id="CARD-001",
            status=CardStatus.DOWNLOADED,
            data={
                str(self.field.id): "Old Name",
                str(self.image_field.id): "old-media-id"
            }
        )

        # Create Media Files and Reference
        self.old_media = MediaFile.objects.create(
            organization=self.org,
            table=self.table,
            card=self.card,
            field=self.image_field,
            original_name="old_photo.jpg",
            stored_name="photos/old_photo.jpg",
            mime_type="image/jpeg",
            extension="jpg",
            file_size=1024,
            checksum="abcde12345",
            storage_provider="local"
        )
        self.media_ref = MediaReference.objects.create(
            media_file=self.old_media,
            card=self.card,
            field=self.image_field
        )

        self.new_media = MediaFile.objects.create(
            organization=self.org,
            table=self.table,
            card=self.card,
            field=self.image_field,
            original_name="new_photo.jpg",
            stored_name="photos/new_photo.jpg",
            mime_type="image/jpeg",
            extension="jpg",
            file_size=2048,
            checksum="abcde67890",
            storage_provider="local"
        )


class ReprintRequestServiceTests(ReprintBaseTest):

    def test_request_creation_success(self):
        """Create a reprint request successfully."""
        req = ReprintService.create_reprint_request(
            card=self.card,
            requested_by=self.owner,
            draft_data={str(self.field.id): "New Name"},
            draft_media_changes={str(self.image_field.id): str(self.new_media.id)}
        )
        self.assertEqual(req.status, ReprintStatus.REQUESTED)
        self.assertEqual(req.draft_data[str(self.field.id)], "New Name")
        self.assertEqual(req.draft_media_changes[str(self.image_field.id)], str(self.new_media.id))
        self.assertEqual(req.request_count, 1)

        # Verify audit log
        audit = AuditLog.objects.filter(event_type=AuditEvent.REPRINT_REQUESTED).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.actor, self.owner)

        # Verify notification
        notif = Notification.objects.filter(event__event_type='REPRINT_REQUESTED').first()
        self.assertIsNotNone(notif)

    def test_request_creation_invalid_status(self):
        """Request reprint fails if status is not DOWNLOADED."""
        pending_card = Card.objects.create(
            table=self.table,
            organization=self.org,
            display_id="CARD-002",
            status=CardStatus.PENDING
        )
        with self.assertRaises(ValidationError):
            ReprintService.create_reprint_request(pending_card, self.owner)

    def test_request_approval(self):
        """Approve a reprint request and verify changes are applied."""
        req = ReprintService.create_reprint_request(
            card=self.card,
            requested_by=self.owner,
            draft_data={str(self.field.id): "New Approved Name"},
            draft_media_changes={str(self.image_field.id): str(self.new_media.id)}
        )

        # Approve request
        approved_req = ReprintService.approve_reprint_request(req, self.admin)
        self.assertEqual(approved_req.status, ReprintStatus.CONFIRMED)
        self.assertEqual(approved_req.approved_by, self.admin)

        # Card data must be updated immediately
        self.card.refresh_from_db()
        self.assertEqual(self.card.data[str(self.field.id)], "New Approved Name")
        self.assertEqual(self.card.data[str(self.image_field.id)], str(self.new_media.id))

        # MediaReference must point to new media file
        ref = MediaReference.objects.filter(card=self.card, field=self.image_field).first()
        self.assertEqual(ref.media_file, self.new_media)

        # Old media must be soft-deleted
        self.old_media.refresh_from_db()
        self.assertTrue(self.old_media.is_deleted)

        # Verify audit logs
        audit = AuditLog.objects.filter(event_type=AuditEvent.REPRINT_APPROVED).first()
        self.assertIsNotNone(audit)
        card_update_audit = AuditLog.objects.filter(event_type=AuditEvent.CARD_UPDATED_REPRINT).first()
        self.assertIsNotNone(card_update_audit)

    def test_request_rejection(self):
        """Reject a reprint request."""
        req = ReprintService.create_reprint_request(
            card=self.card,
            requested_by=self.owner
        )
        rejected = ReprintService.reject_reprint_request(req, self.operator, reason="Typo in details")
        self.assertEqual(rejected.status, ReprintStatus.REJECTED)

        # Check history
        history = ReprintHistory.objects.filter(reprint_request=req, action='REJECTED').first()
        self.assertIsNotNone(history)
        self.assertEqual(history.details['reason'], "Typo in details")

    def test_print_counters(self):
        """Mark as printed and verify counters increment."""
        req = ReprintService.create_reprint_request(
            card=self.card,
            requested_by=self.owner
        )
        # Transition to CONFIRMED first
        ReprintService.approve_reprint_request(req, self.admin)

        # Transition to PRINTED
        printed = ReprintService.mark_reprint_printed(req, self.admin)
        self.assertEqual(printed.status, ReprintStatus.PRINTED)
        self.assertIsNotNone(printed.printed_at)
        self.assertEqual(printed.printed_by, self.admin)

        # Verify counters
        self.card.refresh_from_db()
        self.assertEqual(self.card.reprint_count, 1)
        self.assertEqual(self.card.total_print_count, 2)


class ReprintReportingAndExportTests(ReprintBaseTest):

    def setUp(self):
        super().setUp()
        self.req1 = ReprintService.create_reprint_request(self.card, self.owner)
        ReprintService.approve_reprint_request(self.req1, self.admin)
        ReprintService.mark_reprint_printed(self.req1, self.admin)

    def test_reporting_metrics(self):
        """Verify report counts are correct."""
        by_client = ReprintReportService.get_reprints_by_client()
        self.assertEqual(len(by_client), 1)
        self.assertEqual(by_client[0]['count'], 1)

        by_org = ReprintReportService.get_reprints_by_organization()
        self.assertEqual(len(by_org), 1)

        by_table = ReprintReportService.get_reprints_by_table()
        self.assertEqual(len(by_table), 1)

        by_month = ReprintReportService.get_reprints_by_month()
        self.assertEqual(len(by_month), 1)

    def test_export_session_zip(self):
        """Create a ZIP reprint export session."""
        session = ReprintExportService.create_export_session(
            user=self.admin,
            request_ids=[str(self.req1.id)],
            export_format='ZIP'
        )
        self.assertEqual(session.status, 'COMPLETED')
        self.assertIsNotNone(session.download_url)


class ReprintAPITests(APITestCase):

    def setUp(self):
        super().setUp()
        cache.clear()
        
        # Setup users
        self.owner = User.objects.create_user(
            username="api_owner", password="password123", role=Role.CLIENT
        )
        self.org = Organization.objects.create(name="API Org", owner_client=self.owner)
        self.owner.organization = self.org
        self.owner.save()

        self.operator = User.objects.create_user(
            username="api_operator", password="password123", role=Role.OPERATOR
        )
        OperatorAssignment.objects.create(operator=self.operator, client=self.owner, assigned_by=self.owner)

        self.table = Table.objects.create(name="API Table", organization=self.org)
        self.card = Card.objects.create(
            table=self.table, organization=self.org, display_id="CARD-002", status=CardStatus.DOWNLOADED
        )

        self.req = ReprintService.create_reprint_request(self.card, self.owner)

    def test_client_endpoints(self):
        """Client can create and view reprint requests."""
        self.client.force_authenticate(user=self.owner)

        # View requests list
        response = self.client.get('/api/v1/reprints/requests/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

        # Create new request
        new_card = Card.objects.create(
            table=self.table, organization=self.org, display_id="CARD-003", status=CardStatus.DOWNLOADED
        )
        response = self.client.post('/api/v1/reprints/requests/', {
            'card_id': str(new_card.id),
            'draft_data': {'some_field': 'Updated Value'}
        }, format='json')
        self.assertEqual(response.status_code, 201)

    def test_operator_approval(self):
        """Operator can approve reprint requests."""
        self.client.force_authenticate(user=self.operator)

        response = self.client.post(f'/api/v1/reprints/requests/{self.req.id}/approve/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], ReprintStatus.CONFIRMED)

    def test_operator_rejection(self):
        """Operator can reject reprint requests."""
        self.client.force_authenticate(user=self.operator)

        response = self.client.post(f'/api/v1/reprints/requests/{self.req.id}/reject/', {'reason': 'Invalid name'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], ReprintStatus.REJECTED)

    def test_dashboard_view(self):
        """Verify dashboard statistics endpoint returns correct widgets."""
        self.client.force_authenticate(user=self.operator)
        response = self.client.get('/api/v1/reprints/dashboard/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['pending_requests'], 1)


class ReprintDesktopAPITests(APITestCase):

    def setUp(self):
        super().setUp()
        cache.clear()
        
        # Setup org
        self.owner = User.objects.create_user(
            username="desktop_owner", password="password123", role=Role.CLIENT
        )
        self.org = Organization.objects.create(name="Desktop Org", owner_client=self.owner)
        self.owner.organization = self.org
        self.owner.save()

        # Desktop Key
        self.key_obj, self.raw_key = DesktopApiKey.create_key(self.org, "Sync PC", self.owner)

        self.table = Table.objects.create(name="Desktop Table", organization=self.org)
        self.card = Card.objects.create(
            table=self.table, organization=self.org, display_id="CARD-DSK", status=CardStatus.DOWNLOADED
        )
        self.req = ReprintService.create_reprint_request(self.card, self.owner)
        ReprintService.approve_reprint_request(self.req, self.owner)

    def test_desktop_flow(self):
        """Verify reprint endpoints for desktop software."""
        # 1. Fetch reprint data
        self.client.credentials(HTTP_X_DESKTOP_KEY=self.raw_key)
        response = self.client.get('/api/v1/reprints/desktop/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['id'], str(self.req.id))

        # 2. Fetch images metadata
        response = self.client.get(f'/api/v1/reprints/desktop/{self.req.id}/images/')
        self.assertEqual(response.status_code, 200)

        # 3. Mark request printed
        response = self.client.post('/api/v1/reprints/desktop/printed/', {
            'reprint_request_ids': [str(self.req.id)]
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['updated_count'], 1)

        self.req.refresh_from_db()
        self.assertEqual(self.req.status, ReprintStatus.PRINTED)
