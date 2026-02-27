"""
Card Print URL Configuration
=============================
Page view + API endpoints for the 3-step card print workflow.
Mounted at /panel/print/ in config/urls.py.
"""
from django.urls import path
from . import views

app_name = 'cardprint'

urlpatterns = [
    # Page view
    path('table/<int:table_id>/', views.print_cards, name='print_cards'),

    # API endpoints
    path('api/table/<int:table_id>/send/', views.api_print_send, name='api_print_send'),
    path('api/table/<int:table_id>/list/', views.api_print_list, name='api_print_list'),
    path('api/table/<int:table_id>/step-counts/', views.api_print_step_counts, name='api_print_step_counts'),
    path('api/table/<int:table_id>/generate/', views.api_print_generate, name='api_print_generate'),
    path('api/table/<int:table_id>/finalized-list/', views.api_print_finalized_list, name='api_print_finalized_list'),
    path('api/table/<int:table_id>/remove/', views.api_print_remove, name='api_print_remove'),
    path('api/table/<int:table_id>/mark-pool/', views.api_print_mark_pool, name='api_print_mark_pool'),
    path('api/table/<int:table_id>/pool-list/', views.api_print_pool_list, name='api_print_pool_list'),
]
