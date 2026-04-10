from django.contrib import admin
from django.urls import path, include, reverse
from django.conf import settings
from django.contrib.auth.views import redirect_to_login
from website.seo import robots_txt, sitemap_xml
from core.views.health import health_check



def _protected_media_serve(request, path, document_root=None):
    """
    Serve media files with access control for sensitive directories.

    In production (DEBUG=False), protected files are served by Nginx via
    X-Accel-Redirect — Django only performs the auth check then hands off.
    Nginx must have the `location /protected-media/` block marked `internal;`
    (see deployment/nginx_example.conf).

    In development (DEBUG=True), Django's `serve()` is used as a fallback.
    """
    from django.http import HttpResponse
    from django.views.static import serve

    def _normalize_media_path(raw_path):
        parts = []
        for part in str(raw_path or '').replace('\\', '/').split('/'):
            part = part.strip()
            if not part or part == '.':
                continue
            if part == '..':
                return ''
            parts.append(part)
        return '/'.join(parts)

    rel_path = _normalize_media_path(path)
    if not rel_path:
        return HttpResponse(status=404)

    # 'adarshimg/'    - client ID card photos (personal data, most sensitive)
    # 'exports/'      - generated PDF/Excel/Word/ZIP exports
    # 'clients_imgs/' - client profile images
    # 'staff_imgs/'   - staff profile images
    # 'temp/'         - temporary upload holding area
    PROTECTED_PREFIXES = (
        'adarshimg/',
        'exports/',
        'clients_imgs/',
        'staff_imgs/',
        'temp/',
    )
    if any(rel_path.startswith(p) for p in PROTECTED_PREFIXES):
        if not request.user.is_authenticated:
            # Redirect to login, preserving the original URL in ?next=
            # so the user is returned here after successful authentication.
            login_url = reverse('accounts:login')
            return redirect_to_login(request.get_full_path(), login_url=login_url)

        from core.models import BackgroundTask
        from core.services.permission_service import PermissionService

        # Super admin/pro_user keeps unrestricted access to protected media.
        if not PermissionService.is_super_admin(request.user):
            # For card photos, enforce client ownership by folder code.
            if rel_path.startswith('adarshimg/'):
                from client.models import Client

                parts = rel_path.split('/')
                folder_code = ''
                if len(parts) >= 3 and parts[1].lower() == 'thumbs':
                    folder_code = parts[2]
                elif len(parts) >= 2:
                    folder_code = parts[1]

                client = Client.objects.filter(image_folder_code=folder_code).only('id').first() if folder_code else None
                if not client or not PermissionService.can_access_client(request.user, client.id):
                    return HttpResponse(status=404)

            # For async export files, only the owning user can access.
            elif rel_path.startswith('exports/'):
                owns_file = BackgroundTask.objects.filter(
                    user=request.user,
                    result_path=rel_path,
                ).exists()
                if not owns_file:
                    return HttpResponse(status=404)

            # For all other protected folders, keep access to admins only.
            elif not PermissionService.is_any_admin(request.user):
                return HttpResponse(status=404)

    # Production with Nginx: serve via X-Accel-Redirect (zero-copy, non-blocking).
    # Requires MEDIA_USE_XACCEL=true in env AND the Nginx internal
    # /protected-media/ location block (see deployment/nginx_example.conf).
    if getattr(settings, 'MEDIA_USE_XACCEL', False):
        response = HttpResponse()
        response['X-Accel-Redirect'] = f'/protected-media/{rel_path}'
        response['Content-Type'] = ''  # let Nginx detect from file extension
        return response

    # Fallback: Django serves the file directly (dev + prod without X-Accel)
    return serve(request, rel_path, document_root=document_root)


urlpatterns = [
    # Health check — no auth, used by load balancers / CI/CD
    path('api/health/', health_check, name='health_check'),

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
    path('panel/work/', include('idcards.urls')),
    path('panel/print/', include('cardprint.urls')),
    path('panel/reprint/', include('reprintcard.urls')),
    path('panel/website/', include('website.admin_urls')),

    # ==================== PWA MOBILE APP (/app/) ====================
    path('app/', include('mobile_app.urls')),

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

handler400 = 'core.views.errors.error_400'
handler403 = 'core.views.errors.error_403'
handler404 = 'core.views.errors.error_404'
handler500 = 'core.views.errors.error_500'


