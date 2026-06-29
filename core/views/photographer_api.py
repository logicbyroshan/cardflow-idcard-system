import json
import logging
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.core.paginator import Paginator
from django.db.models import Q
from django.utils.timezone import localtime

from core.models import User, Photographer, PhotographerAssignment
from client.models import Client
from ..services.permission_service import require_super_admin, api_require_super_admin
from core.services.photographer_service import PhotographerService
from core.views.base_helpers import get_user_role, get_page_range
from accounts.rate_limit import rate_limit

logger = logging.getLogger(__name__)


def _apply_drawer_embed_frame_headers(request, response):
    if request.GET.get('embed') == 'drawer':
        response['X-Frame-Options'] = 'SAMEORIGIN'
    return response


def _parse_json_object(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None, JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)
    if not isinstance(data, dict):
        return None, JsonResponse({'success': False, 'message': 'Invalid JSON data'}, status=400)
    return data, None


@require_super_admin
def manage_photographers(request):
    """View to manage photographers — supports HTMX partial responses."""
    DEFAULT_PER_PAGE = 25
    PER_PAGE_OPTIONS = [5, 10, 25, 50, 100]

    try:
        per_page = int(request.GET.get('per_page', DEFAULT_PER_PAGE))
        if per_page not in PER_PAGE_OPTIONS:
            per_page = DEFAULT_PER_PAGE
    except (ValueError, TypeError):
        per_page = DEFAULT_PER_PAGE

    search_query = request.GET.get('search', '').strip()
    status_filter = request.GET.get('status', '').strip()

    staff_qs = Photographer.objects.select_related('user').prefetch_related('photographer_assignments__client').order_by('-id')

    if search_query:
        staff_qs = staff_qs.filter(
            Q(user__first_name__icontains=search_query) |
            Q(user__last_name__icontains=search_query) |
            Q(user__email__icontains=search_query) |
            Q(user__phone__icontains=search_query) |
            Q(user__username__icontains=search_query)
        )

    if status_filter == 'active':
        staff_qs = staff_qs.filter(user__is_active=True)
    elif status_filter == 'inactive':
        staff_qs = staff_qs.filter(user__is_active=False)

    paginator = Paginator(staff_qs, per_page)
    page_obj = paginator.get_page(request.GET.get('page', 1))

    # Fetch active clients for assignment dropdown
    active_clients = Client.objects.filter(status='active', is_guest=False).order_by('name').values('id', 'name')

    # Detect if request is HTMX
    is_htmx = request.headers.get('HX-Request') == 'true'

    context = {
        'active_page': 'manage_photographers',
        'user_role': get_user_role(request.user),
        'staff_list': page_obj.object_list,
        'page_obj': page_obj,
        'page_range': get_page_range(page_obj),
        'per_page': per_page,
        'per_page_options': PER_PAGE_OPTIONS,
        'search_query': search_query,
        'status_filter': status_filter,
        'active_clients': list(active_clients),
    }

    if is_htmx:
        response = render(request, 'partials/photographer/table-container.html', context)
        return _apply_drawer_embed_frame_headers(request, response)

    response = render(request, 'manage-photographers.html', context)
    return _apply_drawer_embed_frame_headers(request, response)


@require_http_methods(["POST"])
@api_require_super_admin
@rate_limit(max_requests=10, window_seconds=60, key_prefix='photographer_create')
def api_photographer_create(request):
    """API endpoint to create a new photographer"""
    try:
        data, json_err = _parse_json_object(request)
        if json_err:
            return json_err

        result = PhotographerService.create(data, request=request)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except Exception as e:
        logger.exception("Photographer API create error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)


@require_http_methods(["GET"])
@api_require_super_admin
@rate_limit(max_requests=60, window_seconds=60, key_prefix='photographer_get')
def api_photographer_get(request, staff_id):
    """API endpoint to get photographer details"""
    result = PhotographerService.get(staff_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["PUT", "POST"])
@api_require_super_admin
def api_photographer_update(request, staff_id):
    """API endpoint to update photographer details"""
    try:
        data, json_err = _parse_json_object(request)
        if json_err:
            return json_err

        result = PhotographerService.update(staff_id, data)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except Exception as e:
        logger.exception("Photographer API update error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)


@require_http_methods(["DELETE", "POST"])
@api_require_super_admin
@rate_limit(max_requests=5, window_seconds=60, key_prefix='photographer_delete')
def api_photographer_delete(request, staff_id):
    """API endpoint to delete a photographer"""
    result = PhotographerService.delete(staff_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST"])
@api_require_super_admin
def api_photographer_toggle_status(request, staff_id):
    """API endpoint to toggle photographer active/inactive status"""
    result = PhotographerService.toggle_status(staff_id)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["POST"])
@api_require_super_admin
def api_photographer_assign_clients(request, staff_id):
    """API endpoint to update ONLY the client assignments for a photographer (no profile fields needed)"""
    try:
        data, json_err = _parse_json_object(request)
        if json_err:
            return json_err

        from django.utils.dateparse import parse_datetime
        from core.models import PhotographerAssignment
        from django.db import transaction

        try:
            staff = Photographer.objects.get(id=staff_id)
        except Photographer.DoesNotExist:
            return JsonResponse({'success': False, 'message': 'Photographer not found'}, status=404)

        assigned_clients = data.get('assigned_clients', [])
        if isinstance(assigned_clients, str):
            try:
                import json as _json
                assigned_clients = _json.loads(assigned_clients)
            except Exception:
                assigned_clients = []

        with transaction.atomic():
            existing = {a.client_id: a for a in staff.photographer_assignments.all()}
            keep_client_ids = set()

            for item in assigned_clients:
                try:
                    client_id = int(item.get('client_id'))
                    expires_at_str = item.get('expires_at')
                    expires_at = parse_datetime(expires_at_str) if expires_at_str else None

                    if client_id in existing:
                        assignment = existing[client_id]
                        assignment.expires_at = expires_at
                        raw_table_ids = item.get('allowed_table_ids', [])
                        assignment.allowed_table_ids = [int(t) for t in raw_table_ids if str(t).isdigit()] if raw_table_ids else []
                        assignment.save()
                    else:
                        raw_table_ids = item.get('allowed_table_ids', [])
                        allowed_table_ids = [int(t) for t in raw_table_ids if str(t).isdigit()] if raw_table_ids else []
                        PhotographerAssignment.objects.create(
                            photographer=staff,
                            client_id=client_id,
                            expires_at=expires_at,
                            allowed_table_ids=allowed_table_ids,
                        )
                    keep_client_ids.add(client_id)
                except (ValueError, TypeError):
                    pass

            staff.photographer_assignments.exclude(client_id__in=keep_client_ids).delete()

        return JsonResponse({'success': True, 'message': 'Client assignments saved successfully'})
    except Exception as e:
        logger.exception("Photographer assign clients error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)


@require_http_methods(["GET"])
@api_require_super_admin
def api_photographer_client_tables(request, client_id):
    """Return all groups and their tables for a client — used by assignment drawer."""
    try:
        from idcards.models import IDCardGroup, IDCardTable
        groups = IDCardGroup.objects.filter(client_id=client_id, is_active=True).order_by('name')
        result = []
        for group in groups:
            tables = IDCardTable.objects.filter(
                group=group, deleted_by_client=False
            ).order_by('name').values('id', 'name', 'is_active')
            result.append({
                'group_id': group.id,
                'group_name': group.name,
                'tables': [{'id': t['id'], 'name': t['name'], 'is_active': t['is_active']} for t in tables],
            })
        return JsonResponse({'success': True, 'groups': result})
    except Exception as e:
        logger.exception("Photographer client tables error: %s", e)
        return JsonResponse({'success': False, 'message': 'An error occurred'}, status=400)
