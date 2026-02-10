from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from website.seo import robots_txt, sitemap_xml

urlpatterns = [
    # SEO — served at root, only for public website
    path('robots.txt', robots_txt, name='robots_txt'),
    path('sitemap.xml', sitemap_xml, name='sitemap_xml'),

    # Django admin
    path('admin/', admin.site.urls),

    # ==================== ADMIN PANEL (/panel/) ====================
    # All internal/admin routes live under /panel/
    path('panel/', include('core.urls')),
    path('panel/auth/', include('accounts.urls')),
    path('panel/client/', include('client.urls')),
    path('panel/client-staff/', include('client_staff.urls')),
    path('panel/exports/', include('exports.urls')),
    path('panel/images/', include('mediafiles.urls')),
    path('panel/staff/', include('staff.urls')),
    path('panel/work/', include('workflows.urls')),
    path('panel/website/', include('website.admin_urls')),

    # ==================== PUBLIC WEBSITE (/) ====================
    # Public-facing website at root — must be LAST to avoid catching /panel/ routes
    path('', include('website.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)


