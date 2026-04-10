"""
Website Admin URL Configuration

Mounted at /panel/website/ in config/urls.py
"""
from django.urls import path
from . import admin_views

app_name = 'website_admin'

urlpatterns = [
    # ==========================================================================
    # PAGE VIEWS
    # ==========================================================================
    path('', admin_views.website_dashboard, name='dashboard'),
    path('business/', admin_views.business_details_page, name='business'),
    path('clients/', admin_views.clients_page, name='clients'),
    path('reviews/', admin_views.reviews_page, name='reviews'),
    path('portfolio/', admin_views.portfolio_page, name='portfolio'),

    # ==========================================================================
    # API — Website Status
    # ==========================================================================
    path('api/status/summary/', admin_views.api_website_status_summary, name='api_status_summary'),
    path('api/status/toggle/', admin_views.api_toggle_website_status, name='api_status_toggle'),
    path('api/status/not-found/', admin_views.api_set_website_not_found_mode, name='api_status_not_found'),
    path('api/status/pro-access-link/', admin_views.api_send_pro_panel_access_link, name='api_status_pro_access_link'),

    # ==========================================================================
    # API — Business Details
    # ==========================================================================
    path('api/business/update/', admin_views.api_business_update, name='api_business_update'),
    path('api/business/toggle-status/', admin_views.api_business_toggle_status, name='api_business_toggle'),

    # ==========================================================================
    # API — Client Logos (main Client model)
    # ==========================================================================
    path('api/clients/', admin_views.api_client_list, name='api_client_list'),
    path('api/clients/create/', admin_views.api_client_create, name='api_client_create'),
    path('api/clients/<int:pk>/', admin_views.api_client_get, name='api_client_get'),
    path('api/clients/<int:pk>/update/', admin_views.api_client_update, name='api_client_update'),
    path('api/clients/<int:pk>/delete/', admin_views.api_client_delete, name='api_client_delete'),
    path('api/clients/<int:pk>/toggle/', admin_views.api_client_toggle, name='api_client_toggle'),

    # ==========================================================================
    # API — Reviews / Testimonials
    # ==========================================================================
    path('api/reviews/', admin_views.api_review_list, name='api_review_list'),
    path('api/reviews/create/', admin_views.api_review_create, name='api_review_create'),
    path('api/reviews/<int:pk>/', admin_views.api_review_get, name='api_review_get'),
    path('api/reviews/<int:pk>/update/', admin_views.api_review_update, name='api_review_update'),
    path('api/reviews/<int:pk>/delete/', admin_views.api_review_delete, name='api_review_delete'),
    path('api/reviews/<int:pk>/toggle/', admin_views.api_review_toggle, name='api_review_toggle'),

    # ==========================================================================
    # API — Portfolio / Our Works
    # ==========================================================================
    path('api/portfolio/', admin_views.api_portfolio_list, name='api_portfolio_list'),
    path('api/portfolio/create/', admin_views.api_portfolio_create, name='api_portfolio_create'),
    path('api/portfolio/bulk-upload/', admin_views.api_portfolio_bulk_upload, name='api_portfolio_bulk_upload'),
    path('api/portfolio/<int:pk>/', admin_views.api_portfolio_get, name='api_portfolio_get'),
    path('api/portfolio/<int:pk>/update/', admin_views.api_portfolio_update, name='api_portfolio_update'),
    path('api/portfolio/<int:pk>/delete/', admin_views.api_portfolio_delete, name='api_portfolio_delete'),
    path('api/portfolio/<int:pk>/toggle/', admin_views.api_portfolio_toggle, name='api_portfolio_toggle'),

    # ==========================================================================
    # API — Portfolio Categories
    # ==========================================================================
    path('api/portfolio-categories/', admin_views.api_portfolio_category_list, name='api_portfolio_category_list'),
    path('api/portfolio-categories/create/', admin_views.api_portfolio_category_create, name='api_portfolio_category_create'),
    path('api/portfolio-categories/<int:pk>/update/', admin_views.api_portfolio_category_update, name='api_portfolio_category_update'),
    path('api/portfolio-categories/<int:pk>/delete/', admin_views.api_portfolio_category_delete, name='api_portfolio_category_delete'),

    # ==========================================================================
    # API — Hero Images
    # ==========================================================================
    path('api/hero-images/', admin_views.api_hero_image_list, name='api_hero_image_list'),
    path('api/hero-images/create/', admin_views.api_hero_image_create, name='api_hero_image_create'),
    path('api/hero-images/<int:pk>/update/', admin_views.api_hero_image_update, name='api_hero_image_update'),
    path('api/hero-images/<int:pk>/delete/', admin_views.api_hero_image_delete, name='api_hero_image_delete'),
    path('api/hero-images/reorder/', admin_views.api_hero_image_reorder, name='api_hero_image_reorder'),

    # ==========================================================================
    # PAGE VIEW — Reels
    # ==========================================================================
    path('reels/', admin_views.reels_page, name='reels'),

    # ==========================================================================
    # API — Reels
    # ==========================================================================
    path('api/reels/', admin_views.api_reel_list, name='api_reel_list'),
    path('api/reels/create/', admin_views.api_reel_create, name='api_reel_create'),
    path('api/reels/<int:pk>/', admin_views.api_reel_get, name='api_reel_get'),
    path('api/reels/<int:pk>/update/', admin_views.api_reel_update, name='api_reel_update'),
    path('api/reels/<int:pk>/delete/', admin_views.api_reel_delete, name='api_reel_delete'),
    path('api/reels/<int:pk>/toggle/', admin_views.api_reel_toggle, name='api_reel_toggle'),

    # ==========================================================================
    # PAGE VIEW — Contact Messages
    # ==========================================================================
    path('contacts/', admin_views.contacts_page, name='contacts'),

    # ==========================================================================
    # API — Contact Messages
    # ==========================================================================
    path('api/contacts/', admin_views.api_contact_list, name='api_contact_list'),
    path('api/contacts/<int:pk>/', admin_views.api_contact_get, name='api_contact_get'),
    path('api/contacts/<int:pk>/status/', admin_views.api_contact_update_status, name='api_contact_update_status'),
    path('api/contacts/<int:pk>/delete/', admin_views.api_contact_delete, name='api_contact_delete'),
]
