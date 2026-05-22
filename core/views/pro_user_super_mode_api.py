"""Pro User Super Mode assignment API endpoints."""

import json
import logging

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from core.models import User
from core.services.permission_service import PermissionService
from core.services.super_mode_service import SuperModeService

logger = logging.getLogger(__name__)


def _require_pro_user(request):
    user = getattr(request, 'user', None)
    if not PermissionService.can_manage_pro_features(user):
        return JsonResponse({'success': False, 'message': 'Pro User or Super Admin access required.'}, status=403)
    return None


def _parse_json_body(request):
    if not getattr(request, 'body', b''):
        return {}
    try:
        return json.loads(request.body.decode('utf-8'))
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


@login_required
@require_http_methods(['GET'])
def api_pro_user_super_mode_users(request):
    """List assignable users and current Pro-user self Super Mode status."""
    guard = _require_pro_user(request)
    if guard is not None:
        return guard

    users = SuperModeService.list_manageable_users()
    self_status = SuperModeService.build_status(request.user)

    return JsonResponse({
        'success': True,
        'users': users,
        'self_super_mode': self_status,
    })


@login_required
@require_http_methods(['POST'])
def api_pro_user_super_mode_assign(request):
    """Assign or revoke Super Mode for super_admin/admin_staff accounts."""
    guard = _require_pro_user(request)
    if guard is not None:
        return guard

    body = _parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    target_user_id = SuperModeService.parse_int(body.get('user_id'), default=0)
    if target_user_id <= 0:
        return JsonResponse({'success': False, 'message': 'A valid user_id is required.'}, status=400)

    target_user = get_object_or_404(User, id=target_user_id)
    enabled = SuperModeService.parse_bool(body.get('enabled'), default=True)
    ram_mb = body.get('ram_allocation_mb')
    runtime_enabled = None
    if 'runtime_enabled' in body:
        runtime_enabled = SuperModeService.parse_bool(body.get('runtime_enabled'), default=False)

    try:
        assignment = SuperModeService.assign_user(
            request.user,
            target_user,
            enabled=enabled,
            ram_mb=ram_mb,
            runtime_enabled=runtime_enabled,
        )
    except PermissionError as exc:
        return JsonResponse({'success': False, 'message': str(exc)}, status=403)
    except ValueError as exc:
        return JsonResponse({'success': False, 'message': str(exc)}, status=400)
    except Exception as exc:
        logger.exception('Failed updating Super Mode assignment: %s', exc)
        return JsonResponse({'success': False, 'message': 'Failed to update Super Mode assignment.'}, status=500)

    status_payload = SuperModeService.build_status(target_user)

    return JsonResponse({
        'success': True,
        'message': 'Super Mode assignment updated.',
        'user': {
            'id': target_user.id,
            'full_name': (target_user.get_full_name() or target_user.username or target_user.email or f'User {target_user.id}').strip(),
            'role': target_user.role,
            'role_display': target_user.get_role_display() if hasattr(target_user, 'get_role_display') else target_user.role,
            'is_active': bool(target_user.is_active),
            'super_mode': {
                'is_assigned': bool(assignment.is_assigned),
                'is_enabled': bool(assignment.is_enabled),
                'effective_enabled': bool(assignment.effective_enabled),
                'ram_allocation_mb': int(assignment.ram_allocation_mb or 0),
                'allowed_options_mb': SuperModeService.allowed_options_for_role(target_user.role),
                'max_ram_mb': SuperModeService.max_ram_for_role(target_user.role),
            },
            'status': status_payload,
        },
    })


@login_required
@require_http_methods(['GET', 'POST'])
def api_pro_user_super_mode_self(request):
    """Read or update Pro User self Super Mode configuration (up to 750 MB)."""
    guard = _require_pro_user(request)
    if guard is not None:
        return guard

    if request.method == 'GET':
        return JsonResponse({'success': True, 'super_mode': SuperModeService.build_status(request.user)})

    body = _parse_json_body(request)
    if body is None:
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    enabled = SuperModeService.parse_bool(body.get('enabled'), default=True)
    ram_mb = body.get('ram_allocation_mb')
    if ram_mb in (None, ''):
        return JsonResponse({'success': False, 'message': 'ram_allocation_mb is required.'}, status=400)

    try:
        SuperModeService.configure_pro_user_self(
            request.user,
            enabled=enabled,
            ram_mb=ram_mb,
        )
    except PermissionError as exc:
        return JsonResponse({'success': False, 'message': str(exc)}, status=403)
    except ValueError as exc:
        return JsonResponse({'success': False, 'message': str(exc)}, status=400)
    except Exception as exc:
        logger.exception('Failed updating Pro User self Super Mode: %s', exc)
        return JsonResponse({'success': False, 'message': 'Failed to update Super Mode.'}, status=500)

    return JsonResponse({
        'success': True,
        'message': 'Super Mode updated.',
        'super_mode': SuperModeService.build_status(request.user),
    })
