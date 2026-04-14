from django.urls import path
from django.views.generic import RedirectView
from . import views

# Set the app name for namespacing (e.g., {% url 'website:home' %})
app_name = 'website'

urlpatterns = [
    # --- Main Navigation Pages ---
    path('', views.home, name='home'),

    # Panel entry gateway (website button -> panel)
    path('panel-entry/', views.panel_entry, name='panel_entry'),
    
    path('our-products/', views.our_work, name='our_work'),
    path('our-work/', RedirectView.as_view(pattern_name='website:our_work', permanent=True), name='our_work_legacy'),
    
    path('why-choose-us/', views.why_choose_us, name='why_choose_us'),
    
    # Linked to testimonials_page in views.py
    path('testimonials/', views.testimonials_page, name='testimonials'),

    # --- Legal Pages ---
    path('privacy-policy/', views.privacy_policy, name='privacy_policy'),

    # --- Form Submissions (AJAX Endpoints) ---
    path('submit-contact/', views.submit_contact, name='submit_contact'),
    path('submit-testimonial/', views.submit_testimonial, name='submit_testimonial'),
    path('testimonial-helpful/', views.mark_testimonial_helpful, name='mark_testimonial_helpful'),
    
    # --- API Endpoints ---
    path('api/reels/', views.load_more_reels, name='load_more_reels'),
    path('api/category-items/', views.load_more_category_items, name='load_more_category_items'),
]
