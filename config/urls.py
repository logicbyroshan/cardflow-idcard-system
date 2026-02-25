from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import HttpResponseForbidden
from website.seo import robots_txt, sitemap_xml
from core.views.health import health_check


def _serve_pwa_file(request, filename):
    """Serve PWA manifest/service-worker from /static/website/ at root URL."""
    import os
    from django.http import FileResponse, Http404
    content_types = {
        'manifest.json': 'application/manifest+json',
        'sw.js': 'application/javascript',
    }
    filepath = os.path.join(settings.BASE_DIR, 'static', 'website', filename)
    if not os.path.isfile(filepath) or filename not in content_types:
        raise Http404
    response = FileResponse(open(filepath, 'rb'), content_type=content_types[filename])
    if filename == 'sw.js':
        response['Service-Worker-Allowed'] = '/'
        response['Cache-Control'] = 'no-cache'
    return response


def _protected_media_serve(request, path, document_root=None):
    """
    Serve media files with access control for sensitive directories.
    
    Active in both dev (DEBUG=True) and production (as fallback when
    no reverse proxy / cloud storage is configured).
    
    In production, you should serve media via Nginx or S3 instead:
        location /media/ {
            alias /path/to/media/;
            internal;  # only accessible via X-Accel-Redirect
        }
    """
    from django.views.static import serve
    PROTECTED_PREFIXES = ('exports/', 'clients_imgs/', 'staff_imgs/', 'temp/')
    if any(path.startswith(p) for p in PROTECTED_PREFIXES):
        if not request.user.is_authenticated:
            return HttpResponseForbidden('Access denied')
    return serve(request, path, document_root=document_root)

def _serve_mobile_sw(request):
    """Serve mobile PWA service worker with correct Service-Worker-Allowed header."""
    import os
    from django.http import FileResponse, Http404
    filepath = os.path.join(settings.BASE_DIR, 'static', 'mobile', 'sw.js')
    if not os.path.isfile(filepath):
        raise Http404
    response = FileResponse(open(filepath, 'rb'), content_type='application/javascript')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-cache'
    return response


urlpatterns = [
    # Health check — no auth, used by load balancers / CI/CD
    path('api/health/', health_check, name='health_check'),

    # PWA — manifest and service worker at root scope
    path('manifest.json', lambda r: _serve_pwa_file(r, 'manifest.json'), name='pwa_manifest'),
    path('sw.js', lambda r: _serve_pwa_file(r, 'sw.js'), name='pwa_sw'),

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
    path('panel/exports/', include('exports.urls')),
    path('panel/images/', include('mediafiles.urls')),
    path('panel/staff/', include('staff.urls')),
    path('panel/work/', include('workflows.urls')),
    path('panel/website/', include('website.admin_urls')),

    # ==================== PWA MOBILE APP (/app/) ====================
    path('app/manifest.json', lambda r: _serve_pwa_file(r, 'manifest.json'), name='mobile_pwa_manifest'),
    path('app/sw.js', _serve_mobile_sw, name='mobile_pwa_sw'),
    path('app/', include('PWA.mobile_app.urls')),

    # ==================== PUBLIC WEBSITE (/) ====================
    # Public-facing website at root — must be LAST to avoid catching /panel/ routes
    path('', include('website.urls')),
]

# Media file serving — always register the route so uploaded images/exports
# are accessible.  In production with Nginx, the reverse proxy should serve
# /media/ directly; this Django view acts as a safe fallback.
urlpatterns += [
    path('media/<path:path>', _protected_media_serve, {'document_root': settings.MEDIA_ROOT}),
]


