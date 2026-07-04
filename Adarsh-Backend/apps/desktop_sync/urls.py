from django.urls import path
from apps.desktop_sync.views import (
    # Key management (JWT)
    DesktopKeyListView, DesktopKeyDetailView,
    # Desktop-key authed
    DesktopVerifyView,
    DesktopTableListView, DesktopTableMetaView,
    DesktopCardListView, DesktopCardDetailView, DesktopCardDatasetView,
    DesktopImageMetaView, DesktopImageDownloadView,
    DesktopImageBatchView, DesktopImageReplaceView,
    DesktopPrintRequestView,
    DesktopSyncStartView, DesktopSyncCompleteView, DesktopSyncListView,
    DesktopAccessLogView,
)

urlpatterns = [
    # ─── Key Management (JWT) ─────────────────────────────────────────────────
    path('desktop/keys/', DesktopKeyListView.as_view(), name='desktop-key-list'),
    path('desktop/keys/<uuid:pk>/', DesktopKeyDetailView.as_view(), name='desktop-key-detail'),

    # ─── Desktop Key Auth ─────────────────────────────────────────────────────
    path('desktop/verify/', DesktopVerifyView.as_view(), name='desktop-verify'),

    # ─── Tables ──────────────────────────────────────────────────────────────
    path('desktop/tables/', DesktopTableListView.as_view(), name='desktop-table-list'),
    path('desktop/tables/<uuid:table_id>/metadata/', DesktopTableMetaView.as_view(), name='desktop-table-meta'),
    path('desktop/tables/<uuid:table_id>/cards/', DesktopCardListView.as_view(), name='desktop-card-list'),
    path('desktop/tables/<uuid:table_id>/dataset/', DesktopCardDatasetView.as_view(), name='desktop-card-dataset'),

    # ─── Cards ───────────────────────────────────────────────────────────────
    path('desktop/cards/<uuid:card_id>/', DesktopCardDetailView.as_view(), name='desktop-card-detail'),
    path('desktop/cards/<uuid:card_id>/images/', DesktopImageMetaView.as_view(), name='desktop-image-meta'),
    path('desktop/cards/<uuid:card_id>/images/replace/', DesktopImageReplaceView.as_view(), name='desktop-image-replace'),

    # ─── Images ──────────────────────────────────────────────────────────────
    path('desktop/images/<uuid:media_file_id>/download/', DesktopImageDownloadView.as_view(), name='desktop-image-download'),
    path('desktop/images/batch/', DesktopImageBatchView.as_view(), name='desktop-image-batch'),

    # ─── Print / Workflow ─────────────────────────────────────────────────────
    path('desktop/print/', DesktopPrintRequestView.as_view(), name='desktop-print'),

    # ─── Sync ────────────────────────────────────────────────────────────────
    path('desktop/sync/', DesktopSyncListView.as_view(), name='desktop-sync-list'),
    path('desktop/sync/start/', DesktopSyncStartView.as_view(), name='desktop-sync-start'),
    path('desktop/sync/<uuid:session_id>/complete/', DesktopSyncCompleteView.as_view(), name='desktop-sync-complete'),

    # ─── Audit ───────────────────────────────────────────────────────────────
    path('desktop/logs/', DesktopAccessLogView.as_view(), name='desktop-logs'),
]
