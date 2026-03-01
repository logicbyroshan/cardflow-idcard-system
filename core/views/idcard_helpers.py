"""
ID Card API — shared helpers, scoping, and field utilities.

Contains:
- Error helpers: _safe_error
- Query helpers: _build_class_filter_q, _get_class_section_field_names
- Scoping helpers: _access_denied_response, _check_client_scope_by_group/table/card
- Client readonly helpers: _CLIENT_READONLY_STATUSES, _client_readonly_response, _is_client_readonly
- Field utility re-exports from core.utils.field_utils
"""
import json
import logging
import os

from django.shortcuts import get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.db import transaction
from django.conf import settings
from django.core.cache import cache as django_cache

from idcards.models import IDCardGroup, IDCard, IDCardTable
from ..services import IDCardService
from ..services.image_service import ImageService
from ..services.base import BaseService
from ..services.activity_service import ActivityService
from ..services.permission_service import (
    PermissionService,
    api_require_any_authenticated,
    api_require_permission,
)
from ..services.workflow_service import WorkflowService
from ..utils.upload_security import validate_zip_safety

# Logger for this module
logger = logging.getLogger(__name__)


def _safe_error(e, fallback='An error occurred. Please try again.'):
    """Return a safe error message for API responses. Logs the real exception."""
    logger.exception("API error: %s", e)
    return fallback


def _build_class_filter_q(qs, class_filter, class_field_name):
    """Apply class filter with canonical normalization.

    Finds ALL raw variants in the DB that normalize to the same canonical
    value as the filter, then matches them with __in.  This ensures
    'KG-I', 'KG1', 'KGI', 'LKG' are all captured when filtering by 'KG1'.
    """
    from django.db.models.fields.json import KeyTextTransform
    from django.db.models.functions import Cast
    from django.db.models import CharField, Q
    from core.utils.field_utils import normalize_class_value

    norm_filter = normalize_class_value(class_filter)

    # Get all distinct raw class values in the queryset
    all_raw = list(
        qs.annotate(_cv_raw=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
        .exclude(_cv_raw__isnull=True).exclude(_cv_raw='')
        .order_by()
        .values_list('_cv_raw', flat=True).distinct()
    )

    # Find raw values that normalize to the same canonical
    matching_raw = [r for r in all_raw if normalize_class_value(r) == norm_filter]

    if not matching_raw:
        return qs.none()

    # Build filter: match any of the raw variants
    qs = qs.annotate(_cls=KeyTextTransform(class_field_name, 'field_data'))
    q = Q()
    for raw in matching_raw:
        q |= Q(_cls=raw)
    return qs.filter(q)


def _get_class_section_field_names(table):
    """Extract class and section field names from a table's field definitions.

    Matches by type OR by name (mirrors IDCardTable.has_class_field / has_section_field).
    Returns (class_field_name, section_field_name) — either may be None.
    """
    class_field = None
    section_field = None
    for field in (table.fields or []):
        ftype = field.get('type', '')
        fname = field.get('name', '')
        fname_lower = fname.lower() if fname else ''
        if not class_field and (ftype == 'class' or fname_lower == 'class'):
            class_field = fname
        elif not section_field and (ftype == 'section' or fname_lower == 'section'):
            section_field = fname
    return class_field, section_field


# ==================== ADMIN STAFF CLIENT SCOPING ====================
# Ensures admin_staff can only access data belonging to their assigned clients.

def _access_denied_response():
    """Factory: return a fresh 403 JsonResponse per request (thread-safe)."""
    return JsonResponse(
        {'success': False, 'message': 'Access denied. You are not assigned to this client.'},
        status=403,
    )

def _check_client_scope_by_group(user, group_id):
    """Check user has access to the client owning this group. Returns (group, error_response).
    
    Delegates to PermissionService.can_access_client() (single authority).
    """
    group = get_object_or_404(IDCardGroup, id=group_id)
    if not PermissionService.can_access_client(user, group.client_id):
        return None, _access_denied_response()
    return group, None

def _check_client_scope_by_table(user, table_id):
    """Check user has access to the client owning this table. Returns (table, error_response).
    
    Delegates to PermissionService.can_access_client() (single authority).
    """
    table = get_object_or_404(IDCardTable.objects.select_related('group'), id=table_id)
    if not PermissionService.can_access_client(user, table.group.client_id):
        return None, _access_denied_response()
    return table, None

def _check_client_scope_by_card(user, card_id):
    """Check user has access to the client owning this card. Returns (card, error_response).
    
    Delegates to PermissionService.can_access_client() (single authority).
    """
    card = get_object_or_404(IDCard.objects.select_related('table__group'), id=card_id)
    if not PermissionService.can_access_client(user, card.table.group.client_id):
        return None, _access_denied_response()
    return card, None


# ==================== CLIENT READONLY ON APPROVED+ ====================
# After cards reach approved/download/reprint, client & client_staff users
# can only VIEW — no edit, delete, status change, or image reupload.

_CLIENT_READONLY_STATUSES = frozenset({'approved', 'download', 'reprint'})

def _client_readonly_response():
    """Fresh 403 response for each request."""
    return JsonResponse(
        {'success': False, 'message': 'Cards in approved / download status cannot be modified by client users.'},
        status=403,
    )

def _is_client_readonly(user, card_status):
    """Return True when client/client_staff tries to modify a card in a locked status."""
    return user.role in ('client', 'client_staff') and card_status in _CLIENT_READONLY_STATUSES


# ==================== FIELD HELPERS (canonical: core.utils.field_utils) ====================
# Re-exported for backward compatibility within this view module.
# All new code should import directly from core.utils.field_utils.
from core.utils.field_utils import (
    validate_image_bytes,
    convert_class_value,
    convert_section_value,
    NUMERIC_TO_ROMAN,
    VALID_CLASS_VALUES,
    CLASS_UPGRADE_MAP,
)
