"""
ID Card Card API — card CRUD, status changes, search, and filters.

Contains:
- api_idcard_list, api_idcard_cards_json, api_idcard_all_ids, api_idcard_filter_options
- api_idcard_create, api_idcard_get, api_idcard_history, api_idcard_update, api_idcard_delete
- api_idcard_update_field, api_idcard_change_status
- api_idcard_bulk_status, api_idcard_bulk_delete
- api_generate_delete_code, api_generate_upgrade_code, api_upgrade_all_classes
- api_idcard_search, api_table_status_counts
"""
import json
import logging
import os

from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_http_methods

from idcards.models import IDCard
from mediafiles.utils import normalize_image_bytes_for_storage
from ..services import IDCardService
from ..services.base import BaseService
from ..services.activity_service import ActivityService
from ..services.cache_version_service import CacheVersionService
from ..services.permission_service import (
    PermissionService,
    api_require_any_authenticated,
    api_require_permission,
)

from .idcard_helpers import (
    _safe_error,
    _check_client_scope_by_table,
    _check_client_scope_by_card,
    _get_class_section_course_branch_field_names,
    _table_scope_filters_for_staff,
    _build_class_filter_q,
    invalidate_class_variant_cache,
    invalidate_filter_options_cache,
    _is_client_readonly,
    _client_readonly_response,
    _is_client_edit_locked,
    _client_edit_locked_response,
    _apply_client_staff_row_scope,
    _table_scope_values_for_staff,
)

# Logger for this module
logger = logging.getLogger(__name__)


_POOL_RETRIEVE_SCOPE_MESSAGE = (
    'This card is outside your assigned class/section scope. '
    'Change it to your assigned class/section first, then retrieve from pool.'
)


def _as_bool(value):
    """Parse truthy request flag values from JSON/form payloads."""
    if isinstance(value, bool):
        return value
    return str(value or '').strip().lower() in ('1', 'true', 'yes', 'on')


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_edit')
def api_image_preview_convert(request):
    """Convert uploaded HEIF/HEIC to previewable bytes before save."""
    uploaded_file = request.FILES.get('file')
    if not uploaded_file:
        return JsonResponse({'success': False, 'message': 'No image file provided'}, status=400)

    max_bytes = 15 * 1024 * 1024
    file_size = getattr(uploaded_file, 'size', 0) or 0
    if file_size > max_bytes:
        return JsonResponse({'success': False, 'message': 'Image must be 15 MB or smaller'}, status=400)

    try:
        uploaded_file.seek(0)
        image_bytes = uploaded_file.read()
        uploaded_file.seek(0)
    except Exception:
        return JsonResponse({'success': False, 'message': 'Unable to read image data'}, status=400)

    suggested_ext = os.path.splitext(str(getattr(uploaded_file, 'name', '') or ''))[1].lower() or '.jpg'
    normalized_bytes, normalized_ext, err = normalize_image_bytes_for_storage(
        image_bytes,
        suggested_ext=suggested_ext,
    )
    if err:
        return JsonResponse({'success': False, 'message': 'Unable to generate preview for this image'}, status=400)

    content_type = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
    }.get(normalized_ext, 'image/jpeg')

    response = HttpResponse(normalized_bytes, content_type=content_type)
    response['Cache-Control'] = 'no-store, max-age=0'
    response['X-Preview-Ext'] = normalized_ext
    return response


def _is_card_in_client_staff_scope(user, card):
    """Return True when the given card is visible under client_staff scope."""
    scoped_qs = _apply_client_staff_row_scope(
        IDCard.objects.filter(id=card.id, table_id=card.table_id),
        user,
        card.table,
        status_filter=card.status,
    )
    return scoped_qs.exists()


def _is_card_in_client_staff_assignment_scope(user, card):
    """Return True when card matches strict client_staff assignment filters."""
    scoped_qs = _apply_client_staff_row_scope(
        IDCard.objects.filter(id=card.id, table_id=card.table_id),
        user,
        card.table,
    )
    return scoped_qs.exists()


def _forbidden_card_ids_for_client_staff(user, table, card_ids):
    """Return card IDs outside the caller's client_staff row scope."""
    if not PermissionService.is_client_staff(user):
        return []

    normalized = sorted({
        int(v) for v in (card_ids or [])
        if str(v).strip().isdigit() and int(v) > 0
    })
    if not normalized:
        return []

    scoped_ids = set(
        _apply_client_staff_row_scope(
            IDCard.objects.filter(table=table, id__in=normalized),
            user,
            table,
        ).values_list('id', flat=True)
    )
    return [cid for cid in normalized if cid not in scoped_ids]


def _pool_retrieve_scope_payload(user, card):
    """Build frontend payload for class-change-before-retrieve flow."""
    payload = {
        'card_id': card.id,
        'class_field': None,
        'current_class': '',
        'allowed_classes': [],
    }

    if not PermissionService.is_client_staff(user):
        return payload

    staff = getattr(user, 'staff_profile', None)
    if not staff:
        return payload

    class_field_name, _section_field_name, _course_field_name, _branch_field_name = (
        _get_class_section_course_branch_field_names(card.table)
    )
    payload['class_field'] = class_field_name

    payload['allowed_classes'] = _table_scope_values_for_staff(staff, card.table, 'classes')

    if class_field_name:
        field_data = card.field_data or {}
        raw_value = (
            field_data.get(class_field_name)
            or field_data.get(class_field_name.upper())
            or field_data.get(class_field_name.lower())
            or ''
        )
        payload['current_class'] = str(raw_value).strip()

    return payload


def _pool_retrieve_requires_class_change(user, card):
    """Return True when pool->pending retrieve needs a class update first."""
    if not PermissionService.is_client_staff(user):
        return False

    if str(card.status or '').strip().lower() != 'pool':
        return False

    from core.utils.field_utils import normalize_class_value

    payload = _pool_retrieve_scope_payload(user, card)
    class_field_name = payload.get('class_field')
    allowed_classes = payload.get('allowed_classes') or []
    if not class_field_name or not allowed_classes:
        return False

    normalized_allowed = {
        normalize_class_value(value)
        for value in allowed_classes
        if normalize_class_value(value)
    }
    if not normalized_allowed:
        return False

    current_class = payload.get('current_class') or ''
    current_normalized = normalize_class_value(current_class)
    return current_normalized not in normalized_allowed


def _apply_pool_retrieve_class_change(user, card, requested_class):
    """Apply class update for out-of-scope pool retrieve before status transition."""
    if not PermissionService.is_client_staff(user):
        return False, 'Class update is only available for assistant retrieve flow.'

    requested_text = str(requested_class or '').strip()
    if not requested_text:
        return False, 'Select your assigned class before retrieving from pool.'

    staff = getattr(user, 'staff_profile', None)
    if not staff:
        return False, 'Staff profile not found.'

    class_field_name, _section_field_name, _course_field_name, _branch_field_name = (
        _get_class_section_course_branch_field_names(card.table)
    )
    if not class_field_name:
        return False, 'Class field is not configured for this table.'

    allowed_values = _table_scope_values_for_staff(staff, card.table, 'classes')
    if not allowed_values:
        return False, 'No assigned class available for this table.'

    from core.utils.field_utils import normalize_class_value

    normalized_allowed = {}
    for value in allowed_values:
        normalized = normalize_class_value(value)
        if normalized and normalized not in normalized_allowed:
            normalized_allowed[normalized] = value

    requested_normalized = normalize_class_value(requested_text)
    if not requested_normalized or requested_normalized not in normalized_allowed:
        return False, 'Selected class is outside your assigned scope.'

    selected_class_value = normalized_allowed[requested_normalized]
    field_data = dict(card.field_data or {})
    class_field_key = class_field_name
    for key in (class_field_name, class_field_name.upper(), class_field_name.lower()):
        if key in field_data:
            class_field_key = key
            break

    field_data[class_field_key] = selected_class_value
    card.field_data = field_data
    card.modified_by = request_username = getattr(user, 'username', '') or ''
    update_fields = ['field_data', 'modified_by', 'updated_at'] if request_username else ['field_data', 'updated_at']
    card.save(update_fields=update_fields)

    try:
        invalidate_class_variant_cache(card.table_id)
        invalidate_filter_options_cache(card.table_id)
        CacheVersionService.bump('mob_filter', int(card.table_id))
        CacheVersionService.bump('global_search', 'all')
        table_client_id = getattr(getattr(card.table, 'group', None), 'client_id', None)
        if table_client_id:
            CacheVersionService.bump('class_section', int(table_client_id))
    except Exception:
        pass

    return True, ''


def _build_modifier_role_map(modifier_names):
    """Resolve modifier usernames to roles in one query."""
    normalized = {
        str(name).strip() for name in (modifier_names or [])
        if str(name).strip()
    }
    if not normalized:
        return {}

    from core.models import User as _User
    return {
        username: role
        for username, role in _User.objects.filter(
            username__in=normalized,
        ).values_list('username', 'role')
    }


def _client_modifier_display_name(table):
    """Display a single client label instead of internal usernames."""
    try:
        name = (table.group.client.name or '').strip()
    except Exception:
        name = ''
    return name or 'Client'


def _sanitize_client_audit_fields(table, modifier, updated_at, updated_at_iso, modifier_role_map):
    """Hide admin metadata for client/client_staff viewers."""
    raw_modifier = (modifier or '').strip()
    role = modifier_role_map.get(raw_modifier)
    if role in ('client', 'client_staff'):
        return _client_modifier_display_name(table), updated_at, updated_at_iso
    return '', None, None


# ==================== ID CARD API ENDPOINTS ====================

@require_http_methods(["GET"])
@api_require_any_authenticated
def api_idcard_list(request, table_id):
    """API endpoint to list ID Cards for a table with pagination support for lazy loading.
    
    Supports server-side filtering via query params:
        search  - full-text search on field_data
        class   - exact class filter on field_data
        section - exact section filter on field_data
        course  - exact course filter on field_data
        branch  - exact branch filter on field_data
        sort    - sort order: sr-asc, sr-desc, name-asc, name-desc, date-new, date-old
        image_column    - image field name for image sort filter
        image_condition - complete, pending, or incomplete
    """
    from django.db.models.fields.json import KeyTextTransform
    from django.db.models import Q

    table, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    status_filter = request.GET.get('status', None)
    
    # Check status-specific list permission (via single authority)
    if status_filter:
        required_perm = PermissionService.STATUS_LIST_PERM_MAP.get(status_filter)
        if required_perm and not PermissionService.has(request.user, required_perm):
            return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    
    # client/client_staff use cards_json-compatible payload to enforce consistent
    # metadata masking and row scoping.
    if PermissionService.is_client_role(request.user):
        scoped_resp = api_idcard_cards_json(request, table_id)
        try:
            scoped_payload = json.loads(scoped_resp.content.decode('utf-8'))
        except Exception:
            return scoped_resp

        if not scoped_payload.get('success'):
            return scoped_resp

        # Compute status counts once. For client_staff this is row-scoped; for
        # client users _apply_client_staff_row_scope returns the full queryset.
        from django.db.models import Count
        scoped_cards_qs = _apply_client_staff_row_scope(
            IDCard.objects.filter(table=table),
            request.user,
            table,
        )
        scoped_counts = {
            'pending': 0, 'verified': 0, 'pool': 0,
            'approved': 0, 'download': 0, 'reprint': 0, 'total': 0,
        }
        for row in scoped_cards_qs.order_by().values('status').annotate(count=Count('id')):
            st = row.get('status')
            ct = row.get('count', 0)
            if st in scoped_counts:
                scoped_counts[st] = ct
                scoped_counts['total'] += ct

        if PermissionService.is_client_staff(request.user):
            scoped_counts['pool'] = IDCard.objects.filter(table=table, status='pool').count()
            scoped_counts['total'] = (
                scoped_counts.get('pending', 0)
                + scoped_counts.get('verified', 0)
                + scoped_counts.get('pool', 0)
                + scoped_counts.get('approved', 0)
                + scoped_counts.get('download', 0)
                + scoped_counts.get('reprint', 0)
            )

        return JsonResponse({
            'success': True,
            'cards': scoped_payload.get('results', []),
            'total_count': scoped_payload.get('total', 0),
            'offset': scoped_payload.get('offset', 0),
            'limit': scoped_payload.get('limit', 100),
            'has_more': scoped_payload.get('has_more', False),
            'next_cursor': scoped_payload.get('next_cursor'),
            'status_counts': scoped_counts,
            'table': IDCardService.serialize_table(table),
        })

    try:
        offset = max(0, int(request.GET.get('offset', 0)))
        limit = min(500, max(1, int(request.GET.get('limit', 100))))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    # Server-side search & filters
    search = request.GET.get('search', '').strip()
    class_filter = request.GET.get('class', '').strip()
    section_filter = request.GET.get('section', '').strip()
    course_filter = request.GET.get('course', '').strip()
    branch_filter = request.GET.get('branch', '').strip()
    sort_order = request.GET.get('sort', 'sr-asc').strip()
    image_column = request.GET.get('image_column', '').strip()
    image_condition = request.GET.get('image_condition', '').strip()
    from_date = request.GET.get('from', '').strip()
    to_date = request.GET.get('to', '').strip()

    result = IDCardService.list_cards(
        table_id, status_filter, offset, limit,
        search=search,
        class_filter=class_filter,
        section_filter=section_filter,
        course_filter=course_filter,
        branch_filter=branch_filter,
        sort_order=sort_order, image_column=image_column, image_condition=image_condition,
        from_date=from_date, to_date=to_date,
    )
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["GET"])
@api_require_any_authenticated
def api_idcard_cards_json(request, table_id):
    """JSON endpoint for virtual table rendering.

    Returns lightweight card data with full filter/pagination support,
    matching the same query logic as the idcard_actions page view.

    Query params:
        status   – filter by status (pending, verified, approved, download, pool, reprint)
        offset   – pagination offset (default 0)
        limit    – page size, 1-500 (default 100)
        search   – full-text search on field_data
        class    – class filter on field_data
        section  – section filter on field_data
        course   – course filter on field_data
        branch   – branch filter on field_data
        from     – datetime lower bound (download status only)
        to       – datetime upper bound (download status only)

    Response shape:
        {
            "success": true,
            "total": 1234,
            "offset": 0,
            "limit": 100,
            "has_more": true,
            "results": [
                {
                    "id": 5,
                    "sr_no": 1,
                    "status": "pending",
                    "status_display": "Pending",
                    "field_data": {"Name": "...", "PHOTO": "..."},
                    "ordered_fields": [
                        {"name": "Name", "type": "text", "value": "John"},
                        {"name": "PHOTO", "type": "image", "value": "adarshimg/...jpg",
                         "thumb": "adarshimg/thumbs/...jpg"}
                    ],
                    "updated_at": "20-Feb-2026 14:30",
                    "updated_at_iso": "2026-02-20T14:30:00+05:30",
                    "downloaded_at": null,
                    "deleted_at": null
                }
            ]
        }
    """
    from django.utils.timezone import localtime, make_aware, is_naive
    from datetime import datetime as dt
    from django.db.models import Q, Value, IntegerField, Case, When
    from django.db.models.functions import Coalesce, Lower
    from django.db.models.fields.json import KeyTextTransform

    table, err = _check_client_scope_by_table(request.user, table_id)
    if err:
        return err

    status_filter = request.GET.get('status', None)

    # Check status-specific list permission
    if status_filter:
        required_perm = PermissionService.STATUS_LIST_PERM_MAP.get(status_filter)
        if required_perm and not PermissionService.has(request.user, required_perm):
            return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)

    try:
        offset = max(0, int(request.GET.get('offset', 0)))
        limit = min(500, max(1, int(request.GET.get('limit', 100))))
    except (ValueError, TypeError):
        offset, limit = 0, 100

    # Base queryset — newest action first in each status list.
    # Pending/Verified/Approved/Reprint use status_changed_at with created_at fallback
    # so cards that were just moved between statuses appear at the top.
    # Download: most recently downloaded first
    # Pool: most recently pooled first
    # .only() skips columns not needed for virtual table rendering (e.g. original_photo_name)
    _only_fields = (
        'id', 'table_id', 'field_data', 'photo', 'status',
        'created_at', 'updated_at', 'downloaded_at', 'deleted_at',
        'status_changed_at', 'modified_by',
    )
    if status_filter == 'download':
        qs = IDCard.objects.filter(table=table).only(*_only_fields).order_by('-downloaded_at', '-id')
    elif status_filter == 'pool':
        qs = IDCard.objects.filter(table=table).only(*_only_fields).order_by('-deleted_at', '-id')
    else:
        qs = (
            IDCard.objects
            .filter(table=table)
            .only(*_only_fields)
            .annotate(_status_sort_at=Coalesce('status_changed_at', 'created_at'))
            .order_by('-_status_sort_at', '-id')
        )

    if status_filter and status_filter in IDCardService.VALID_STATUSES:
        qs = qs.filter(status=status_filter)

    qs = _apply_client_staff_row_scope(qs, request.user, table, status_filter=status_filter)

    # Search & filter on field_data JSON
    search = request.GET.get('search', '').strip()
    class_filter = request.GET.get('class', '').strip()
    section_filter = request.GET.get('section', '').strip()
    course_filter = request.GET.get('course', '').strip()
    branch_filter = request.GET.get('branch', '').strip()
    if search:
        qs = IDCardService._apply_search_filter(qs, search, table=table)

    # Class/section/course/branch filters
    if class_filter or section_filter or course_filter or branch_filter:
        from django.db.models.fields.json import KeyTextTransform
        class_field_name, section_field_name, course_field_name, branch_field_name = (
            _get_class_section_course_branch_field_names(table)
        )
        if class_filter and class_field_name:
            qs = _build_class_filter_q(qs, class_filter, class_field_name)
        if section_filter and section_field_name:
            qs = qs.annotate(_sec=KeyTextTransform(section_field_name, 'field_data'))
            qs = qs.filter(_sec__iexact=section_filter)
        if course_filter and course_field_name:
            qs = IDCardService._apply_compact_text_filter(
                qs,
                course_filter,
                course_field_name,
                table_id=table_id,
                alias='_course_cmp',
            )
        if branch_filter and branch_field_name:
            qs = IDCardService._apply_compact_text_filter(
                qs,
                branch_filter,
                branch_field_name,
                table_id=table_id,
                alias='_branch_cmp',
            )

    # Server-side image filter (column + condition)
    image_column = request.GET.get('image_column', '').strip()
    image_condition = request.GET.get('image_condition', '').strip()
    if image_column and image_condition in ('complete', 'pending', 'incomplete'):
        qs = qs.annotate(_img=KeyTextTransform(image_column, 'field_data'))
        if image_condition == 'complete':
            qs = qs.exclude(_img__isnull=True).exclude(_img='').exclude(_img='NOT_FOUND')
            qs = qs.exclude(_img__startswith='PENDING:')
        elif image_condition == 'pending':
            qs = qs.filter(_img__startswith='PENDING:')
        elif image_condition == 'incomplete':
            qs = qs.filter(Q(_img__isnull=True) | Q(_img='') | Q(_img='NOT_FOUND'))

    # DateTime range (download list)
    if status_filter == 'download':
        from_date = request.GET.get('from', '').strip()
        to_date = request.GET.get('to', '').strip()
        if from_date:
            try:
                from_dt = dt.fromisoformat(from_date)
                from_dt = make_aware(from_dt) if is_naive(from_dt) else from_dt
                qs = qs.filter(downloaded_at__gte=from_dt)
            except (ValueError, TypeError):
                pass
        if to_date:
            try:
                to_dt = dt.fromisoformat(to_date)
                to_dt = make_aware(to_dt) if is_naive(to_dt) else to_dt
                qs = qs.filter(downloaded_at__lte=to_dt)
            except (ValueError, TypeError):
                pass

    sort_order = request.GET.get('sort', '').strip().lower()
    if sort_order in ('name-asc', 'name-desc'):
        name_field = IDCardService._get_name_field(table)
        if name_field:
            qs = qs.annotate(
                _name_raw=KeyTextTransform(name_field, 'field_data'),
                _name_sort=Lower(Coalesce(
                    KeyTextTransform(name_field, 'field_data'),
                    Value(''),
                )),
                _name_empty=Case(
                    When(
                        Q(_name_raw__isnull=True) | Q(_name_raw=''),
                        then=Value(1),
                    ),
                    default=Value(0),
                    output_field=IntegerField(),
                ),
            )
            if sort_order == 'name-asc':
                qs = qs.order_by('_name_empty', '_name_sort', 'id')
            else:
                qs = qs.order_by('_name_empty', '-_name_sort', '-id')
    elif sort_order == 'sr-desc':
        qs = qs.order_by('created_at', '-id')
    elif sort_order == 'date-new':
        qs = qs.order_by('-updated_at', '-id')
    elif sort_order == 'date-old':
        qs = qs.order_by('updated_at', 'id')

    total = qs.count()

    # Use offset pagination for all sortable list queries.
    # Cursor-based slicing only works when the queryset order matches the
    # cursor key; name/date sorts need the full ordered queryset preserved.
    cards = list(qs[offset:offset + limit + 1])

    has_more = len(cards) > limit
    if has_more:
        cards = cards[:limit]
    next_cursor = cards[-1].id if cards and has_more else None

    # Build ordered fields with reordered display order
    reordered_fields = BaseService.reorder_fields_for_display(table.fields or [])

    def _thumb(path):
        """Replicate get_thumbnail_path template filter (returns .webp path)."""
        if not path or path == 'NOT_FOUND' or path.startswith('PENDING:'):
            return path
        try:
            path = BaseService.normalize_image_path(path)
        except Exception:
            pass
        # Reject values that don't look like real file paths (no extension)
        if '.' not in path:
            return ''
        try:
            parts = path.replace('\\', '/').split('/')
            if len(parts) >= 2:
                base_folder = parts[0]
                rest = '/'.join(parts[1:])
                name, _ext = rest.rsplit('.', 1) if '.' in rest else (rest, '')
                rest = f"{name}.webp"
                return f"{base_folder}/thumbs/{rest}"
            # Just a filename
            name, _ext = path.rsplit('.', 1) if '.' in path else (path, '')
            return f"thumbs/{name}.webp"
        except Exception:
            return path

    def _lookup_field_value(field_data, field_data_upper, field_name):
        """Lookup field value by exact/case-insensitive/trimmed key variants."""
        if not field_name:
            return ''
        # Fast path
        val = field_data.get(field_name, '') or field_data_upper.get(field_name.upper(), '')
        if val:
            return val

        wanted = str(field_name).strip().upper()
        for k, v in field_data.items():
            if str(k).strip().upper() == wanted and v:
                return v
        return ''

    def _looks_like_image_value(v):
        if not v:
            return False
        text = str(v).strip()
        if not text or text in ('NOT_FOUND',):
            return False
        if text.startswith('PENDING:'):
            return True
        low = text.lower()
        return (
            low.endswith(('.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'))
            or '/media/' in low
            or low.startswith('http://')
            or low.startswith('https://')
        )

    results = []
    # sr_no is based on the current offset slice.
    sr_base = offset

    # For client/client_staff users, expose update metadata only when modifier
    # is client/client_staff; admin/admin_staff updates are hidden.
    _is_client_viewer = PermissionService.is_client_role(request.user)
    _modifier_role_map = {}
    if _is_client_viewer:
        modifier_names = {
            c.modified_by for c in cards
            if c.modified_by and c.modified_by.strip()
        }
        _modifier_role_map = _build_modifier_role_map(modifier_names)

    for idx, card in enumerate(cards):
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}

        ordered = []
        for field in reordered_fields:
            fname = field['name']
            ftype = field.get('type', 'text')
            is_img = BaseService.is_image_field(field)
            if is_img:
                ftype = 'image'
            val = _lookup_field_value(fd, fd_upper, fname)
            # Legacy photo fallback
            if fname.strip().upper() == 'PHOTO' and (not val or not _looks_like_image_value(val)) and card.photo:
                try:
                    val = card.photo.name or card.photo.url
                except Exception:
                    pass
            
            # Sanitize: strip PENDING: prefix from non-image fields (internal placeholder should not be exposed)
            if not is_img and val and isinstance(val, str) and val.startswith('PENDING:'):
                val = ''
            
            entry = {'name': fname, 'type': ftype, 'value': val}
            if is_img:
                entry['thumb'] = _thumb(val) if val else ''
            ordered.append(entry)

        # By default include complete audit metadata; client viewers are sanitized below.
        _modifier = card.modified_by or ''
        _card_updated_at = localtime(card.updated_at).strftime('%d-%b-%Y %H:%M') if card.updated_at else None
        _card_updated_at_iso = card.updated_at.isoformat() if card.updated_at else None
        _card_downloaded_at = localtime(card.downloaded_at).strftime('%d-%b-%Y %H:%M') if card.downloaded_at else None
        _card_deleted_at = localtime(card.deleted_at).strftime('%d-%b-%Y %H:%M') if card.deleted_at else None

        if _is_client_viewer:
            _modifier, _card_updated_at, _card_updated_at_iso = _sanitize_client_audit_fields(
                table,
                _modifier,
                _card_updated_at,
                _card_updated_at_iso,
                _modifier_role_map,
            )
            # Never expose download/pool audit timestamps to client-facing roles.
            _card_downloaded_at = None
            _card_deleted_at = None

        results.append({
            'id': card.id,
            'sr_no': sr_base + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            # Strip internal __ref_ keys (original photo references used by
            # the reupload processor) — they're not useful to the frontend.
            'field_data': {k: v for k, v in fd.items() if not k.startswith('__')},
            'ordered_fields': ordered,
            'updated_at': _card_updated_at,
            'updated_at_iso': _card_updated_at_iso,
            'downloaded_at': _card_downloaded_at,
            'deleted_at': _card_deleted_at,
            'modified_by': _modifier,
        })

    return JsonResponse({
        'success': True,
        'total': total,
        'offset': offset,
        'limit': limit,
        'has_more': has_more,
        'next_cursor': next_cursor,
        'results': results,
    })


@require_http_methods(["GET"])
@api_require_any_authenticated
def api_idcard_all_ids(request, table_id):
    """API endpoint to get all card IDs for a table (for Select All functionality).
    Supports search/class/section/course/branch params so Select All respects active filters."""
    table, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    status_filter = request.GET.get('status', None)
    
    # Check status-specific list permission (via single authority)
    if status_filter:
        required_perm = PermissionService.STATUS_LIST_PERM_MAP.get(status_filter)
        if required_perm and not PermissionService.has(request.user, required_perm):
            return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
    
    # Pass through the same filters the main view uses
    search = request.GET.get('search', '').strip()
    class_filter = request.GET.get('class', '').strip()
    section_filter = request.GET.get('section', '').strip()
    course_filter = request.GET.get('course', '').strip()
    branch_filter = request.GET.get('branch', '').strip()
    from_date = request.GET.get('from', '').strip()
    to_date = request.GET.get('to', '').strip()
    image_column = request.GET.get('image_column', '').strip()
    image_condition = request.GET.get('image_condition', '').strip()
    
    result = IDCardService.get_all_card_ids(
        table_id, status_filter,
        search=search,
        class_filter=class_filter,
        section_filter=section_filter,
        course_filter=course_filter,
        branch_filter=branch_filter,
        from_date=from_date, to_date=to_date,
        image_column=image_column, image_condition=image_condition,
    )

    if result.success and PermissionService.is_client_staff(request.user):
        scoped_ids = set(
            _apply_client_staff_row_scope(
                IDCard.objects.filter(table=table),
                request.user,
                table,
                status_filter=status_filter,
            ).values_list('id', flat=True)
        )
        card_ids = [cid for cid in (result.data or {}).get('card_ids', []) if cid in scoped_ids]
        result.data = result.data or {}
        result.data['card_ids'] = card_ids
        result.data['total_count'] = len(card_ids)

    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["GET"])
@api_require_any_authenticated
def api_idcard_filter_options(request, table_id):
    """Return distinct class/section/course/branch values for filter dropdowns.

    Groups class variants by their canonical form (normalize_class_value).
    E.g. 'KG-I', 'KGI', 'KG1', 'kgI' all map to canonical 'KG1' and show
    the most-used raw format as the display label.

    Response shape:
        class_values:   [{value: "KG1", display: "KG-I"}, ...]
        section_values: ["A", "B", ...]
        course_values:  ["BSC", "BCA", ...]
        branch_values:  ["CS", "ME", ...]
    """
    from django.db.models.fields.json import KeyTextTransform
    from django.db.models.functions import Cast
    from django.db.models import CharField, Count
    from core.utils.field_utils import (
        CLASS_ORDER, CLASS_ORDER_UNKNOWN, normalize_class_value, normalize_compact_text_value,
    )
    from collections import defaultdict

    table, err = _check_client_scope_by_table(request.user, table_id)
    if err:
        return err

    status_filter = request.GET.get('status', '').strip()
    
    qs = IDCard.objects.filter(table=table)
    qs = _apply_client_staff_row_scope(qs, request.user, table, status_filter=status_filter)
    # NOTE: Removed status filter — filter options should show ALL values
    # across the entire table, not just the current status view.

    class_field_name, section_field_name, course_field_name, branch_field_name = (
        _get_class_section_course_branch_field_names(table)
    )

    class_values = []
    section_values = []
    course_values = []
    branch_values = []
    course_display_map = {}
    branch_display_map = {}
    class_to_sections = {}
    section_to_classes = {}
    course_to_branches = {}
    branch_to_courses = {}

    if class_field_name:
        # Get distinct raw values WITH counts
        raw_with_counts = (
            qs.annotate(_cv=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()))
            .exclude(_cv__isnull=True).exclude(_cv='')
            .order_by()
            .values('_cv')
            .annotate(cnt=Count('id'))
        )

        # Group by canonical form → pick most common raw as display
        groups = defaultdict(list)  # canonical → [(raw, count)]
        for entry in raw_with_counts:
            raw = entry['_cv'].strip()
            canonical = normalize_class_value(raw)
            groups[canonical].append((raw, entry['cnt']))

        for canonical, variants in groups.items():
            best_display = max(variants, key=lambda x: x[1])[0]
            total_count = sum(v[1] for v in variants)
            class_values.append({
                'value': canonical,
                'display': best_display,
                'count': total_count,
            })

        # Sort by class order
        class_values.sort(
            key=lambda x: (CLASS_ORDER.get(x['value'], CLASS_ORDER_UNKNOWN), x['value'])
        )

    if section_field_name:
        section_values = sorted(
            [
                str(v) for v in
                qs.annotate(_sv=Cast(KeyTextTransform(section_field_name, 'field_data'), CharField()))
                .exclude(_sv__isnull=True).exclude(_sv='')
                .order_by()
                .values_list('_sv', flat=True).distinct()
                if v is not None
            ],
        )

    if course_field_name:
        raw_with_counts = (
            qs.annotate(_coursev=Cast(KeyTextTransform(course_field_name, 'field_data'), CharField()))
            .exclude(_coursev__isnull=True).exclude(_coursev='')
            .order_by()
            .values('_coursev')
            .annotate(cnt=Count('id'))
        )

        grouped = {}
        for entry in raw_with_counts:
            raw = str(entry['_coursev']).strip()
            normalized = normalize_compact_text_value(raw)
            if not normalized:
                continue
            prev = grouped.get(normalized)
            if prev is None or entry['cnt'] > prev[1]:
                grouped[normalized] = (raw, entry['cnt'])

        course_display_map = {normalized: data[0] for normalized, data in grouped.items()}
        course_values = sorted(course_display_map.values(), key=lambda x: x.lower())

    if branch_field_name:
        raw_with_counts = (
            qs.annotate(_branchv=Cast(KeyTextTransform(branch_field_name, 'field_data'), CharField()))
            .exclude(_branchv__isnull=True).exclude(_branchv='')
            .order_by()
            .values('_branchv')
            .annotate(cnt=Count('id'))
        )

        grouped = {}
        for entry in raw_with_counts:
            raw = str(entry['_branchv']).strip()
            normalized = normalize_compact_text_value(raw)
            if not normalized:
                continue
            prev = grouped.get(normalized)
            if prev is None or entry['cnt'] > prev[1]:
                grouped[normalized] = (raw, entry['cnt'])

        branch_display_map = {normalized: data[0] for normalized, data in grouped.items()}
        branch_values = sorted(branch_display_map.values(), key=lambda x: x.lower())

    if class_field_name and section_field_name:
        pair_rows = (
            qs.annotate(
                _cv=Cast(KeyTextTransform(class_field_name, 'field_data'), CharField()),
                _sv=Cast(KeyTextTransform(section_field_name, 'field_data'), CharField()),
            )
            .exclude(_cv__isnull=True).exclude(_cv='')
            .exclude(_sv__isnull=True).exclude(_sv='')
            .order_by()
            .values_list('_cv', '_sv')
            .distinct()
        )

        class_section_sets = defaultdict(set)
        section_class_sets = defaultdict(set)
        for raw_class, raw_section in pair_rows:
            canonical_class = normalize_class_value(str(raw_class).strip())
            section_text = str(raw_section).strip()
            if not canonical_class or not section_text:
                continue
            class_section_sets[canonical_class].add(section_text)
            section_class_sets[section_text].add(canonical_class)

        class_to_sections = {
            cls: sorted(list(sections)) for cls, sections in class_section_sets.items()
        }
        section_to_classes = {
            sec: sorted(
                list(classes),
                key=lambda c: (CLASS_ORDER.get(c, CLASS_ORDER_UNKNOWN), c),
            )
            for sec, classes in section_class_sets.items()
        }

    if course_field_name and branch_field_name:
        pair_rows = (
            qs.annotate(
                _coursev=Cast(KeyTextTransform(course_field_name, 'field_data'), CharField()),
                _branchv=Cast(KeyTextTransform(branch_field_name, 'field_data'), CharField()),
            )
            .exclude(_coursev__isnull=True).exclude(_coursev='')
            .exclude(_branchv__isnull=True).exclude(_branchv='')
            .order_by()
            .values_list('_coursev', '_branchv')
            .distinct()
        )

        course_branch_sets = defaultdict(set)
        branch_course_sets = defaultdict(set)
        for raw_course, raw_branch in pair_rows:
            course_text = str(raw_course).strip()
            branch_text = str(raw_branch).strip()
            course_norm = normalize_compact_text_value(course_text)
            branch_norm = normalize_compact_text_value(branch_text)
            if not course_norm or not branch_norm:
                continue
            if course_norm not in course_display_map:
                course_display_map[course_norm] = course_text
            if branch_norm not in branch_display_map:
                branch_display_map[branch_norm] = branch_text

            course_branch_sets[course_norm].add(branch_norm)
            branch_course_sets[branch_norm].add(course_norm)

        course_to_branches = {
            course_display_map.get(course, course): sorted(
                [branch_display_map.get(branch, branch) for branch in branches],
                key=lambda x: x.lower(),
            )
            for course, branches in course_branch_sets.items()
        }
        branch_to_courses = {
            branch_display_map.get(branch, branch): sorted(
                [course_display_map.get(course, course) for course in courses],
                key=lambda x: x.lower(),
            )
            for branch, courses in branch_course_sets.items()
        }

    result = {
        'success': True,
        'class_values': class_values,
        'section_values': list(section_values),
        'course_values': list(course_values),
        'branch_values': list(branch_values),
        'class_to_sections': class_to_sections,
        'section_to_classes': section_to_classes,
        'course_to_branches': course_to_branches,
        'branch_to_courses': branch_to_courses,
        'class_field': class_field_name,
        'section_field': section_field_name,
        'course_field': course_field_name,
        'branch_field': branch_field_name,
    }
    
    return JsonResponse(result)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_add')
def api_idcard_create(request, table_id):
    """API endpoint to create a new ID Card with file upload support.

    View responsibility: parse HTTP request → delegate to IDCardService.
    """
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        # Parse field_data and image_files from either multipart or JSON
        if request.content_type and 'multipart/form-data' in request.content_type:
            field_data = json.loads(request.POST.get('field_data', '{}'))
            # Extract legacy 'photo' key FIRST, then build image_files
            # WITHOUT it to prevent the same file object being processed twice
            # (once in the image-field loop and once by the legacy handler).
            legacy_photo_file = request.FILES.get('photo')
            image_files = {
                key: request.FILES[key]
                for key in request.FILES
                if key != 'photo'  # handled separately via legacy_photo_file
            }
        else:
            data = json.loads(request.body)
            field_data = data.get('field_data', {})
            image_files = None
            legacy_photo_file = None

        result = IDCardService.create_card(
            table_id=table_id,
            field_data=field_data,
            image_files=image_files,
            uploaded_by=request.user if request.user.is_authenticated else None,
            legacy_photo_file=legacy_photo_file,
        )

        if result.success:
            try:
                created_card = (result.data or {}).get('card') or {}
                created_card_id = created_card.get('id')
                if created_card_id:
                    ActivityService.log(
                        'card_create',
                        'ID card created',
                        user=request.user if request.user.is_authenticated else None,
                        request=request,
                        target_model='IDCard',
                        target_id=created_card_id,
                        target_name=f'Card #{created_card_id}',
                    )
            except Exception:
                pass
            return JsonResponse({
                'success': True,
                'message': result.message,
                'card': result.data['card'],
            })
        return JsonResponse({'success': False, 'message': result.message}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)


@require_http_methods(["GET"])
@api_require_permission('perm_idcard_info')
def api_idcard_get(request, card_id):
    """API endpoint to get a single ID Card"""
    card, err = _check_client_scope_by_card(request.user, card_id)
    if err: return err
    if not _is_card_in_client_staff_scope(request.user, card):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
    result = IDCardService.get_card(card_id)
    if result.success:
        card_payload = dict(result.data['card'])
        if PermissionService.is_client_role(request.user):
            modifier_role_map = _build_modifier_role_map([card_payload.get('modified_by', '')])
            modifier, updated_at, updated_at_iso = _sanitize_client_audit_fields(
                card.table,
                card_payload.get('modified_by', ''),
                card_payload.get('updated_at'),
                card_payload.get('updated_at_iso'),
                modifier_role_map,
            )
            card_payload['modified_by'] = modifier
            card_payload['updated_at'] = updated_at
            card_payload['updated_at_iso'] = updated_at_iso
            card_payload['downloaded_at'] = None
            card_payload['deleted_at'] = None
        return JsonResponse({'success': True, 'card': card_payload})
    return JsonResponse({'success': False, 'message': result.message}, status=400)


@require_http_methods(["GET"])
@api_require_any_authenticated
def api_idcard_history(request, card_id):
    """Return per-card timeline entries for the action-list history drawer."""
    from django.utils.timezone import localtime
    from core.models import ActivityLog

    card, err = _check_client_scope_by_card(request.user, card_id)
    if err:
        return err
    if not _is_card_in_client_staff_scope(request.user, card):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

    history_qs = (
        ActivityLog.objects
        .filter(target_model='IDCard', target_id=card.id)
        .select_related('user')
        .order_by('-created_at')[:80]
    )

    is_client_viewer = PermissionService.is_client_role(request.user)
    role_map = {}
    if is_client_viewer:
        usernames = {
            entry.user.username
            for entry in history_qs
            if entry.user and entry.user.username
        }
        if usernames:
            from core.models import User as _User
            role_map = {
                username: role
                for username, role in _User.objects.filter(username__in=usernames).values_list('username', 'role')
            }

    events = []
    for entry in history_qs:
        actor = entry.user
        actor_name = ''
        if actor:
            actor_name = actor.get_full_name() or actor.username
        else:
            actor_name = 'System'

        if is_client_viewer:
            actor_role = role_map.get(getattr(actor, 'username', ''), '') if actor else ''
            if actor and actor_role not in ('client', 'client_staff'):
                continue
            actor_name = _client_modifier_display_name(card.table)

        when_dt = localtime(entry.created_at)
        events.append({
            'id': entry.id,
            'action': entry.get_action_display(),
            'what': entry.description,
            'who': actor_name,
            'when': when_dt.strftime('%d-%b-%Y %H:%M'),
            'when_iso': entry.created_at.isoformat(),
        })

    if not events:
        snapshot_dt = card.status_changed_at or card.updated_at or card.created_at
        snapshot_when = localtime(snapshot_dt) if snapshot_dt else None
        fallback_actor = (card.modified_by or '').strip() or 'System'
        if is_client_viewer and fallback_actor not in ('System',):
            fallback_actor = _client_modifier_display_name(card.table)
        events.append({
            'id': f'snapshot-{card.id}',
            'action': 'Status Snapshot',
            'what': f'Current status: {card.get_status_display()}',
            'who': fallback_actor,
            'when': snapshot_when.strftime('%d-%b-%Y %H:%M') if snapshot_when else '',
            'when_iso': snapshot_dt.isoformat() if snapshot_dt else '',
        })

    return JsonResponse({
        'success': True,
        'card_id': card.id,
        'card_status': card.status,
        'card_status_display': card.get_status_display(),
        'events': events,
    })


@require_http_methods(["POST", "PUT"])
@api_require_permission('perm_idcard_edit')
def api_idcard_update(request, card_id):
    """API endpoint to update an ID Card with file upload support.

    View responsibility: parse HTTP request, scope/readonly gates → delegate
    to IDCardService.update_card (which handles concurrency, images, save).
    """
    _card, err = _check_client_scope_by_card(request.user, card_id)
    if err: return err
    if not _is_card_in_client_staff_scope(request.user, _card):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
    try:
        # Parse request into service-friendly args
        if request.content_type and 'multipart/form-data' in request.content_type:
            field_data = json.loads(request.POST.get('field_data', '{}'))
            expected_updated_at = request.POST.get('expected_updated_at', None)
            reprint_modal_edit = _as_bool(request.POST.get('reprint_modal_edit'))
            # Extract legacy 'photo' key FIRST, then build image_files
            # WITHOUT it to prevent the same file object being processed twice.
            legacy_photo_file = request.FILES.get('photo')
            image_files = {
                key: request.FILES[key]
                for key in request.FILES
                if key != 'photo'  # handled separately via legacy_photo_file
            }
        else:
            data = json.loads(request.body)
            field_data = data.get('field_data')
            expected_updated_at = data.get('expected_updated_at', None)
            reprint_modal_edit = _as_bool(data.get('reprint_modal_edit'))
            image_files = None
            legacy_photo_file = None

        # Default lock remains in place. Bypass is only for reprint-modal edits
        # when caller has reprint permission.
        can_bypass_edit_lock = (
            reprint_modal_edit
            and PermissionService.has(request.user, 'perm_idcard_reprint_list')
            and str(_card.status or '').strip().lower() in ('pool', 'approved', 'download', 'reprint')
        )
        if _is_client_edit_locked(request.user, _card.status) and not can_bypass_edit_lock:
            return _client_edit_locked_response()

        result = IDCardService.update_card(
            card_id=card_id,
            field_data=field_data,
            image_files=image_files,
            uploaded_by=request.user if request.user.is_authenticated else None,
            expected_updated_at=expected_updated_at,
            legacy_photo_file=legacy_photo_file,
            modified_by=request.user.username if request.user.is_authenticated else '',
        )

        if result.success:
            card_data = result.data['card']
            try:
                ActivityService.log(
                    'card_update',
                    'ID card updated',
                    user=request.user if request.user.is_authenticated else None,
                    request=request,
                    target_model='IDCard',
                    target_id=card_id,
                    target_name=f'Card #{card_id}',
                )
                if image_files:
                    for img_field in image_files.keys():
                        ActivityService.log(
                            'card_update',
                            f'Image "{img_field}" re-uploaded',
                            user=request.user if request.user.is_authenticated else None,
                            request=request,
                            target_model='IDCard',
                            target_id=card_id,
                            target_name=f'Card #{card_id}',
                        )
                if legacy_photo_file:
                    ActivityService.log(
                        'card_update',
                        'Image "photo" re-uploaded',
                        user=request.user if request.user.is_authenticated else None,
                        request=request,
                        target_model='IDCard',
                        target_id=card_id,
                        target_name=f'Card #{card_id}',
                    )
            except Exception:
                pass
            response_card = {
                'id': card_data['id'],
                'field_data': card_data['field_data'],
                'photo': card_data.get('photo'),
                'status': card_data['status'],
                'status_display': card_data.get('status_display'),
                'updated_at': card_data.get('updated_at'),
                'updated_at_iso': card_data.get('updated_at_iso'),
                'modified_by': card_data.get('modified_by', ''),
            }

            if PermissionService.is_client_role(request.user):
                modifier_role_map = _build_modifier_role_map([response_card.get('modified_by', '')])
                modifier, updated_at, updated_at_iso = _sanitize_client_audit_fields(
                    _card.table,
                    response_card.get('modified_by', ''),
                    response_card.get('updated_at'),
                    response_card.get('updated_at_iso'),
                    modifier_role_map,
                )
                response_card['modified_by'] = modifier
                response_card['updated_at'] = updated_at
                response_card['updated_at_iso'] = updated_at_iso

            return JsonResponse({
                'success': True,
                'message': result.message,
                'card': response_card,
            })

        # Concurrency conflict → 409
        if result.data and result.data.get('conflict'):
            return JsonResponse({
                'success': False,
                'message': result.message,
                'conflict': True,
                'server_updated_at': result.data['server_updated_at'],
            }, status=409)

        return JsonResponse({'success': False, 'message': result.message}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)


@require_http_methods(["DELETE", "POST"])
@api_require_permission('perm_idcard_delete')
def api_idcard_delete(request, card_id):
    """API endpoint to delete an ID Card"""
    _card, err = _check_client_scope_by_card(request.user, card_id)
    if err: return err
    if not _is_card_in_client_staff_scope(request.user, _card):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
    # Client/client_staff cannot delete cards in approved/download/reprint
    if _is_client_readonly(request.user, _card.status):
        return _client_readonly_response()
    try:
        result = IDCardService.delete_card(card_id)
        return JsonResponse(
            {'success': result.success, 'message': result.message},
            status=200 if result.success else 400
        )
    except Exception as e:
        logger.exception("Card delete error: %s", e)
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_edit')
def api_idcard_update_field(request, card_id):
    """API endpoint to update a single field on an ID Card (for inline editing)"""
    _card, err = _check_client_scope_by_card(request.user, card_id)
    if err: return err
    if not _is_card_in_client_staff_scope(request.user, _card):
        return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)
    # Client/client_staff cannot edit cards in approved/download/reprint.
    if _is_client_edit_locked(request.user, _card.status):
        return _client_edit_locked_response()
    try:
        data = json.loads(request.body)
        field = data.get('field')
        value = data.get('value', '')
        
        result = IDCardService.update_single_field(
            card_id, field, value,
            modified_by=request.user.username if request.user.is_authenticated else '',
        )

        if result.success and field:
            try:
                class_field_name, section_field_name, course_field_name, branch_field_name = (
                    _get_class_section_course_branch_field_names(_card.table)
                )
                normalized_field = str(field).strip().lower()
                if class_field_name and normalized_field == str(class_field_name).strip().lower():
                    invalidate_class_variant_cache(_card.table_id)
                    invalidate_filter_options_cache(_card.table_id)
                elif section_field_name and normalized_field == str(section_field_name).strip().lower():
                    invalidate_filter_options_cache(_card.table_id)
                elif course_field_name and normalized_field == str(course_field_name).strip().lower():
                    invalidate_filter_options_cache(_card.table_id)
                elif branch_field_name and normalized_field == str(branch_field_name).strip().lower():
                    invalidate_filter_options_cache(_card.table_id)
            except Exception:
                pass

            try:
                ActivityService.log(
                    'card_update',
                    f'Field "{field}" updated',
                    user=request.user if request.user.is_authenticated else None,
                    request=request,
                    target_model='IDCard',
                    target_id=card_id,
                    target_name=f'Card #{card_id}',
                )
            except Exception:
                pass

        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)


@require_http_methods(["POST"])
@api_require_any_authenticated
def api_idcard_change_status(request, card_id):
    """API endpoint to change an ID Card's status.
    
    Delegates entirely to WorkflowService.transition() which enforces:
    transition matrix, permissions, mandatory fields, image gate, client-readonly, activity log.
    """
    card, err = _check_client_scope_by_card(request.user, card_id)
    if err: return err
    try:
        data = json.loads(request.body)
        new_status = data.get('status')

        is_pool_retrieve = (
            PermissionService.is_client_staff(request.user)
            and str(card.status or '').strip().lower() == 'pool'
            and str(new_status or '').strip().lower() == 'pending'
        )

        if PermissionService.is_client_staff(request.user) and not is_pool_retrieve:
            if not _is_card_in_client_staff_scope(request.user, card):
                return JsonResponse({'success': False, 'message': 'Access denied'}, status=403)

        if is_pool_retrieve and not _is_card_in_client_staff_assignment_scope(request.user, card):
            apply_class_change = _as_bool(data.get('apply_class_change'))
            if apply_class_change:
                updated_class = data.get('updated_class')
                ok, error_message = _apply_pool_retrieve_class_change(request.user, card, updated_class)
                if not ok:
                    payload = _pool_retrieve_scope_payload(request.user, card)
                    return JsonResponse({
                        'success': False,
                        'message': error_message,
                        'requires_class_change': True,
                        'retrieve_scope': 'pool_to_pending',
                        **payload,
                    }, status=400)
                card.refresh_from_db()

            if not _is_card_in_client_staff_assignment_scope(request.user, card):
                payload = _pool_retrieve_scope_payload(request.user, card)
                if _pool_retrieve_requires_class_change(request.user, card):
                    return JsonResponse({
                        'success': False,
                        'message': _POOL_RETRIEVE_SCOPE_MESSAGE,
                        'requires_class_change': True,
                        'retrieve_scope': 'pool_to_pending',
                        **payload,
                    }, status=409)
                return JsonResponse({'success': False, 'message': _POOL_RETRIEVE_SCOPE_MESSAGE}, status=409)

        from idcards.services_workflow import WorkflowService
        result = WorkflowService.transition(card, new_status, user=request.user, request=request)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)


@require_http_methods(["POST"])
@api_require_any_authenticated
def api_idcard_bulk_status(request, table_id):
    """API endpoint to change status of multiple ID Cards.
    
    Delegates entirely to WorkflowService.bulk_transition() which enforces:
    transition matrix, permissions, mandatory fields, image gate, client-readonly, activity log.
    """
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        data = json.loads(request.body)
        card_ids = data.get('card_ids', [])
        new_status = data.get('status')
        
        if not new_status:
            return JsonResponse({'success': False, 'message': 'Status is required'}, status=400)
        if not card_ids:
            return JsonResponse({'success': False, 'message': 'No cards selected'}, status=400)

        is_pool_retrieve = (
            PermissionService.is_client_staff(request.user)
            and str(new_status or '').strip().lower() == 'pending'
        )

        forbidden_ids = _forbidden_card_ids_for_client_staff(request.user, _tbl, card_ids)
        if forbidden_ids:
            if is_pool_retrieve:
                apply_class_change = _as_bool(data.get('apply_class_change'))
                class_updates_raw = data.get('pool_retrieve_class_updates') or {}
                class_updates = class_updates_raw if isinstance(class_updates_raw, dict) else {}

                if apply_class_change and class_updates:
                    candidate_cards = list(
                        IDCard.objects.select_related('table__group').filter(
                            table=_tbl,
                            id__in=forbidden_ids,
                            status='pool',
                        )
                    )
                    for pool_card in candidate_cards:
                        requested_class = class_updates.get(str(pool_card.id), class_updates.get(pool_card.id))
                        if requested_class is None:
                            continue
                        ok, error_message = _apply_pool_retrieve_class_change(
                            request.user,
                            pool_card,
                            requested_class,
                        )
                        if not ok:
                            payload = _pool_retrieve_scope_payload(request.user, pool_card)
                            return JsonResponse({
                                'success': False,
                                'message': error_message,
                                'requires_class_change': True,
                                'retrieve_scope': 'pool_to_pending',
                                'cards': [payload],
                            }, status=400)

                    forbidden_ids = _forbidden_card_ids_for_client_staff(request.user, _tbl, card_ids)

                if forbidden_ids:
                    has_pool_mismatch = IDCard.objects.filter(
                        table=_tbl,
                        id__in=forbidden_ids,
                        status='pool',
                    ).exists()
                    if has_pool_mismatch:
                        pool_cards = list(
                            IDCard.objects.select_related('table__group').filter(
                                table=_tbl,
                                id__in=forbidden_ids,
                                status='pool',
                            )[:5]
                        )
                        payload_cards = [
                            _pool_retrieve_scope_payload(request.user, pool_card)
                            for pool_card in pool_cards
                            if _pool_retrieve_requires_class_change(request.user, pool_card)
                        ]
                        if payload_cards:
                            return JsonResponse({
                                'success': False,
                                'message': _POOL_RETRIEVE_SCOPE_MESSAGE,
                                'requires_class_change': True,
                                'retrieve_scope': 'pool_to_pending',
                                'cards': payload_cards,
                            }, status=409)
                        return JsonResponse({
                            'success': False,
                            'message': _POOL_RETRIEVE_SCOPE_MESSAGE,
                        }, status=409)
            if forbidden_ids:
                return JsonResponse({
                    'success': False,
                    'message': 'Some selected cards are outside your assigned scope.',
                }, status=403)

        from idcards.services_workflow import WorkflowService
        result = WorkflowService.bulk_transition(
            _tbl, card_ids, new_status, user=request.user, request=request
        )
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)


@require_http_methods(["POST"])
@api_require_any_authenticated
def api_idcard_bulk_delete(request, table_id):
    """API endpoint to delete multiple ID Cards.
    When delete_all=True, requires perm_delete_all_idcard + 10-digit confirmation_code.
    When delete_all=False (selected cards), requires perm_idcard_delete_from_pool.
    """
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        data = json.loads(request.body)
        card_ids = data.get('card_ids', [])
        delete_all = data.get('delete_all', False)
        
        if not delete_all and not card_ids:
            return JsonResponse({'success': False, 'message': 'No cards selected'}, status=400)

        if not delete_all:
            forbidden_ids = _forbidden_card_ids_for_client_staff(request.user, _tbl, card_ids)
            if forbidden_ids:
                return JsonResponse({
                    'success': False,
                    'message': 'Some selected cards are outside your assigned scope.',
                }, status=403)
        
        # Check appropriate permission
        if delete_all:
            if not PermissionService.has(request.user, 'perm_delete_all_idcard'):
                return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
        else:
            if not PermissionService.has(request.user, 'perm_idcard_delete_from_pool'):
                return JsonResponse({'success': False, 'message': 'Permission denied'}, status=403)
        
        # Secure confirmation for delete-all
        if delete_all:
            confirmation_code = data.get('confirmation_code', '')
            session_key = f'delete_all_code_{table_id}'
            attempt_key = f'delete_all_attempts_{table_id}'
            expected_code = request.session.get(session_key)

            try:
                attempts = int(request.session.get(attempt_key, 0) or 0)
            except (TypeError, ValueError):
                attempts = 0

            if attempts >= 5:
                return JsonResponse({
                    'success': False,
                    'message': 'Too many failed attempts. Request a new code.'
                }, status=429)
            
            if not expected_code:
                return JsonResponse({
                    'success': False,
                    'message': 'No confirmation code generated. Please request a new code.'
                }, status=400)
            
            if str(confirmation_code) != str(expected_code):
                request.session[attempt_key] = attempts + 1
                request.session.modified = True
                return JsonResponse({
                    'success': False,
                    'message': 'Invalid confirmation code. Delete aborted.'
                }, status=403)
            
            # Code verified — clear it so it can't be reused
            request.session.pop(attempt_key, None)
            request.session.pop(session_key, None)
            request.session.modified = True
        
        result = IDCardService.bulk_delete(table_id, card_ids, delete_all)
        if result.success:
            # Support both legacy 'deleted_count' and new 'moved_count' keys
            count = result.data.get('deleted_count') or result.data.get('moved_count') or len(card_ids)
            if delete_all:
                target_label = 'moved to pool (all cards)'
            else:
                target_label = f'deleted {count} card(s)'
            ActivityService.log_bulk_delete(request, target_label, count)
        return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'message': 'Invalid JSON data!'}, status=400)
    except Exception as e:
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)


@require_http_methods(["POST"])
@api_require_permission('perm_delete_all_idcard')
def api_generate_delete_code(request, table_id):
    """Generate a 10-digit confirmation code for delete-all, stored in session."""
    import secrets
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        table = _tbl  # Reuse already-fetched table from scope check
        total = IDCard.objects.filter(table=table).count()
        
        code = str(secrets.randbelow(9000000000) + 1000000000)
        request.session[f'delete_all_code_{table_id}'] = code
        request.session.pop(f'delete_all_attempts_{table_id}', None)
        request.session.modified = True
        
        return JsonResponse({
            'success': True,
            'code': code,
            'table_name': table.name,
            'total_cards': total,
        })
    except Exception as e:
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_upgrade_all')
def api_generate_upgrade_code(request, table_id):
    """Generate a 10-digit confirmation code for upgrade-all-classes, stored in session."""
    import secrets
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        table = _tbl  # Reuse already-fetched table from scope check
        download_count = IDCard.objects.filter(table=table, status='download').count()

        code = str(secrets.randbelow(9000000000) + 1000000000)
        request.session[f'upgrade_all_code_{table_id}'] = code
        request.session.modified = True

        return JsonResponse({
            'success': True,
            'code': code,
            'table_name': table.name,
            'download_count': download_count,
        })
    except Exception as e:
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)


@require_http_methods(["POST"])
@api_require_permission('perm_idcard_upgrade_all')
def api_upgrade_all_classes(request, table_id):
    """
    Upgrade the class field value for all cards in the 'download' list.
    Each class value is bumped to the next level (e.g. V → VI).
    Cards already at XII remain unchanged.
    Only affects cards with status='download'.
    Requires 10-digit confirmation code.
    """
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        # Verify confirmation code (session validation stays in view — request-scoped)
        data = json.loads(request.body) if request.body else {}
        confirmation_code = data.get('confirmation_code', '')
        expected_code = request.session.get(f'upgrade_all_code_{table_id}', '')

        if not expected_code or confirmation_code != expected_code:
            return JsonResponse({
                'success': False,
                'message': 'Invalid or expired confirmation code. Please try again.'
            }, status=400)

        # Clear the code after use
        request.session.pop(f'upgrade_all_code_{table_id}', None)
        request.session.modified = True

        # Delegate to service layer
        result = IDCardService.upgrade_all_classes(table_id)
        if not result.success:
            return JsonResponse({'success': False, 'message': result.message}, status=400)

        try:
            invalidate_class_variant_cache(table_id)
            invalidate_filter_options_cache(table_id)
            CacheVersionService.bump('mob_filter', int(table_id))
            CacheVersionService.bump('global_search', 'all')
            table_client_id = getattr(getattr(_tbl, 'group', None), 'client_id', None)
            if table_client_id:
                CacheVersionService.bump('class_section', int(table_client_id))
        except Exception:
            pass

        if result.data.get('upgraded', 0) > 0:
            ActivityService.log_bulk_upgrade(
                request, result.data['upgraded'], result.data.get('client_name', '')
            )

        return JsonResponse({
            'success': True,
            'message': result.message,
            'upgraded': result.data['upgraded'],
            'skipped': result.data['skipped'],
            'total': result.data['total'],
        })
    except Exception as e:
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)


@require_http_methods(["GET"])
@api_require_any_authenticated
def api_idcard_search(request, table_id):
    """API endpoint to search ID Cards across all statuses"""
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    query = request.GET.get('q', '').strip()
    result = IDCardService.search_cards(table_id, query)
    return JsonResponse(result.to_response_dict(), status=200 if result.success else 400)


@require_http_methods(["GET"])
@api_require_any_authenticated
def api_table_status_counts(request, table_id):
    """API endpoint to get status counts for a table"""
    _tbl, err = _check_client_scope_by_table(request.user, table_id)
    if err: return err
    try:
        table = _tbl  # Reuse already-fetched table from scope check
        if PermissionService.is_client_staff(request.user):
            from django.db.models import Count
            scoped_cards_qs = _apply_client_staff_row_scope(
                IDCard.objects.filter(table=table),
                request.user,
                table,
            )
            status_counts = {
                'pending': 0,
                'verified': 0,
                'pool': 0,
                'approved': 0,
                'download': 0,
                'reprint': 0,
                'total': 0,
            }
            for row in scoped_cards_qs.order_by().values('status').annotate(count=Count('id')):
                st = row.get('status')
                ct = row.get('count', 0)
                if st in status_counts:
                    status_counts[st] = ct
                    status_counts['total'] += ct

            status_counts['pool'] = IDCard.objects.filter(table=table, status='pool').count()
            status_counts['total'] = (
                status_counts.get('pending', 0)
                + status_counts.get('verified', 0)
                + status_counts.get('pool', 0)
                + status_counts.get('approved', 0)
                + status_counts.get('download', 0)
                + status_counts.get('reprint', 0)
            )
        else:
            status_counts = IDCardService.get_status_counts(table)
        
        return JsonResponse({
            'success': True,
            'status_counts': status_counts
        })
    except Exception as e:
        return JsonResponse({'success': False, 'message': _safe_error(e)}, status=500)
