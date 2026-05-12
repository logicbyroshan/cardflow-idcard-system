"""
Manage Website URL Configuration

Routes for the website management dashboard.
Mounted at /dashboard on the main domain (adarshbhopal.in)
"""
from django.urls import path
from . import views

app_name = 'manage_website'

urlpatterns = [
    # ==========================================================================
    # PAGE VIEWS
    # ==========================================================================
    path('', views.website_dashboard, name='dashboard'),
    path('business/', views.business_details_page, name='business'),
    path('clients/', views.clients_page, name='clients'),
    path('reviews/', views.reviews_page, name='reviews'),
    path('portfolio/', views.portfolio_page, name='portfolio'),

    # ==========================================================================
    # API — Website Status
    # ==========================================================================
    path('api/status/summary/', views.api_website_status_summary, name='api_status_summary'),
    path('api/status/toggle/', views.api_toggle_website_status, name='api_status_toggle'),
    path('api/status/not-found/', views.api_set_website_not_found_mode, name='api_status_not_found'),
    path('api/status/pro-access-link/', views.api_send_pro_panel_access_link, name='api_status_pro_access_link'),

    # ==========================================================================
    # API — Business Details
    # ==========================================================================
    path('api/business/update/', views.api_business_update, name='api_business_update'),
    path('api/business/toggle-status/', views.api_business_toggle_status, name='api_business_toggle'),

    # ==========================================================================
    # API — Client Logos (main Client model)
    # ==========================================================================
    path('api/clients/', views.api_client_list, name='api_client_list'),
    path('api/clients/create/', views.api_client_create, name='api_client_create'),
    path('api/clients/<int:pk>/', views.api_client_get, name='api_client_get'),
    path('api/clients/<int:pk>/update/', views.api_client_update, name='api_client_update'),
    path('api/clients/<int:pk>/delete/', views.api_client_delete, name='api_client_delete'),
    path('api/clients/<int:pk>/toggle/', views.api_client_toggle, name='api_client_toggle'),

    # ==========================================================================
    # API — Reviews / Testimonials
    # ==========================================================================
    path('api/reviews/', views.api_review_list, name='api_review_list'),
    path('api/reviews/create/', views.api_review_create, name='api_review_create'),
    path('api/reviews/<int:pk>/', views.api_review_get, name='api_review_get'),
    path('api/reviews/<int:pk>/update/', views.api_review_update, name='api_review_update'),
    path('api/reviews/<int:pk>/delete/', views.api_review_delete, name='api_review_delete'),
    path('api/reviews/<int:pk>/toggle/', views.api_review_toggle, name='api_review_toggle'),

    # ==========================================================================
    # API — Portfolio / Our Works
    # ==========================================================================
    path('api/portfolio/', views.api_portfolio_list, name='api_portfolio_list'),
    path('api/portfolio/create/', views.api_portfolio_create, name='api_portfolio_create'),
    path('api/portfolio/bulk-upload/', views.api_portfolio_bulk_upload, name='api_portfolio_bulk_upload'),
    path('api/portfolio/<int:pk>/', views.api_portfolio_get, name='api_portfolio_get'),
    path('api/portfolio/<int:pk>/update/', views.api_portfolio_update, name='api_portfolio_update'),
    path('api/portfolio/<int:pk>/delete/', views.api_portfolio_delete, name='api_portfolio_delete'),
    path('api/portfolio/<int:pk>/toggle/', views.api_portfolio_toggle, name='api_portfolio_toggle'),

    # ==========================================================================
    # API — Portfolio Categories
    # ==========================================================================
    path('api/portfolio-categories/', views.api_portfolio_category_list, name='api_portfolio_category_list'),
    path('api/portfolio-categories/create/', views.api_portfolio_category_create, name='api_portfolio_category_create'),
    path('api/portfolio-categories/<int:pk>/update/', views.api_portfolio_category_update, name='api_portfolio_category_update'),
    path('api/portfolio-categories/<int:pk>/delete/', views.api_portfolio_category_delete, name='api_portfolio_category_delete'),

    # ==========================================================================
    # PAGE VIEW — Contact Messages
    # ==========================================================================
    path('contacts/', views.contacts_page, name='contacts'),

    # ==========================================================================
    # API — Contact Messages
    # ==========================================================================
    path('api/contacts/', views.api_contact_list, name='api_contact_list'),
    path('api/contacts/<int:pk>/', views.api_contact_get, name='api_contact_get'),
    path('api/contacts/<int:pk>/status/', views.api_contact_update_status, name='api_contact_update_status'),
    path('api/contacts/<int:pk>/delete/', views.api_contact_delete, name='api_contact_delete'),

    # ==========================================================================
    # TEMPORARY MIGRATION EXPORT
    # ==========================================================================
    path('export-migration-data/', views.export_migration_data, name='export_migration_data'),
]
