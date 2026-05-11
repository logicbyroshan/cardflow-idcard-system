from django.urls import path
from django.views.generic import RedirectView
from . import views

# Set the app name for namespacing (e.g., {% url 'website:home' %})
app_name = 'website'

urlpatterns = [
    # Public website PWA endpoints (desktop/mobile browser install support)
    path('manifest.json', views.pwa_manifest, name='pwa_manifest'),
    path('sw.js', views.pwa_service_worker, name='pwa_service_worker'),

    # --- Main Navigation Pages ---
    path('', views.home, name='home'),

    # Panel entry gateway (website button -> panel)
    path('panel-entry/', views.panel_entry, name='panel_entry'),
    path('download-app/', views.download_app, name='download_app'),
    
    path('our-products/', views.our_work, name='our_work'),
    path('our-work/', RedirectView.as_view(pattern_name='website:our_work', permanent=True), name='our_work_legacy'),
    
    # New Semantic URLs for Categories and Products
    path('products/<slug:slug>/', views.category_detail, name='category_detail'),
    path('products/<slug:category_slug>/<slug:slug>/', views.product_detail, name='product_detail'),

    path('why-choose-us/', views.why_choose_us, name='why_choose_us'),
    
    # Linked to testimonials_page in views.py
    path('trusted-clients/', views.trusted_clients_page, name='trusted_clients'),
    path('testimonials/', views.testimonials_page, name='testimonials'),

    # --- Legal Pages ---
    path('privacy-policy/', views.privacy_policy, name='privacy_policy'),

    # --- Form Submissions (AJAX Endpoints) ---
    path('submit-contact/', views.submit_contact, name='submit_contact'),
    path('submit-testimonial/', views.submit_testimonial, name='submit_testimonial'),
    path('testimonial-helpful/', views.mark_testimonial_helpful, name='mark_testimonial_helpful'),
    
    # --- API Endpoints ---
    path('api/category-items/', views.load_more_category_items, name='load_more_category_items'),
    
]
