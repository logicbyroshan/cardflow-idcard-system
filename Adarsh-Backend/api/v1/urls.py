from django.urls import path, include

urlpatterns = [
    path('', include('apps.hardening.urls')),
    
    path('', include('apps.users.urls')),
    path('', include('apps.organizations.urls')),
    path('', include('apps.permissions.urls')),
    path('', include('apps.impersonation.urls')),
    path('', include('apps.tables.urls')),
    path('', include('apps.fields.urls')),
    path('', include('apps.cards.urls')),
    path('', include('apps.workflow.urls')),
    path('', include('apps.jobs.urls')),
    path('', include('apps.mediafiles.urls')),
    path('', include('apps.imports.urls')),
    path('', include('apps.exports.urls')),
    path('', include('apps.sandbox.urls')),
    path('', include('apps.pro.urls')),
    path('', include('apps.desktop_sync.urls')),
    path('', include('apps.operations.urls')),
    path('notifications/', include('apps.notifications.urls')),
    path('reprints/', include('apps.reprints.urls')),
]

