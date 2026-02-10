from django.urls import path
from . import views

# Set the app name for namespacing (e.g., {% url 'website:home' %})
app_name = 'website'

urlpatterns = [
    # --- Main Navigation Pages ---
    path('', views.home, name='home'),
    
    path('our-work/', views.our_work, name='our_work'),
    
    path('why-choose-us/', views.why_choose_us, name='why_choose_us'),
    
    # Linked to testimonials_page in views.py
    path('testimonials/', views.testimonials_page, name='testimonials'),

    # --- Legal Pages ---
    path('privacy-policy/', views.privacy_policy, name='privacy_policy'),

    # --- Form Submissions (AJAX Endpoints) ---
    path('submit-contact/', views.submit_contact, name='submit_contact'),
    path('submit-testimonial/', views.submit_testimonial, name='submit_testimonial'),
    
    # --- API Endpoints ---
    path('api/reels/', views.load_more_reels, name='load_more_reels'),
]
