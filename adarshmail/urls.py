"""
Adarsh Mail URL Configuration
==============================
Page view + internal mail APIs + email infrastructure APIs.
Mounted at /panel/mail/ in config/urls.py.
"""
from django.urls import path
from . import views

app_name = 'adarshmail'

urlpatterns = [
    # ── Page view ─────────────────────────────────────────────────────
    path('', views.mail_inbox, name='inbox'),

    # ── Internal mail APIs (3-panel UI) ───────────────────────────────
    path('api/folder/<str:folder>/', views.api_folder, name='api_folder'),
    path('api/counts/', views.api_counts, name='api_counts'),
    path('api/message/<int:message_id>/', views.api_detail, name='api_detail'),
    path('api/compose/', views.api_compose, name='api_compose'),
    path('api/trash/<int:message_id>/', views.api_trash, name='api_trash'),
    path('api/restore/<int:message_id>/', views.api_restore, name='api_restore'),
    path('api/delete/<int:message_id>/', views.api_delete, name='api_delete'),
    path('api/recipients/', views.api_recipients, name='api_recipients'),

    # ── Email infrastructure APIs ─────────────────────────────────────
    path('api/email/send/', views.api_email_send, name='api_email_send'),
    path('api/email/inbox/', views.api_email_inbox, name='api_email_inbox'),
    path('api/email/<uuid:email_uuid>/', views.api_email_detail, name='api_email_detail'),
    path('api/email/inbound-webhook/', views.api_inbound_webhook, name='api_inbound_webhook'),

    # ── Dev / test endpoints ──────────────────────────────────────────
    path('dev/simulate-incoming-email/', views.dev_simulate_incoming, name='dev_simulate_incoming'),
]
