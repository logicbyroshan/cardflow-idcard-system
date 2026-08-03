from rest_framework import status, permissions
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied
from django.utils import timezone
from django.db import transaction

from apps.notifications.models import NotificationDelivery, NotificationPreference, ReadState, NotificationLevel
from apps.notifications.services import NotificationService
from apps.desktop_sync.authentication import DesktopKeyAuthentication, IsDesktopAuthenticated  # Import phase 15 key authenticator

# ──────────────────────────────────────────────────
# Web View Endpoints
# ──────────────────────────────────────────────────

class WebNotificationListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        """List notifications for the logged in web user."""
        state_filter = request.query_params.get('read_state', None)
        qs = NotificationDelivery.objects.filter(user=request.user).select_related('notification')
        
        if state_filter:
            qs = qs.filter(read_state=state_filter)
        else:
            # By default exclude archived/dismissed from the primary web view
            qs = qs.exclude(read_state__in=[ReadState.ARCHIVED, ReadState.DISMISSED])
            
        data = []
        for d in qs:
            data.append({
                'id': str(d.id),
                'notification_id': str(d.notification.id),
                'title': d.notification.title,
                'message': d.notification.message,
                'level': d.notification.level,
                'read_state': d.read_state,
                'created_at': d.notification.created_at,
                'visible_until': d.notification.visible_until,
            })
        return Response(data)


class WebNotificationUnreadCountView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        count = NotificationDelivery.objects.filter(user=request.user, read_state=ReadState.UNREAD).count()
        return Response({'unread_count': count})


class WebNotificationMarkReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, delivery_id):
        delivery = NotificationService.update_delivery_state(delivery_id, request.user, ReadState.READ)
        return Response({'status': 'success', 'read_state': delivery.read_state})


class WebNotificationMarkAllReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        unread_deliveries = NotificationDelivery.objects.filter(user=request.user, read_state=ReadState.UNREAD)
        count = unread_deliveries.count()
        for d in unread_deliveries:
            NotificationService.update_delivery_state(str(d.id), request.user, ReadState.READ)
        return Response({'status': 'success', 'marked_count': count})


class WebNotificationArchiveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, delivery_id):
        delivery = NotificationService.update_delivery_state(delivery_id, request.user, ReadState.ARCHIVED)
        return Response({'status': 'success', 'read_state': delivery.read_state})


class WebNotificationDismissView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, delivery_id):
        delivery = NotificationService.update_delivery_state(delivery_id, request.user, ReadState.DISMISSED)
        return Response({'status': 'success', 'read_state': delivery.read_state})


# ──────────────────────────────────────────────────
# Mobile View Endpoints
# ──────────────────────────────────────────────────

class MobileNotificationListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        """List notifications, verifying that MOBILE is supported in delivery channels."""
        state_filter = request.query_params.get('read_state', None)
        qs = NotificationDelivery.objects.filter(user=request.user).select_related('notification')
        
        if state_filter:
            qs = qs.filter(read_state=state_filter)
        else:
            qs = qs.exclude(read_state__in=[ReadState.ARCHIVED, ReadState.DISMISSED])
            
        data = []
        for d in qs:
            if "MOBILE" in (d.channels or []):
                data.append({
                    'id': str(d.id),
                    'notification_id': str(d.notification.id),
                    'title': d.notification.title,
                    'message': d.notification.message,
                    'level': d.notification.level,
                    'read_state': d.read_state,
                    'created_at': d.notification.created_at,
                })
        return Response(data)


class MobileNotificationUnreadCountView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = NotificationDelivery.objects.filter(
            user=request.user, 
            read_state=ReadState.UNREAD
        )
        count = sum(1 for d in qs if "MOBILE" in (d.channels or []))
        return Response({'unread_count': count})


class MobileNotificationMarkReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, delivery_id):
        delivery = NotificationService.update_delivery_state(delivery_id, request.user, ReadState.READ)
        return Response({'status': 'success', 'read_state': delivery.read_state})


class MobileNotificationMarkAllReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        unread_deliveries = NotificationDelivery.objects.filter(
            user=request.user, 
            read_state=ReadState.UNREAD
        )
        count = 0
        for d in unread_deliveries:
            if "MOBILE" in (d.channels or []):
                NotificationService.update_delivery_state(str(d.id), request.user, ReadState.READ)
                count += 1
        return Response({'status': 'success', 'marked_count': count})


# ──────────────────────────────────────────────────
# Desktop View Endpoints (API Key Authorized)
# ──────────────────────────────────────────────────

class DesktopNotificationListView(APIView):
    authentication_classes = [DesktopKeyAuthentication]
    permission_classes = [IsDesktopAuthenticated]

    def get(self, request):
        """List notifications targeting the desktop channels inside the key's organization."""
        api_key = request.user  # Populated by DesktopApiKeyAuthentication
        state_filter = request.query_params.get('read_state', None)
        
        # Scope notifications to organization users
        qs = NotificationDelivery.objects.filter(
            user__organization=api_key.organization
        ).select_related('notification', 'user')
        
        if state_filter:
            qs = qs.filter(read_state=state_filter)
        else:
            qs = qs.exclude(read_state__in=[ReadState.ARCHIVED, ReadState.DISMISSED])
            
        data = []
        for d in qs:
            if "DESKTOP" in (d.channels or []):
                data.append({
                    'id': str(d.id),
                    'notification_id': str(d.notification.id),
                    'title': d.notification.title,
                    'message': d.notification.message,
                    'level': d.notification.level,
                    'read_state': d.read_state,
                    'user': d.user.username,
                    'created_at': d.notification.created_at,
                })
        return Response(data)


class DesktopNotificationUnreadCountView(APIView):
    authentication_classes = [DesktopKeyAuthentication]
    permission_classes = [IsDesktopAuthenticated]

    def get(self, request):
        api_key = request.user
        qs = NotificationDelivery.objects.filter(
            user__organization=api_key.organization,
            read_state=ReadState.UNREAD
        )
        count = sum(1 for d in qs if "DESKTOP" in (d.channels or []))
        return Response({'unread_count': count})


class DesktopNotificationMarkReadView(APIView):
    authentication_classes = [DesktopKeyAuthentication]
    permission_classes = [IsDesktopAuthenticated]

    def post(self, request, delivery_id):
        api_key = request.user
        try:
            delivery = NotificationDelivery.objects.get(id=delivery_id, user__organization=api_key.organization)
        except NotificationDelivery.DoesNotExist:
            return Response({'error': 'Delivery not found in organization scope'}, status=404)
            
        delivery = NotificationService.update_delivery_state(delivery_id, delivery.user, ReadState.READ)
        return Response({'status': 'success', 'read_state': delivery.read_state})


class DesktopNotificationMarkAllReadView(APIView):
    authentication_classes = [DesktopKeyAuthentication]
    permission_classes = [IsDesktopAuthenticated]

    @transaction.atomic
    def post(self, request):
        api_key = request.user
        unread_deliveries = NotificationDelivery.objects.filter(
            user__organization=api_key.organization,
            read_state=ReadState.UNREAD
        )
        count = 0
        for d in unread_deliveries:
            if "DESKTOP" in (d.channels or []):
                NotificationService.update_delivery_state(str(d.id), d.user, ReadState.READ)
                count += 1
        return Response({'status': 'success', 'marked_count': count})


class DesktopNotificationAcknowledgeCriticalView(APIView):
    authentication_classes = [DesktopKeyAuthentication]
    permission_classes = [IsDesktopAuthenticated]

    def post(self, request, delivery_id):
        """Acknowledges a critical notification, making sure it is critical level."""
        api_key = request.user
        try:
            delivery = NotificationDelivery.objects.select_related('notification').get(
                id=delivery_id, 
                user__organization=api_key.organization
            )
        except NotificationDelivery.DoesNotExist:
            return Response({'error': 'Delivery not found in organization scope'}, status=404)
            
        if delivery.notification.level != NotificationLevel.CRITICAL:
            raise ValidationError("Only CRITICAL level notifications require explicit acknowledgment.")
            
        delivery = NotificationService.update_delivery_state(delivery_id, delivery.user, ReadState.READ)
        return Response({
            'status': 'acknowledged',
            'notification_id': str(delivery.notification.id),
            'acknowledged_at': timezone.now()
        })


# ──────────────────────────────────────────────────
# Preferences Endpoints
# ──────────────────────────────────────────────────

class NotificationPreferenceView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        pref, _ = NotificationPreference.objects.get_or_create(user=request.user)
        return Response({
            'system_notifications': pref.system_notifications,
            'workflow_notifications': pref.workflow_notifications,
            'import_notifications': pref.import_notifications,
            'export_notifications': pref.export_notifications,
            'maintenance_notifications': pref.maintenance_notifications,
            'desktop_notifications': pref.desktop_notifications
        })

    def patch(self, request):
        pref, _ = NotificationPreference.objects.get_or_create(user=request.user)
        allowed_fields = [
            'system_notifications', 'workflow_notifications', 'import_notifications',
            'export_notifications', 'maintenance_notifications', 'desktop_notifications'
        ]
        
        for field in allowed_fields:
            if field in request.data:
                val = request.data[field]
                if isinstance(val, str):
                    if val.lower() == 'true':
                        val = True
                    elif val.lower() == 'false':
                        val = False
                    else:
                        raise ValidationError(f"Field {field} must be a boolean.")
                elif not isinstance(val, bool):
                    raise ValidationError(f"Field {field} must be a boolean.")
                setattr(pref, field, val)
                
        pref.save()
        return Response({
            'system_notifications': pref.system_notifications,
            'workflow_notifications': pref.workflow_notifications,
            'import_notifications': pref.import_notifications,
            'export_notifications': pref.export_notifications,
            'maintenance_notifications': pref.maintenance_notifications,
            'desktop_notifications': pref.desktop_notifications
        })
