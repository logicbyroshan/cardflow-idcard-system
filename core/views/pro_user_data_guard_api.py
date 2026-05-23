"""
Pro User Data Deletion Guard API.

Provides a guarded, pro_user-only workflow for permanently deleting
ID card records by table-level filters.
"""

import json
import logging
import secrets
import string
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, Optional, Tuple

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.db.models import CharField, Count, Q
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from client.models import Client
from exports.column_spec import get_column_spec
from core.services import IDCardService
from core.services.activity_service import ActivityService
from core.services.permission_service import PermissionService
from idcards.models import IDCard, IDCardTable

from .idcard_helpers import _build_class_filter_q, _get_class_section_course_branch_field_names

logger = logging.getLogger(__name__)

_ALLOWED_STATUSES = {'pending', 'verified', 'pool', 'approved', 'download', 'reprint'}
_ALLOWED_IMAGE_CONDITIONS = {'complete', 'pending', 'incomplete'}
_ALLOWED_COLUMN_MATCHES = {'exact', 'contains', 'startswith', 'endswith'}
_ALLOWED_ACTION_TYPES = {
    'filtered_delete',
    'delete_pending_images',
    'delete_completed_images',
    'delete_by_column',
}

_DATA_GUARD_CODE_TTL_SECONDS = 600
_DATA_GUARD_MAX_ATTEMPTS = 5


def _guard_confirm_phrase() -> str:
    phrase = str(getattr(settings, 'PRO_DATA_DELETE_CONFIRM_PHRASE', 'PERMANENT DELETE') or '').strip()
    return phrase or 'PERMANENT DELETE'


def _can_use_data_guard(user) -> bool:
    return PermissionService.can_use_pro_data_deletion_guard(user)


def _require_pro_user(request):
    if not _can_use_data_guard(getattr(request, 'user', None)):
        return JsonResponse({'success': False, 'message': 'Super admin or pro user access required.'}, status=403)
    return None


def _code_session_key(user_id: int) -> str:
    return f'pro_data_guard_code_{user_id}'


def _attempts_session_key(user_id: int) -> str:
    return f'pro_data_guard_attempts_{user_id}'


def _read_attempts(request) -> int:
    try:
        return int(request.session.get(_attempts_session_key(request.user.pk), 0) or 0)
    except (TypeError, ValueError):
        return 0


def _set_attempts(request, attempts: int) -> None:
    request.session[_attempts_session_key(request.user.pk)] = max(int(attempts or 0), 0)
    request.session.modified = True


def _reset_attempts(request) -> None:
    key = _attempts_session_key(request.user.pk)
    if key in request.session:
        del request.session[key]
        request.session.modified = True


def _increment_attempts(request) -> int:
    attempts = _read_attempts(request) + 1
    _set_attempts(request, attempts)
    return attempts


def _store_guard_code(request, code: str) -> None:
    request.session[_code_session_key(request.user.pk)] = {
        'code': str(code or ''),
        'generated_at': datetime.now(dt_timezone.utc).isoformat(),
    }
    _reset_attempts(request)
    request.session.modified = True


def _consume_guard_code_if_valid(request, provided_code: str):
    key = _code_session_key(request.user.pk)
    payload = request.session.get(key)
    now = datetime.now(dt_timezone.utc)

    if not isinstance(payload, dict):
        _increment_attempts(request)
        return False, 'missing'

    generated_raw = str(payload.get('generated_at') or '').strip()
    generated_at = None
    if generated_raw:
        try:
            generated_at = datetime.fromisoformat(generated_raw.replace('Z', '+00:00'))
            if generated_at.tzinfo is None:
                generated_at = generated_at.replace(tzinfo=dt_timezone.utc)
        except Exception:
            generated_at = None

    if not generated_at or (now - generated_at).total_seconds() > _DATA_GUARD_CODE_TTL_SECONDS:
        request.session.pop(key, None)
        _increment_attempts(request)
        request.session.modified = True
        return False, 'expired'

    if str(payload.get('code') or '') != str(provided_code or ''):
        _increment_attempts(request)
        return False, 'invalid'

    request.session.pop(key, None)
    _reset_attempts(request)
    request.session.modified = True
    return True, 'ok'


def _parse_payload(request) -> Dict[str, Any]:
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, TypeError, ValueError):
        return {}


def _parse_int(value) -> Optional[int]:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError, AttributeError):
        return None
    return parsed if parsed > 0 else None


def _table_fields_meta(table) -> Tuple[set, list, list]:
    field_defs = table.fields or []
    allowed_field_names = {
        str(field.get('name') or '').strip()
        for field in field_defs
        if str(field.get('name') or '').strip()
    }
    all_fields = []
    image_fields = []
    for field in field_defs:
        name = str(field.get('name') or '').strip()
        if not name:
            continue
        field_type = str(field.get('type') or 'text').strip().lower()
        all_fields.append({'name': name, 'type': field_type})
        if field_type in {'photo', 'rel_photo', 'mother_photo', 'father_photo', 'signature'}:
            image_fields.append(name)
    return allowed_field_names, all_fields, image_fields


def _resolve_table_for_guard(user, table_id: int):
    table = (
        IDCardTable.objects
        .select_related('group', 'group__client')
        .filter(id=table_id, deleted_by_client=False)
        .first()
    )
    if not table:
        return None, JsonResponse({'success': False, 'message': 'Table not found.'}, status=404)

    client_id = getattr(getattr(table, 'group', None), 'client_id', None)
    if not client_id or not PermissionService.can_access_client(user, client_id):
        return None, JsonResponse({'success': False, 'message': 'Access denied for selected table.'}, status=403)

    return table, None


def _parse_iso_datetime(value: str):
    raw = str(value or '').strip()
    if not raw:
        return None
    dt = parse_datetime(raw)
    if not dt:
        return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _build_filtered_queryset(table, payload: Dict[str, Any], action_type: str):
    status_filter = str(payload.get('status') or '').strip().lower()
    search_query = str(payload.get('search') or '').strip()
    class_filter = str(payload.get('class') or payload.get('class_filter') or '').strip()
    section_filter = str(payload.get('section') or payload.get('section_filter') or '').strip()
    course_filter = str(payload.get('course') or payload.get('course_filter') or '').strip()
    branch_filter = str(payload.get('branch') or payload.get('branch_filter') or '').strip()

    image_column = str(payload.get('image_column') or '').strip()
    image_condition = str(payload.get('image_condition') or '').strip().lower()

    filter_column = str(payload.get('filter_column') or '').strip()
    filter_value = str(payload.get('filter_value') or '').strip()
    filter_match = str(payload.get('filter_match') or 'contains').strip().lower()

    if status_filter and status_filter not in _ALLOWED_STATUSES:
        return None, JsonResponse({'success': False, 'message': 'Invalid status filter.'}, status=400), None

    if action_type == 'delete_pending_images':
        image_condition = 'pending'
    elif action_type == 'delete_completed_images':
        image_condition = 'complete'

    if image_condition and image_condition not in _ALLOWED_IMAGE_CONDITIONS:
        return None, JsonResponse({'success': False, 'message': 'Invalid image condition filter.'}, status=400), None

    if filter_match not in _ALLOWED_COLUMN_MATCHES:
        filter_match = 'contains'

    if action_type == 'delete_by_column' and (not filter_column or not filter_value):
        return None, JsonResponse({'success': False, 'message': 'Column name and value are required for column delete action.'}, status=400), None

    allowed_field_names, _all_fields, image_fields = _table_fields_meta(table)

    if image_column and image_column not in allowed_field_names:
        return None, JsonResponse({'success': False, 'message': 'Invalid image column selected.'}, status=400), None

    if image_condition and not image_column:
        if len(image_fields) == 1:
            image_column = image_fields[0]
        else:
            return None, JsonResponse({'success': False, 'message': 'Select an image column for image-condition delete.'}, status=400), None

    if filter_column and filter_column not in allowed_field_names:
        return None, JsonResponse({'success': False, 'message': 'Invalid column selected for value filter.'}, status=400), None

    qs = IDCard.objects.filter(table=table)

    if status_filter:
        qs = qs.filter(status=status_filter)

    if search_query:
        qs = IDCardService._apply_search_filter(qs, search_query, table=table)

    if class_filter or section_filter or course_filter or branch_filter:
        class_field_name, section_field_name, course_field_name, branch_field_name = (
            _get_class_section_course_branch_field_names(table)
        )
        if class_filter and class_field_name:
            qs = _build_class_filter_q(qs, class_filter, class_field_name)
        if section_filter and section_field_name:
            qs = qs.annotate(_guard_sec=KeyTextTransform(section_field_name, 'field_data')).filter(_guard_sec__iexact=section_filter)
        if course_filter and course_field_name:
            qs = qs.annotate(_guard_course=KeyTextTransform(course_field_name, 'field_data')).filter(_guard_course__iexact=course_filter)
        if branch_filter and branch_field_name:
            qs = qs.annotate(_guard_branch=KeyTextTransform(branch_field_name, 'field_data')).filter(_guard_branch__iexact=branch_filter)

    if image_column and image_condition:
        qs = qs.annotate(_guard_img=Cast(KeyTextTransform(image_column, 'field_data'), CharField()))
        if image_condition == 'complete':
            qs = qs.exclude(_guard_img__isnull=True).exclude(_guard_img='').exclude(_guard_img='NOT_FOUND')
            qs = qs.exclude(_guard_img__startswith='PENDING:')
        elif image_condition == 'pending':
            qs = qs.filter(_guard_img__startswith='PENDING:')
        elif image_condition == 'incomplete':
            qs = qs.filter(Q(_guard_img__isnull=True) | Q(_guard_img='') | Q(_guard_img='NOT_FOUND'))

    if filter_column and filter_value:
        qs = qs.annotate(_guard_col=Cast(KeyTextTransform(filter_column, 'field_data'), CharField()))
        if filter_match == 'exact':
            qs = qs.filter(_guard_col__iexact=filter_value)
        elif filter_match == 'startswith':
            qs = qs.filter(_guard_col__istartswith=filter_value)
        elif filter_match == 'endswith':
            qs = qs.filter(_guard_col__iendswith=filter_value)
        else:
            qs = qs.filter(_guard_col__icontains=filter_value)

    from_date = _parse_iso_datetime(payload.get('from'))
    to_date = _parse_iso_datetime(payload.get('to'))
    if status_filter == 'download':
        if from_date:
            qs = qs.filter(downloaded_at__gte=from_date)
        if to_date:
            qs = qs.filter(downloaded_at__lte=to_date)

    normalized_filters = {
        'status': status_filter,
        'search': search_query,
        'class': class_filter,
        'section': section_filter,
        'course': course_filter,
        'branch': branch_filter,
        'image_column': image_column,
        'image_condition': image_condition,
        'filter_column': filter_column,
        'filter_value': filter_value,
        'filter_match': filter_match,
        'from': payload.get('from') or '',
        'to': payload.get('to') or '',
    }
    return qs, None, normalized_filters


def _summarize_filters(action_type: str, filters: Dict[str, Any]) -> str:
    parts = [f'action={action_type}']
    for key in ('status', 'class', 'section', 'course', 'branch', 'image_column', 'image_condition', 'filter_column', 'filter_value'):
        value = str(filters.get(key) or '').strip()
        if value:
            parts.append(f'{key}={value}')
    return ', '.join(parts)


def _apply_field_clear_action(request, target_ids, field_name: str):
    modified_by = getattr(request.user, 'username', None) or getattr(request.user, 'email', None) or ''
    cleared_count = 0

    for card_id in target_ids:
        result = IDCardService.update_single_field(card_id, field_name, '', modified_by=modified_by)
        if not result.success:
            return False, cleared_count, result.message or 'Field clear failed.'
        cleared_count += 1

    return True, cleared_count, ''


def _sample_rows(qs, table, limit=10):
    table_fields = list(getattr(table, 'fields', []) or [])
    columns = [
        {'key': 'id', 'label': 'ID', 'th_class': 'w-[50px] min-w-[50px]', 'td_class': 'text-center'},
        {'key': 'status', 'label': 'Status', 'th_class': 'w-[80px] min-w-[80px]', 'td_class': 'text-center'},
    ]
    seen_keys = {'id', 'status'}

    for field in table_fields:
        field_name = str(field.get('name', '')).strip()
        field_type = str(field.get('type', '')).strip()
        if not field_name:
            continue
        
        # Get column spec for consistency with other tables
        spec = get_column_spec(field_name, field_type)
        columns.append({
            'key': field_name, 
            'label': field_name,
            'th_class': spec.html_th_class,
            'td_class': spec.html_td_class
        })
        seen_keys.add(field_name)

    rows = []
    for card in qs.only('id', 'status', 'field_data').order_by('id')[:limit]:
        field_data = card.field_data or {}
        row = {'id': card.id, 'status': card.status}

        for column in columns[2:]:
            key = column['key']
            value = field_data.get(key, '')
            if isinstance(value, (dict, list, tuple)):
                row[key] = json.dumps(value, ensure_ascii=False)
            else:
                row[key] = '' if value is None else str(value)

        for key, value in field_data.items():
            if key in seen_keys:
                continue
            seen_keys.add(key)
            columns.append({'key': key, 'label': key})
            if isinstance(value, (dict, list, tuple)):
                row[key] = json.dumps(value, ensure_ascii=False)
            else:
                row[key] = '' if value is None else str(value)

        rows.append(row)

    return columns, rows


@require_http_methods(["GET"])
@login_required
def api_pro_user_data_guard_clients(request):
    guard_err = _require_pro_user(request)
    if guard_err:
        return guard_err

    clients = list(
        Client.objects.order_by('name').values('id', 'name', 'status')
    )
    return JsonResponse({'success': True, 'clients': clients})


@require_http_methods(["GET"])
@login_required
def api_pro_user_data_guard_tables(request):
    guard_err = _require_pro_user(request)
    if guard_err:
        return guard_err

    client_id = _parse_int(request.GET.get('client_id'))
    if not client_id:
        return JsonResponse({'success': False, 'message': 'Valid client_id is required.'}, status=400)

    if not PermissionService.can_access_client(request.user, client_id):
        return JsonResponse({'success': False, 'message': 'Access denied for selected client.'}, status=403)

    table_qs = (
        IDCardTable.objects
        .select_related('group')
        .filter(group__client_id=client_id, deleted_by_client=False)
        .annotate(
            total_cards=Count('id_cards'),
            pending_cards=Count('id_cards', filter=Q(id_cards__status='pending')),
            download_cards=Count('id_cards', filter=Q(id_cards__status='download')),
        )
        .order_by('group__name', 'name')
    )

    tables = []
    for table in table_qs:
        _allowed_field_names, all_fields, image_fields = _table_fields_meta(table)
        tables.append({
            'id': table.id,
            'name': table.name,
            'group_name': table.group.name if table.group_id else '',
            'total_cards': int(getattr(table, 'total_cards', 0) or 0),
            'pending_cards': int(getattr(table, 'pending_cards', 0) or 0),
            'download_cards': int(getattr(table, 'download_cards', 0) or 0),
            'fields': all_fields,
            'image_fields': image_fields,
        })

    return JsonResponse({'success': True, 'tables': tables})


@require_http_methods(["POST"])
@login_required
def api_pro_user_data_guard_preview(request):
    guard_err = _require_pro_user(request)
    if guard_err:
        return guard_err

    payload = _parse_payload(request)
    table_id = _parse_int(payload.get('table_id'))
    if not table_id:
        return JsonResponse({'success': False, 'message': 'Valid table_id is required.'}, status=400)

    table, table_err = _resolve_table_for_guard(request.user, table_id)
    if table_err:
        return table_err

    action_type = str(payload.get('action_type') or 'filtered_delete').strip().lower()
    if action_type not in _ALLOWED_ACTION_TYPES:
        action_type = 'filtered_delete'

    qs, filter_err, normalized = _build_filtered_queryset(table, payload, action_type)
    if filter_err:
        return filter_err

    match_count = qs.count()
    columns, sample_rows = _sample_rows(qs, table, limit=100)
    return JsonResponse({
        'success': True,
        'match_count': match_count,
        'columns': columns,
        'sample': sample_rows,
        'action_type': action_type,
        'normalized_filters': normalized,
    })


@require_http_methods(["GET"])
@login_required
def api_pro_user_data_guard_generate_code(request):
    guard_err = _require_pro_user(request)
    if guard_err:
        return guard_err

    code = ''.join(secrets.choice(string.digits) for _ in range(10))
    _store_guard_code(request, code)
    return JsonResponse({
        'success': True,
        'code': code,
        'confirm_phrase': _guard_confirm_phrase(),
    })


@require_http_methods(["POST"])
@login_required
def api_pro_user_data_guard_delete(request):
    guard_err = _require_pro_user(request)
    if guard_err:
        return guard_err

    payload = _parse_payload(request)

    action_type = str(payload.get('action_type') or 'filtered_delete').strip().lower()
    if action_type not in _ALLOWED_ACTION_TYPES:
        action_type = 'filtered_delete'

    confirmation_code = str(payload.get('confirmation_code') or '').strip()
    if len(confirmation_code) != 10 or not confirmation_code.isdigit():
        return JsonResponse({'success': False, 'message': 'A valid 10-digit confirmation code is required.'}, status=400)

    expected_phrase = _guard_confirm_phrase()
    confirmation_phrase = str(payload.get('confirmation_phrase') or '').strip()
    if confirmation_phrase != expected_phrase:
        return JsonResponse({'success': False, 'message': f'Type "{expected_phrase}" to confirm deletion.'}, status=400)

    attempts = _read_attempts(request)
    if attempts >= _DATA_GUARD_MAX_ATTEMPTS:
        return JsonResponse({'success': False, 'message': 'Too many failed attempts. Generate a fresh code and retry.'}, status=429)

    code_valid, code_reason = _consume_guard_code_if_valid(request, confirmation_code)
    if not code_valid:
        message = 'Invalid confirmation code. Generate a fresh code and retry.'
        if code_reason == 'expired':
            message = 'Confirmation code expired. Generate a fresh code and retry.'
        return JsonResponse({'success': False, 'message': message}, status=400)

    table_id = _parse_int(payload.get('table_id'))
    if not table_id:
        return JsonResponse({'success': False, 'message': 'Valid table_id is required.'}, status=400)

    table, table_err = _resolve_table_for_guard(request.user, table_id)
    if table_err:
        return table_err

    qs, filter_err, normalized = _build_filtered_queryset(table, payload, action_type)
    if filter_err:
        return filter_err

    target_ids = list(qs.order_by('id').values_list('id', flat=True))
    if not target_ids:
        return JsonResponse({
            'success': True,
            'deleted_count': 0,
            'message': 'No matching records found for the selected filters.',
            'action_type': action_type,
            'filter_summary': _summarize_filters(action_type, normalized),
        })

    try:
        filter_summary = _summarize_filters(action_type, normalized)

        if action_type == 'filtered_delete':
            deleted_total = 0
            chunk_size = 400
            for start in range(0, len(target_ids), chunk_size):
                chunk = target_ids[start:start + chunk_size]
                result = IDCardService.bulk_delete(table.id, chunk, delete_all=False)
                if not result.success:
                    logger.error('Pro data guard delete failed on chunk: table=%s message=%s', table.id, result.message)
                    return JsonResponse({
                        'success': False,
                        'message': result.message or 'Delete failed during execution.',
                        'partial_deleted_count': deleted_total,
                    }, status=500)
                deleted_total += int((result.data or {}).get('deleted_count') or 0)

            ActivityService.log_bulk_delete(
                request,
                f'guarded ID card records from table "{table.name}" ({filter_summary})',
                deleted_total,
            )

            return JsonResponse({
                'success': True,
                'deleted_count': deleted_total,
                'table_name': table.name,
                'client_name': table.group.client.name if table.group_id and table.group.client_id else '',
                'action_type': action_type,
                'filter_summary': filter_summary,
                'message': f'Permanently deleted {deleted_total} record(s).',
            })

        if action_type in {'delete_pending_images', 'delete_completed_images', 'delete_by_column'}:
            # These action types delete records (not just clear fields)
            deleted_total = 0
            chunk_size = 400
            for start in range(0, len(target_ids), chunk_size):
                chunk = target_ids[start:start + chunk_size]
                result = IDCardService.bulk_delete(table.id, chunk, delete_all=False)
                if not result.success:
                    logger.error('Pro data guard delete failed on chunk: table=%s message=%s', table.id, result.message)
                    return JsonResponse({
                        'success': False,
                        'message': result.message or 'Delete failed during execution.',
                        'partial_deleted_count': deleted_total,
                    }, status=500)
                deleted_total += int((result.data or {}).get('deleted_count') or 0)

            action_desc = ''
            if action_type == 'delete_pending_images':
                action_desc = f'deleted ID cards with pending images (column "{normalized["image_column"]}") from table "{table.name}"'
            elif action_type == 'delete_completed_images':
                action_desc = f'deleted ID cards with completed images (column "{normalized["image_column"]}") from table "{table.name}"'
            else:  # delete_by_column
                action_desc = f'deleted ID cards matching column "{normalized["filter_column"]}" = "{normalized["filter_value"]}" from table "{table.name}"'

            ActivityService.log_bulk_delete(
                request,
                action_desc + f' ({filter_summary})',
                deleted_total,
            )

            return JsonResponse({
                'success': True,
                'deleted_count': deleted_total,
                'table_name': table.name,
                'client_name': table.group.client.name if table.group_id and table.group.client_id else '',
                'action_type': action_type,
                'filter_summary': filter_summary,
                'message': f'Permanently deleted {deleted_total} record(s).',
            })

        return JsonResponse({'success': False, 'message': 'Unsupported action type.'}, status=400)
    except Exception:
        logger.exception('Unexpected pro data guard delete failure for table=%s', table.id)
        return JsonResponse({'success': False, 'message': 'Unexpected delete failure.'}, status=500)
