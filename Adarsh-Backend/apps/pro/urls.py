from django.urls import path
from apps.pro.views import (
    ImpersonationStartView, ImpersonationEndView, ImpersonationListView,
    ClientActivationView,
    MaintenanceModeListView, MaintenanceModeDisableView,
    AnnouncementListView, AnnouncementDeactivateView,
    FeatureFlagListView, ClientFeatureFlagView,
    StatisticsView, StatisticsHistoryView,
    AuditDashboardView,
    BackupListView, BackupDownloadView,
    ProDashboardView,
)

urlpatterns = [
    # Dashboard
    path('pro/dashboard/', ProDashboardView.as_view(), name='pro-dashboard'),

    # Impersonation
    path('pro/impersonate/', ImpersonationListView.as_view(), name='pro-impersonate-list'),
    path('pro/impersonate/start/', ImpersonationStartView.as_view(), name='pro-impersonate-start'),
    path('pro/impersonate/<uuid:session_id>/end/', ImpersonationEndView.as_view(), name='pro-impersonate-end'),

    # Client Activation
    path('pro/clients/<uuid:org_id>/<str:action>/', ClientActivationView.as_view(), name='pro-client-activation'),

    # Maintenance
    path('pro/maintenance/', MaintenanceModeListView.as_view(), name='pro-maintenance-list'),
    path('pro/maintenance/<uuid:pk>/', MaintenanceModeDisableView.as_view(), name='pro-maintenance-disable'),

    # Announcements
    path('pro/announcements/', AnnouncementListView.as_view(), name='pro-announcement-list'),
    path('pro/announcements/<uuid:pk>/', AnnouncementDeactivateView.as_view(), name='pro-announcement-deactivate'),

    # Feature Flags
    path('pro/flags/', FeatureFlagListView.as_view(), name='pro-flags-list'),
    path('pro/flags/<str:key>/', FeatureFlagListView.as_view(), name='pro-flags-set'),
    path('pro/flags/<uuid:org_id>/client/', ClientFeatureFlagView.as_view(), name='pro-flags-client'),

    # Statistics
    path('pro/statistics/', StatisticsView.as_view(), name='pro-statistics'),
    path('pro/statistics/generate/', StatisticsView.as_view(), name='pro-statistics-generate'),
    path('pro/statistics/history/', StatisticsHistoryView.as_view(), name='pro-statistics-history'),

    # Audit Dashboard
    path('pro/audit/', AuditDashboardView.as_view(), name='pro-audit'),

    # Backups
    path('pro/backups/', BackupListView.as_view(), name='pro-backup-list'),
    path('pro/backups/<uuid:pk>/download/', BackupDownloadView.as_view(), name='pro-backup-download'),
]
