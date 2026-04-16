"""
Card Print URL Configuration
=============================
Page view + API endpoints for the card print workflow.
Mounted at /panel/print/ in config/urls.py.
"""
from django.urls import path
from . import views

app_name = 'cardprint'

urlpatterns = [
    # ── Print Cards page ──
    path('table/<int:table_id>/', views.print_cards, name='print_cards'),

    # ── Generate Card pages ──
    path('generate-card/table/<int:table_id>/', views.generate_card, name='generate_card'),

    # ── Print Cards API endpoints ──
    path('api/table/<int:table_id>/send/', views.api_print_send, name='api_print_send'),
    path('api/table/<int:table_id>/step-counts/', views.api_print_step_counts, name='api_print_step_counts'),
    path('api/table/<int:table_id>/generate-list/', views.api_print_generate_list, name='api_print_generate_list'),
    path('api/table/<int:table_id>/field-config/', views.api_field_config_save, name='api_field_config_save'),
    path('api/table/<int:table_id>/finalized-list/', views.api_print_finalized_list, name='api_print_finalized_list'),
    path('api/table/<int:table_id>/mark-pool/', views.api_print_mark_pool, name='api_print_mark_pool'),
    path('api/table/<int:table_id>/retrieve-generate/', views.api_print_retrieve_generate, name='api_print_retrieve_generate'),
    path('api/table/<int:table_id>/retrieve-finalized/', views.api_print_retrieve_finalized, name='api_print_retrieve_finalized'),
    path('api/table/<int:table_id>/pool-list/', views.api_print_pool_list, name='api_print_pool_list'),

    # ── New Template-Driven API endpoints ──
    path('api/templates/<int:ref_id>/', views.api_templates, name='api_templates'),
    path('api/template/<int:template_id>/', views.api_template_detail, name='api_template_detail'),
    path('api/template/<int:template_id>/duplicate/', views.api_template_duplicate, name='api_template_duplicate'),
    path('api/template/<int:template_id>/set-default/', views.api_template_set_default, name='api_template_set_default'),

    # ── Generate Card API endpoints ──
    path('api/generate-card/table/<int:table_id>/template/', views.api_template_get, name='api_template_get'),
    path('api/generate-card/table/<int:table_id>/template/save/', views.api_template_save, name='api_template_save'),
    path('api/generate-card/table/<int:table_id>/template/upload-pdf/<str:side>/', views.api_template_upload_pdf, name='api_template_upload_pdf'),
    path('api/generate-card/table/<int:table_id>/template/clear-pdf/<str:side>/', views.api_template_clear_pdf, name='api_template_clear_pdf'),
    path('api/generate-card/table/<int:table_id>/template/doc-layouts/', views.api_template_doc_layout_list, name='api_template_doc_layout_list'),
    path('api/generate-card/table/<int:table_id>/template/doc-layouts/save/', views.api_template_doc_layout_save, name='api_template_doc_layout_save'),
    path('api/generate-card/table/<int:table_id>/template/doc-layouts/apply/<str:layout_id>/', views.api_template_doc_layout_apply, name='api_template_doc_layout_apply'),
    path('api/generate-card/table/<int:table_id>/template/doc-layouts/download/<str:layout_id>/', views.api_template_doc_layout_download, name='api_template_doc_layout_download'),
    path('api/generate-card/table/<int:table_id>/cards/', views.api_generate_card_list, name='api_generate_card_list'),
    path('api/generate-card/table/<int:table_id>/generate/', views.api_generate_pdf, name='api_generate_pdf'),
]
