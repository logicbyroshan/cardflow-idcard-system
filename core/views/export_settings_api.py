"""
Export settings & template API views.
Split from base.py for maintainability.
"""
import json
import logging
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required

from ..models import SystemSettings
from ..services.permission_service import require_any_admin

logger = logging.getLogger(__name__)


# =========================================================================
# EXPORT SETTINGS API
# =========================================================================

@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_export_settings_get(request):
    """GET /api/export-settings/ — fetch export footer messages (admin only)."""
    data = SystemSettings.get_export_settings()
    return JsonResponse({'success': True, 'data': data})


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_export_settings_update(request):
    """POST /api/export-settings/update/ — update export footer messages (super admin / admin staff only)."""
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    updated = []
    MAX_SETTING_VALUE_LEN = 1000
    for key in SystemSettings.EXPORT_DEFAULTS:
        if key in body:
            val = body[key].strip() if isinstance(body[key], str) else str(body[key]).strip()
            if len(val) > MAX_SETTING_VALUE_LEN:
                return JsonResponse({'success': False, 'message': f'{key} exceeds maximum length of {MAX_SETTING_VALUE_LEN} characters'}, status=400)
            SystemSettings.set_value(key, val)
            updated.append(key)

    if not updated:
        return JsonResponse({'success': False, 'message': 'No valid fields provided'}, status=400)

    return JsonResponse({'success': True, 'message': 'Export settings updated successfully', 'updated': updated})


# =========================================================================
# EXPORT TEMPLATES API
# =========================================================================

@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_export_templates_list(request):
    """GET /api/export-templates/ — list all export templates for download modals."""
    from core.models import ExportTemplate
    templates = ExportTemplate.get_all_as_choices()
    return JsonResponse({'success': True, 'templates': templates})


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_export_template_create(request):
    """POST /api/export-templates/create/ — create a new export template."""
    from core.models import ExportTemplate
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    name = (body.get('name') or '').strip()
    instructions = (body.get('instructions') or '').strip()
    is_default = bool(body.get('is_default', False))

    if not name:
        return JsonResponse({'success': False, 'message': 'Template name is required'}, status=400)
    if not instructions:
        return JsonResponse({'success': False, 'message': 'Instructions text is required'}, status=400)
    if len(instructions) > 5000:
        return JsonResponse({'success': False, 'message': 'Instructions must be 5000 characters or less'}, status=400)
    if len(name) > 100:
        return JsonResponse({'success': False, 'message': 'Name must be 100 characters or less'}, status=400)

    if ExportTemplate.objects.filter(name__iexact=name).exists():
        return JsonResponse({'success': False, 'message': 'A template with this name already exists'}, status=400)

    tpl = ExportTemplate.objects.create(name=name, instructions=instructions, is_default=is_default)
    return JsonResponse({'success': True, 'message': 'Template created', 'template': {
        'id': tpl.id, 'name': tpl.name, 'instructions': tpl.instructions, 'is_default': tpl.is_default
    }})


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_export_template_update(request, template_id):
    """POST /api/export-templates/<id>/update/ — update an export template."""
    from core.models import ExportTemplate
    try:
        tpl = ExportTemplate.objects.get(id=template_id)
    except ExportTemplate.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Template not found'}, status=404)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'message': 'Invalid JSON'}, status=400)

    name = (body.get('name') or '').strip()
    instructions = (body.get('instructions') or '').strip()
    is_default = body.get('is_default')

    if name:
        if len(name) > 100:
            return JsonResponse({'success': False, 'message': 'Name must be 100 characters or less'}, status=400)
        if ExportTemplate.objects.filter(name__iexact=name).exclude(pk=tpl.pk).exists():
            return JsonResponse({'success': False, 'message': 'A template with this name already exists'}, status=400)
        tpl.name = name
    if instructions:
        if len(instructions) > 5000:
            return JsonResponse({'success': False, 'message': 'Instructions must be 5000 characters or less'}, status=400)
        tpl.instructions = instructions
    if is_default is not None:
        tpl.is_default = bool(is_default)
    tpl.save()

    return JsonResponse({'success': True, 'message': 'Template updated', 'template': {
        'id': tpl.id, 'name': tpl.name, 'instructions': tpl.instructions, 'is_default': tpl.is_default
    }})


@login_required
@require_any_admin
@require_http_methods(['POST'])
def api_export_template_delete(request, template_id):
    """POST /api/export-templates/<id>/delete/ — delete an export template."""
    from core.models import ExportTemplate
    try:
        tpl = ExportTemplate.objects.get(id=template_id)
    except ExportTemplate.DoesNotExist:
        return JsonResponse({'success': False, 'message': 'Template not found'}, status=404)
    tpl.delete()
    return JsonResponse({'success': True, 'message': 'Template deleted'})
