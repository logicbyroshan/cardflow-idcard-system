from django.urls import path
from apps.notifications.views import (
    WebNotificationListView, WebNotificationUnreadCountView, WebNotificationMarkReadView,
    WebNotificationMarkAllReadView, WebNotificationArchiveView, WebNotificationDismissView,
    MobileNotificationListView, MobileNotificationUnreadCountView, MobileNotificationMarkReadView,
    MobileNotificationMarkAllReadView,
    DesktopNotificationListView, DesktopNotificationUnreadCountView, DesktopNotificationMarkReadView,
    DesktopNotificationMarkAllReadView, DesktopNotificationAcknowledgeCriticalView,
    NotificationPreferenceView
)

urlpatterns = [
    # Preferences
    path('preferences/', NotificationPreferenceView.as_view(), name='notif-preferences'),

    # Web endpoints
    path('', WebNotificationListView.as_view(), name='web-notif-list'),
    path('unread-count/', WebNotificationUnreadCountView.as_view(), name='web-notif-unread-count'),
    path('<uuid:delivery_id>/read/', WebNotificationMarkReadView.as_view(), name='web-notif-read'),
    path('mark-all-read/', WebNotificationMarkAllReadView.as_view(), name='web-notif-mark-all-read'),
    path('<uuid:delivery_id>/archive/', WebNotificationArchiveView.as_view(), name='web-notif-archive'),
    path('<uuid:delivery_id>/dismiss/', WebNotificationDismissView.as_view(), name='web-notif-dismiss'),

    # Mobile endpoints
    path('mobile/', MobileNotificationListView.as_view(), name='mobile-notif-list'),
    path('mobile/unread-count/', MobileNotificationUnreadCountView.as_view(), name='mobile-notif-unread-count'),
    path('mobile/<uuid:delivery_id>/read/', MobileNotificationMarkReadView.as_view(), name='mobile-notif-read'),
    path('mobile/mark-all-read/', MobileNotificationMarkAllReadView.as_view(), name='mobile-notif-mark-all-read'),

    # Desktop endpoints
    path('desktop/', DesktopNotificationListView.as_view(), name='desktop-notif-list'),
    path('desktop/unread-count/', DesktopNotificationUnreadCountView.as_view(), name='desktop-notif-unread-count'),
    path('desktop/<uuid:delivery_id>/read/', DesktopNotificationMarkReadView.as_view(), name='desktop-notif-read'),
    path('desktop/mark-all-read/', DesktopNotificationMarkAllReadView.as_view(), name='desktop-notif-mark-all-read'),
    path('desktop/<uuid:delivery_id>/acknowledge/', DesktopNotificationAcknowledgeCriticalView.as_view(), name='desktop-notif-acknowledge'),
]
