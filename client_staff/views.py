"""
Client Staff Views — DEPRECATED

This module is deprecated. All client staff management has been moved to the
`client` app under `/panel/client/staff/`.

The old Django Group/Permission system has been replaced by BooleanField-based
permissions on the Staff model (`core.models.Staff`), managed via:
  - client/views.py (views)
  - client/services.py (ClientStaffService)
  - core/services/permission_service.py (PermissionService)

All endpoints below redirect to the new system.
"""
from django.shortcuts import redirect
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required


@login_required
def staff_management_page(request):
    """Redirect to new client staff management page."""
    return redirect('/panel/client/staff/')


@login_required
def api_staff_list_create(request):
    """Deprecated — use /panel/client/api/staff/ instead."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated. Use /panel/client/api/staff/ instead.'
    }, status=410)


@login_required
def api_staff_detail(request, staff_id):
    """Deprecated — use /panel/client/api/staff/<id>/ instead."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated. Use /panel/client/api/staff/<id>/ instead.'
    }, status=410)


@login_required
def api_staff_toggle_status(request, staff_id):
    """Deprecated — use /panel/client/api/staff/<id>/toggle-status/ instead."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated. Use /panel/client/api/staff/<id>/toggle-status/ instead.'
    }, status=410)


@login_required
def api_staff_reset_password(request, staff_id):
    """Deprecated."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated.'
    }, status=410)


@login_required
def api_available_permissions(request):
    """Deprecated."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated.'
    }, status=410)


@login_required
def api_staff_permissions(request, staff_id):
    """Deprecated."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated.'
    }, status=410)


@login_required
def api_my_permissions(request):
    """Deprecated."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated.'
    }, status=410)


@login_required
def api_upload_data(request):
    """Deprecated."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated.'
    }, status=410)


@login_required
def api_verify_data(request):
    """Deprecated."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated.'
    }, status=410)


@login_required
def api_upload_images(request):
    """Deprecated."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated.'
    }, status=410)


@login_required
def api_view_workflow(request):
    """Deprecated."""
    return JsonResponse({
        'success': False,
        'error': 'This endpoint is deprecated.'
    }, status=410)
