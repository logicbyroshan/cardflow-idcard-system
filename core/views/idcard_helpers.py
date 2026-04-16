"""
ID Card API — shared helpers, scoping, and field utilities.

Contains:
- Error helpers: _safe_error
- Query helpers: _build_class_filter_q, _get_class_section_field_names, _get_class_section_course_branch_field_names
- Scoping helpers: _access_denied_response, _check_client_scope_by_group/table/card
- Client readonly helpers: _CLIENT_READONLY_STATUSES, _client_readonly_response, _is_client_readonly
- Field utility re-exports from core.utils.field_utils
"""
import json
import logging
import os
import re

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
from idcards.services_workflow import WorkflowService
from ..utils.upload_security import validate_zip_safety

# Logger for this module
logger = logging.getLogger(__name__)


def _normalized_field_tokens(name):
    """Split a field name into lowercase alphanumeric tokens."""
    raw = str(name or '').strip().lower()
    if not raw:
        return set()
    return {tok for tok in re.split(r'[^a-z0-9]+', raw) if tok}


def _normalized_assigned_table_ids(staff):
    """Return sanitized positive integer table IDs from staff assignment."""
    return [
        int(v) for v in (getattr(staff, 'assigned_table_ids', None) or [])
        if str(v).strip().isdigit() and int(v) > 0
    ]


def _dedupe_scope_values(values):
    """Normalize scope filter values preserving first-seen order."""
    out = []
    seen = set()
    for value in values or []:
        text = str(value).strip()
        if not text:
            continue
        lowered = text.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        out.append(text)
    return out


def _assigned_group_ids_for_access(staff):
    """Return group IDs that explicitly grant group-level access."""
    scopes = getattr(staff, 'assignment_scopes', None)
    if isinstance(scopes, list) and scopes:
        group_ids = []
        seen = set()
        has_any_valid_scope = False

        for scope in scopes:
            if not isinstance(scope, dict):
                continue
            stype = str(scope.get('scope_type', '') or '').strip().lower()
            if stype not in ('group', 'table'):
                continue
            has_any_valid_scope = True
            if stype != 'group':
                continue

            sid = scope.get('scope_id')
            try:
                sid_int = int(str(sid).strip())
            except (TypeError, ValueError):
                continue
            if sid_int <= 0 or sid_int in seen:
                continue
            seen.add(sid_int)
            group_ids.append(sid_int)

        if has_any_valid_scope:
            return group_ids

    return list(staff.assigned_groups.values_list('id', flat=True))


def _table_is_assigned_to_staff(staff, table):
    """Allow table if assigned by table ID OR by owning group ID."""
    assigned_table_ids = set(_normalized_assigned_table_ids(staff))
    assigned_group_ids = set(_assigned_group_ids_for_access(staff))

    if assigned_table_ids and assigned_group_ids:
        return (int(table.id) in assigned_table_ids) or (int(table.group_id) in assigned_group_ids)
    if assigned_table_ids:
        return int(table.id) in assigned_table_ids
    if assigned_group_ids:
        return int(table.group_id) in assigned_group_ids
    return True


def _table_scope_filters_for_staff(staff, table):
    """Return class/section/branch filters relevant to the current table."""
    scopes = getattr(staff, 'assignment_scopes', None)
    if not isinstance(scopes, list) or not scopes:
        return (
            _dedupe_scope_values(staff.allowed_classes or []),
            _dedupe_scope_values(staff.allowed_sections or []),
            _dedupe_scope_values(staff.allowed_branches or []),
        )

    matched = []
    for scope in scopes:
        if not isinstance(scope, dict):
            continue
        stype = str(scope.get('scope_type', '') or '').strip().lower()
        scope_id = scope.get('scope_id')
        try:
            scope_id = int(str(scope_id).strip())
        except (TypeError, ValueError):
            continue

        if stype == 'table' and scope_id == int(table.id):
            matched.append(scope)
        elif stype == 'group' and scope_id == int(table.group_id):
            matched.append(scope)

    if not matched:
        return (
            _dedupe_scope_values(staff.allowed_classes or []),
            _dedupe_scope_values(staff.allowed_sections or []),
            _dedupe_scope_values(staff.allowed_branches or []),
        )

    classes = []
    sections = []
    branches = []
    for scope in matched:
        classes.extend(scope.get('classes') or [])
        sections.extend(scope.get('sections') or [])
        branches.extend(scope.get('branches') or [])

    return (
        _dedupe_scope_values(classes),
        _dedupe_scope_values(sections),
        _dedupe_scope_values(branches),
    )


def _safe_error(e, fallback='An error occurred. Please try again.'):
    """Return a safe error message for API responses. Logs the real exception."""
    logger.exception("API error: %s", e)
    return fallback


def _get_class_variant_map(table_id, class_field_name):
    """Build mapping: canonical → [raw_variants] for a table."""
    
    from django.db.models.fields.json import KeyTextTransform
    from django.db.models.functions import Cast
    from django.db.models import CharField
    from core.utils.field_utils import normalize_class_value
    from collections import defaultdict
    
    # Query ALL distinct raw class values from the table (no status filter)
    all_raw = list(
        IDCard.objects.filter(table_id=table_id)
        .annotate(_cv_raw=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
        .exclude(_cv_raw__isnull=True).exclude(_cv_raw='')
        .order_by()
        .values_list('_cv_raw', flat=True).distinct()
    )
    
    # Build canonical → [raw_variants] map
    variant_map = defaultdict(list)
    for raw in all_raw:
        canonical = normalize_class_value(raw)
        variant_map[canonical].append(raw)

    return dict(variant_map)


def invalidate_class_variant_cache(table_id):
    """Best-effort cleanup for legacy class-variant cache keys."""
    # Class variants are now computed live; this keeps backward compatibility
    # with any leftover cache keys from older deployments.
    from idcards.models import IDCardTable
    try:
        table = IDCardTable.objects.select_related().get(id=table_id)
        class_field, _ = _get_class_section_field_names(table)
        if class_field:
            django_cache.delete(f'class_variants_map:{table_id}:{class_field}')
    except Exception:
        pass  # Best effort


def invalidate_filter_options_cache(table_id):
    """Invalidate class/section filter-options cache for a table."""
    try:
        version_key = f'filter_options_version:{table_id}'
        try:
            django_cache.incr(version_key)
        except Exception:
            current = django_cache.get(version_key, 1)
            try:
                current = int(current)
            except Exception:
                current = 1
            django_cache.set(version_key, current + 1, None)

        # Best-effort cleanup for any non-versioned key readers.
        django_cache.delete(f'filter_options:{table_id}')
    except Exception:
        pass  # Best effort


def _build_class_filter_q(qs, class_filter, class_field_name):
    """Apply class filter with canonical normalization.

    Uses cached canonical→raw mapping to avoid scanning distinct values
    on every request. Finds all raw variants that normalize to the same
    canonical value as the filter, then matches them with __in.
    """
    from django.db.models.fields.json import KeyTextTransform
    from django.db.models.functions import Cast
    from django.db.models import CharField
    from django.db.models import Q
    from core.utils.field_utils import normalize_class_value

    norm_filter = normalize_class_value(class_filter)
    
    # Get table_id from the queryset (assumes qs is filtered by table)
    # The queryset is already filtered by table in the calling code
    try:
        table_id = qs.query.where.children[0].rhs  # table_id from filter(table=table)
    except Exception:
        table_id = None
    
    # If we can get table_id, use cached variant map
    if table_id:
        variant_map = _get_class_variant_map(table_id, class_field_name)
        matching_raw = variant_map.get(norm_filter, [])
    else:
        # Fallback: scan distinct values (slow path)
        from django.db.models.functions import Cast
        from django.db.models import CharField
        all_raw = list(
            qs.annotate(_cv_raw=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
            .exclude(_cv_raw__isnull=True).exclude(_cv_raw='')
            .order_by()
            .values_list('_cv_raw', flat=True).distinct()
        )
        matching_raw = [r for r in all_raw if normalize_class_value(r) == norm_filter]

    if not matching_raw:
        return qs.none()

    # Build filter: match any of the raw variants as plain text.
    # Using KeyTextTransform directly can produce JSON_EXTRACT comparisons,
    # which fail on non-JSON literals like roman classes (e.g. "III").
    qs = qs.annotate(_cls=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
    q = Q()
    for raw in matching_raw:
        q |= Q(_cls=raw)
    return qs.filter(q)


def _get_class_section_field_names(table):
    """Extract class and section field names from a table's field definitions.

    Matches by type OR by name (mirrors IDCardTable.has_class_field / has_section_field).
    Returns (class_field_name, section_field_name) — either may be None.
    """
    class_field, section_field, _course_field, _branch_field = _get_class_section_course_branch_field_names(table)
    return class_field, section_field


def _get_class_section_course_branch_field_names(table):
    """Extract class, section, course, and branch field names from table fields.

    Matching is based on explicit field types when present, otherwise tokenized
    field-name variants commonly used in school/college datasets.
    """
    class_field = None
    section_field = None
    course_field = None
    branch_field = None

    class_tokens = {'class', 'std', 'standard', 'grade'}
    section_tokens = {'section', 'sec', 'div', 'division'}
    course_tokens = {'course', 'program', 'programme'}
    branch_tokens = {'branch', 'stream', 'dept', 'department'}

    for field in (table.fields or []):
        ftype = str(field.get('type', '') or '').strip().lower()
        fname = str(field.get('name', '') or '').strip()
        tokens = _normalized_field_tokens(fname)

        if not class_field and (ftype == 'class' or bool(tokens & class_tokens)):
            class_field = fname
            continue

        if not section_field and (ftype == 'section' or bool(tokens & section_tokens)):
            section_field = fname
            continue

        if not course_field and (ftype == 'course' or bool(tokens & course_tokens)):
            course_field = fname
            continue

        if not branch_field and (ftype == 'branch' or bool(tokens & branch_tokens)):
            branch_field = fname

    return class_field, section_field, course_field, branch_field


def _get_class_section_branch_field_names(table):
    """Extract class, section, and branch-like field names from table fields.

    Branch-like fields are matched by type='branch' OR common field-name
    variants used by college datasets (branch/stream/course).
    """
    class_field, section_field, course_field, branch_field = _get_class_section_course_branch_field_names(table)

    # Backward compatibility: legacy branch scope may target course-like fields.
    if not branch_field:
        branch_field = course_field

    return class_field, section_field, branch_field


def _apply_client_staff_row_scope(qs, user, table, status_filter=None):
    """Apply client_staff-specific row-level scope to an IDCard queryset.

    Scope rules:
    - assigned_groups restrict table/group visibility (empty = all groups)
    - allowed_classes/allowed_sections/allowed_branches restrict rows when the
      corresponding field exists in the table
        - when status_filter='pool', row-level class/section/branch scope is
            intentionally bypassed so pool visibility is shared across client_staff.
    """
    if not PermissionService.is_client_staff(user):
        return qs

    staff = getattr(user, 'staff_profile', None)
    if not staff:
        return qs.none()

    if not _table_is_assigned_to_staff(staff, table):
        return qs.none()

    if str(status_filter or '').strip().lower() == 'pool':
        return qs

    allowed_classes, allowed_sections, allowed_branches = _table_scope_filters_for_staff(staff, table)

    if not (allowed_classes or allowed_sections or allowed_branches):
        return qs

    from django.db.models.fields.json import KeyTextTransform
    from django.db.models.functions import Cast
    from django.db.models import CharField

    class_field, section_field, branch_field = _get_class_section_branch_field_names(table)

    if allowed_classes:
        if not class_field:
            return qs.none()
        from core.utils.field_utils import normalize_class_value

        qs = qs.annotate(_scope_cls=Cast(KeyTextTransform(class_field, 'field_data'), CharField()))
        normalized_allowed = {
            normalize_class_value(value)
            for value in allowed_classes
            if normalize_class_value(value)
        }
        if not normalized_allowed:
            return qs.none()

        raw_values = list(
            qs.exclude(_scope_cls__isnull=True)
            .exclude(_scope_cls='')
            .values_list('_scope_cls', flat=True)
            .distinct()
        )
        matching_raw = [raw for raw in raw_values if normalize_class_value(raw) in normalized_allowed]
        if not matching_raw:
            return qs.none()
        qs = qs.filter(_scope_cls__in=matching_raw)

    if allowed_sections:
        if not section_field:
            return qs.none()
        qs = qs.annotate(_scope_sec=Cast(KeyTextTransform(section_field, 'field_data'), CharField()))
        qs = qs.filter(_scope_sec__in=allowed_sections)

    if allowed_branches:
        if not branch_field:
            return qs.none()
        from core.utils.field_utils import normalize_compact_text_value

        qs = qs.annotate(_scope_branch=Cast(KeyTextTransform(branch_field, 'field_data'), CharField()))
        normalized_allowed = {
            normalize_compact_text_value(value)
            for value in allowed_branches
            if normalize_compact_text_value(value)
        }
        if not normalized_allowed:
            return qs.none()

        raw_values = list(
            qs.exclude(_scope_branch__isnull=True)
            .exclude(_scope_branch='')
            .values_list('_scope_branch', flat=True)
            .distinct()
        )
        matching_raw = [
            raw for raw in raw_values
            if normalize_compact_text_value(raw) in normalized_allowed
        ]
        if not matching_raw:
            return qs.none()

        qs = qs.filter(_scope_branch__in=matching_raw)

    return qs


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
    if PermissionService.is_client_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if not staff:
            return None, _access_denied_response()
        assigned_table_ids = _normalized_assigned_table_ids(staff)
        assigned_group_ids = set(_assigned_group_ids_for_access(staff))
        has_group_assignment = group.id in assigned_group_ids
        has_group_table = False
        if assigned_table_ids:
            has_group_table = IDCardTable.objects.filter(
                id__in=assigned_table_ids,
                group_id=group.id,
                deleted_by_client=False,
            ).exists()

        if (assigned_group_ids or assigned_table_ids) and not (has_group_assignment or has_group_table):
            return None, _access_denied_response()
    return group, None

def _check_client_scope_by_table(user, table_id):
    """Check user has access to the client owning this table. Returns (table, error_response).
    
    Delegates to PermissionService.can_access_client() (single authority).
    """
    table = get_object_or_404(IDCardTable.objects.select_related('group'), id=table_id)
    if not PermissionService.can_access_client(user, table.group.client_id):
        return None, _access_denied_response()
    if PermissionService.is_client_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if not staff:
            return None, _access_denied_response()
        if not _table_is_assigned_to_staff(staff, table):
            return None, _access_denied_response()
    return table, None

def _check_client_scope_by_card(user, card_id):
    """Check user has access to the client owning this card. Returns (card, error_response).
    
    Delegates to PermissionService.can_access_client() (single authority).
    """
    card = get_object_or_404(IDCard.objects.select_related('table__group'), id=card_id)
    if not PermissionService.can_access_client(user, card.table.group.client_id):
        return None, _access_denied_response()
    if PermissionService.is_client_staff(user):
        staff = getattr(user, 'staff_profile', None)
        if not staff:
            return None, _access_denied_response()
        if not _table_is_assigned_to_staff(staff, card.table):
            return None, _access_denied_response()
    return card, None


# ==================== CLIENT READONLY ON APPROVED+ ====================
# After cards reach approved/download/reprint, client & client_staff users
# can only VIEW — no edit, delete, status change, or image reupload.

_CLIENT_READONLY_STATUSES = frozenset({'approved', 'download', 'reprint'})
_CLIENT_EDIT_LOCK_STATUSES = frozenset({'approved', 'download', 'reprint'})

def _client_readonly_response():
    """Fresh 403 response for each request."""
    return JsonResponse(
        {'success': False, 'message': 'Cards in approved / download status cannot be modified by client users.'},
        status=403,
    )

def _is_client_readonly(user, card_status):
    """Return True when client/client_staff tries to modify a card in a locked status."""
    return user.role in ('client', 'client_staff') and card_status in _CLIENT_READONLY_STATUSES


def _client_edit_locked_response():
    """Fresh 403 response for readonly edit operations."""
    return JsonResponse(
        {'success': False, 'message': 'Cards in approved / download / reprint status cannot be edited by client users.'},
        status=403,
    )


def _is_client_edit_locked(user, card_status):
    """Return True when client/client_staff tries to edit a card in an edit-locked status."""
    return user.role in ('client', 'client_staff') and card_status in _CLIENT_EDIT_LOCK_STATUSES


# ==================== FIELD HELPERS (canonical: core.utils.field_utils) ====================
# Re-exported for backward compatibility within this view module.
# All new code should import directly from core.utils.field_utils.
from core.utils.field_utils import (
    validate_image_bytes,
    NUMERIC_TO_ROMAN,
    VALID_CLASS_VALUES,
    CLASS_UPGRADE_MAP,
)
