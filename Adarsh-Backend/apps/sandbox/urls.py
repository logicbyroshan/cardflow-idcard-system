from django.urls import path
from apps.sandbox.views import (
    SandboxSessionView,
    SandboxCardListView,
    SandboxCardDetailView,
    SandboxCardCreateView,
    SandboxWorkflowView,
    SandboxWorkflowHistoryView,
    SandboxImportView,
    SandboxExportView,
    SandboxExportDownloadView,
    SandboxChangesView,
)

urlpatterns = [
    # Session
    path('sandbox/sessions/', SandboxSessionView.as_view(), name='sandbox-session'),

    # Cards
    path('sandbox/cards/', SandboxCardListView.as_view(), name='sandbox-card-list'),
    path('sandbox/cards/create/', SandboxCardCreateView.as_view(), name='sandbox-card-create'),
    path('sandbox/cards/<str:card_id>/', SandboxCardDetailView.as_view(), name='sandbox-card-detail'),

    # Workflow
    path('sandbox/workflow/transition/', SandboxWorkflowView.as_view(), name='sandbox-workflow-transition'),
    path('sandbox/workflow/history/', SandboxWorkflowHistoryView.as_view(), name='sandbox-workflow-history'),

    # Import
    path('sandbox/imports/', SandboxImportView.as_view(), name='sandbox-import'),

    # Export
    path('sandbox/exports/', SandboxExportView.as_view(), name='sandbox-export'),
    path('sandbox/exports/<uuid:pk>/download/', SandboxExportDownloadView.as_view(), name='sandbox-export-download'),

    # Diffs
    path('sandbox/changes/', SandboxChangesView.as_view(), name='sandbox-changes'),
]
