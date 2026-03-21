"""
Client Views — API endpoints.

JSON API views for the client panel: dashboard data, staff CRUD,
card listing/status changes, image uploads, and group/class helpers.
"""
import json

from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from accounts.rate_limit import rate_limit

from core.services.permission_service import PermissionService

from .views_decorators import require_client_user, require_client_admin
from .services import (
    ClientAccessService,
    ClientDashboardService,
    ClientStaffService,
    ClientCardService,
    ClientImageService,
)


# =============================================================================
# API VIEWS - Dashboard
# =============================================================================

@require_client_user
@require_http_methods(["GET"])
def api_dashboard_data(request):
    """
    API: Get dashboard summary data.
    """
    result = ClientDashboardService.get_dashboard_data(request.user)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'data': result.data
        })
    
    return JsonResponse({
        'success': False,
        'message': result.message
    }, status=400)


@require_client_user
@require_http_methods(["GET"])
def api_reprint_stats(request):
    """
    API: Get reprint statistics for the client dashboard section.
    """
    result = ClientDashboardService.get_reprint_stats(request.user)

    if result.success:
        return JsonResponse({'success': True, 'data': result.data})

    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_client_user
@require_http_methods(["GET"])
def api_reprint_history(request):
    """
    API: Get detailed reprint request history for the client dashboard table.
    """
    result = ClientDashboardService.get_reprint_history(request.user)

    if result.success:
        return JsonResponse({'success': True, 'data': result.data})

    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_client_user
@require_http_methods(["GET"])
def api_groups_list(request):
    """
    API: Get list of groups with card counts.
    """
    # Check permission (matches the page view gate)
    if not PermissionService.has_permission(request.user, 'perm_idcard_setting_list'):
        return JsonResponse({
            'success': False,
            'message': 'Permission denied'
        }, status=403)

    result = ClientDashboardService.get_groups_with_counts(request.user)

    if result.success:
        return JsonResponse({
            'success': True,
            'data': {'groups': result.data.get('groups', [])}
        })
    
    return JsonResponse({
        'success': False,
        'error': result.message
    }, status=400)


# =============================================================================
# API VIEWS - Staff Management


@require_client_admin
@require_http_methods(["GET", "POST"])
def api_staff_list_create(request):
    """
    API: List client staff (GET) or Create new staff (POST).
    """
    if request.method == 'GET':
        result = ClientStaffService.list_staff(request.user)
        if result.success:
            return JsonResponse({
                'success': True,
                'data': {'staff': result.data.get('staff', [])}
            })

        return JsonResponse({
            'success': False,
            'error': result.message
        }, status=400 if 'Permission' not in result.message else 403)

    # POST - Create new staff
    content_type = request.content_type or ''
    if 'multipart/form-data' in content_type:
        data = request.POST.dict()
        # Parse JSON fields sent as strings
        if 'assigned_groups' in data:
            try:
                data['assigned_groups'] = json.loads(data['assigned_groups'])
            except (json.JSONDecodeError, TypeError):
                data['assigned_groups'] = []
        # Parse boolean strings
        for key in list(data.keys()):
            if data[key] in ('true', 'True'):
                data[key] = True
            elif data[key] in ('false', 'False'):
                data[key] = False
    else:
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({
                'success': False,
                'error': 'Invalid JSON data'
            }, status=400)
    
    result = ClientStaffService.create_staff(request.user, data)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'message': result.message,
            'data': {'staff_id': result.data.get('staff_id')}
        })

    status_code = 403 if 'Permission' in result.message else 400
    return JsonResponse({
        'success': False,
        'error': result.message
    }, status=status_code)


@require_client_admin
@require_http_methods(["GET", "PUT", "DELETE"])
@rate_limit(max_requests=90, window_seconds=60, key_prefix='client_staff_detail')
def api_staff_detail(request, staff_id):
    """
    API: Get, Update, or Delete a specific staff member.
    """
    if request.method == 'GET':
        result = ClientStaffService.get_staff_detail(request.user, staff_id)
        
        if result.success:
            return JsonResponse({
                'success': True,
                'data': result.data
            })
        
        return JsonResponse({
            'success': False,
            'error': result.message
        }, status=404 if 'found' in result.message.lower() else 403)
    
    if request.method == 'PUT':
        content_type = request.content_type or ''
        if 'multipart/form-data' in content_type:
            # Django doesn't parse PUT multipart by default
            from django.http.multipartparser import MultiPartParser
            parser = MultiPartParser(request.META, request, request.upload_handlers)
            post_data, files = parser.parse()
            data = post_data.dict()
            # Parse JSON fields sent as strings
            if 'assigned_groups' in data:
                try:
                    data['assigned_groups'] = json.loads(data['assigned_groups'])
                except (json.JSONDecodeError, TypeError):
                    data['assigned_groups'] = []
            # Parse boolean strings
            for key in list(data.keys()):
                if data[key] in ('true', 'True'):
                    data[key] = True
                elif data[key] in ('false', 'False'):
                    data[key] = False
        else:
            try:
                data = json.loads(request.body)
            except json.JSONDecodeError:
                return JsonResponse({
                    'success': False,
                    'error': 'Invalid JSON data'
                }, status=400)
        
        result = ClientStaffService.update_staff(request.user, staff_id, data)
        
        if result.success:
            return JsonResponse({
                'success': True,
                'message': result.message
            })
        
        status_code = 403 if 'Permission' in result.message else 400
        return JsonResponse({
            'success': False,
            'error': result.message
        }, status=status_code)
    
    # DELETE
    result = ClientStaffService.delete_staff(request.user, staff_id)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'message': result.message
        })
    
    status_code = 403 if 'Permission' in result.message else 400
    return JsonResponse({
        'success': False,
        'error': result.message
    }, status=status_code)


@require_client_admin
@require_http_methods(["POST"])
def api_staff_toggle_status(request, staff_id):
    """
    API: Toggle staff member active/inactive status.
    """
    try:
        result = ClientStaffService.toggle_staff_status(request.user, staff_id)
        
        if result.success:
            is_active = result.data.get('is_active', False)
            return JsonResponse({
                'success': True,
                'message': result.message,
                'status': 'active' if is_active else 'inactive',
                'status_display': 'Active' if is_active else 'Inactive',
            })
        
        status_code = 403 if 'Permission' in result.message else 400
        return JsonResponse({
            'success': False,
            'message': result.message
        }, status=status_code)
    except Exception:
        import logging as _logging
        _logging.getLogger(__name__).exception("Staff toggle status error")
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)


@require_client_admin
@require_http_methods(["GET"])
def api_client_groups_list(request):
    """
    API: Get list of ID card groups for the current client.
    Used in staff drawer for group assignment.
    """
    from idcards.models import IDCardGroup  # local import: group listing
    
    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=400)
    
    # Show all client groups so assignment is not limited to only active/default group.
    groups = IDCardGroup.objects.filter(client=client).order_by('name')
    groups_data = [{'id': g.id, 'name': g.name} for g in groups]
    
    return JsonResponse({
        'success': True,
        'groups': groups_data
    })


@require_client_admin
@require_http_methods(["GET"])
def api_class_section_options(request):
    """
    API: Get distinct class and section values from all cards of this client.
    Used in staff drawer for class/section filter assignment.
    """
    from idcards.models import IDCard, IDCardTable
    from idcards.models import IDCardGroup

    user = request.user
    client = ClientAccessService.get_client_for_user(user)
    if not client:
        return JsonResponse({'success': False, 'message': 'Client not found'}, status=400)

    raw_group_ids = request.GET.get('group_ids', '').strip()
    group_ids = []
    if raw_group_ids:
        try:
            group_ids = sorted({int(x) for x in raw_group_ids.split(',') if str(x).strip().isdigit()})
        except Exception:
            group_ids = []

    group_key = ','.join(str(gid) for gid in group_ids) if group_ids else 'all'
    cache_key = f'client:class-section-options:{client.id}:{group_key}'
    cached = cache.get(cache_key)
    if cached is not None:
        return JsonResponse(cached)

    # Resolve effective client group ids. Empty input means all groups.
    valid_group_qs = IDCardGroup.objects.filter(client=client)
    if group_ids:
        valid_group_qs = valid_group_qs.filter(id__in=group_ids)
    effective_group_ids = list(valid_group_qs.values_list('id', flat=True))

    tables = list(IDCardTable.objects.filter(group_id__in=effective_group_ids).values('id', 'fields'))

    classes = set()
    sections = set()
    branches = set()
    class_sections = {}
    table_field_map = {}
    has_class_field = False
    has_section_field = False
    has_branch_field = False

    for table in tables:
        # Determine which field names are class/section/branch type
        class_field = None
        section_field = None
        branch_field = None
        for field in (table.get('fields') or []):
            ft = field.get('type', '').lower()
            fn = field.get('name', '')
            if ft == 'class' or fn.lower() == 'class':
                class_field = fn
            elif ft == 'section' or fn.lower() == 'section':
                section_field = fn
            elif ft == 'branch' or fn.lower() == 'branch':
                branch_field = fn

        if class_field:
            has_class_field = True
        if section_field:
            has_section_field = True
        if branch_field:
            has_branch_field = True

        if class_field or section_field or branch_field:
            table_field_map[table['id']] = (class_field, section_field, branch_field)

    if table_field_map:
        cards = IDCard.objects.filter(table_id__in=table_field_map.keys()).values_list('table_id', 'field_data')
    else:
        cards = []

    for table_id, fd in cards:
        if not fd:
            continue

        class_field, section_field, branch_field = table_field_map.get(table_id, (None, None, None))
        class_val = ''
        section_val = ''
        if class_field:
            val = fd.get(class_field, '') or fd.get(class_field.upper(), '') or fd.get(class_field.lower(), '')
            if val:
                class_val = str(val).strip()
                if class_val:
                    classes.add(class_val)
        if section_field:
            val = fd.get(section_field, '') or fd.get(section_field.upper(), '') or fd.get(section_field.lower(), '')
            if val:
                section_val = str(val).strip()
                if section_val:
                    sections.add(section_val)
        if branch_field:
            val = fd.get(branch_field, '') or fd.get(branch_field.upper(), '') or fd.get(branch_field.lower(), '')
            if val:
                branch_val = str(val).strip()
                if branch_val:
                    branches.add(branch_val)

        # Build class -> sections mapping from actual card rows.
        if class_val:
            if class_val not in class_sections:
                class_sections[class_val] = set()
            if section_val:
                class_sections[class_val].add(section_val)

    payload = {
        'success': True,
        'classes': sorted(classes),
        'sections': sorted(sections),
        'branches': sorted(branches),
        'has_class_field': has_class_field,
        'has_section_field': has_section_field,
        'has_branch_field': has_branch_field,
        'class_sections': {
            cls_name: sorted(sec_values)
            for cls_name, sec_values in sorted(class_sections.items(), key=lambda x: x[0])
        },
    }
    cache.set(cache_key, payload, 120)
    return JsonResponse(payload)


# =============================================================================
# API VIEWS - Card Data
# =============================================================================

@require_client_user
@require_http_methods(["GET"])
def api_tables_list(request):
    """
    API: Get list of tables with card counts.
    """
    # Check permission (matches the groups page gate)
    if not PermissionService.has_permission(request.user, 'perm_idcard_setting_list'):
        return JsonResponse({
            'success': False,
            'message': 'Permission denied'
        }, status=403)

    result = ClientCardService.get_tables_for_client(request.user)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'tables': result.data.get('tables', [])
        })
    
    return JsonResponse({
        'success': False,
        'message': result.message
    }, status=400)


@require_client_user
@require_http_methods(["GET"])
def api_cards_list(request, table_id):
    """
    API: Get cards for a specific table.
    """
    status_filter = request.GET.get('status', '')
    search = request.GET.get('search', '')
    try:
        page = int(request.GET.get('page', 1))
        per_page = int(request.GET.get('per_page', 20))
    except (ValueError, TypeError):
        page, per_page = 1, 20
    offset = (page - 1) * per_page
    
    result = ClientCardService.get_cards(
        request.user,
        table_id,
        status_filter if status_filter else None,
        offset,
        per_page,
        search if search else None
    )
    
    if result.success:
        # Calculate pagination info
        total = result.data.get('total', 0)
        total_pages = (total + per_page - 1) // per_page if total else 1
        
        return JsonResponse({
            'success': True,
            'data': {
                'cards': result.data.get('cards', []),
                'pagination': {
                    'page': page,
                    'per_page': per_page,
                    'total': total,
                    'total_pages': total_pages
                }
            }
        })
    
    status_code = 403 if 'Access' in result.message or 'permission' in result.message.lower() else 400
    return JsonResponse({
        'success': False,
        'error': result.message
    }, status=status_code)


@require_client_user
@require_http_methods(["GET"])
@rate_limit(max_requests=90, window_seconds=60, key_prefix='client_card_detail')
def api_card_detail(request, card_id):
    """
    API: Get details of a specific card.
    """
    result = ClientCardService.get_card_detail(request.user, card_id)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'data': result.data
        })
    
    status_code = 403 if 'Access' in result.message or 'permission' in result.message.lower() else 404
    return JsonResponse({
        'success': False,
        'error': result.message
    }, status=status_code)


@require_client_user
@require_http_methods(["POST"])
def api_card_change_status(request, card_id):
    """
    API: Change a card's status.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'message': 'Invalid JSON data'
        }, status=400)
    
    new_status = data.get('status', '')
    
    result = ClientCardService.change_card_status(request.user, card_id, new_status)
    
    if result.success:
        return JsonResponse({
            'success': True,
            'message': result.message,
            **result.data
        })
    
    status_code = 403 if 'permission' in result.message.lower() or 'Access' in result.message else 400
    return JsonResponse({
        'success': False,
        'message': result.message
    }, status=status_code)


@require_client_user
@require_http_methods(["POST"])
def api_cards_bulk_status(request, table_id):
    """
    API: Change status for multiple cards.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'message': 'Invalid JSON data'
        }, status=400)
    
    card_ids = data.get('card_ids', [])
    new_status = data.get('status', '')
    
    result = ClientCardService.bulk_change_status(
        request.user,
        table_id,
        card_ids,
        new_status
    )
    
    if result.success:
        return JsonResponse({
            'success': True,
            'message': result.message,
            **result.data
        })
    
    status_code = 403 if 'permission' in result.message.lower() or 'Access' in result.message else 400
    return JsonResponse({
        'success': False,
        'message': result.message
    }, status=status_code)


# =============================================================================
# API VIEWS - Image Upload
# =============================================================================

@require_client_user
@require_http_methods(["POST"])
def api_upload_images(request, table_id):
    """
    API: Upload images and link to cards.
    """
    images = request.FILES.getlist('images')
    
    if not images:
        return JsonResponse({
            'success': False,
            'message': 'No images provided'
        }, status=400)
    
    try:
        result = ClientImageService.upload_images(request.user, table_id, images)
        
        if result.success:
            return JsonResponse({
                'success': True,
                'message': result.message,
                **result.data
            })
        
        status_code = 403 if 'permission' in result.message.lower() or 'Access' in result.message else 400
        return JsonResponse({
            'success': False,
            'message': result.message
        }, status=status_code)
    except Exception:
        import logging as _logging
        _logging.getLogger(__name__).exception("Image upload error")
        return JsonResponse({'success': False, 'message': 'An error occurred. Please try again.'}, status=500)
