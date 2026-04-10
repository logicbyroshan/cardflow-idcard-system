"""
Card Print Views
================
Page views + API endpoints for the Print Cards workflow:
    Approved → Generate List → Finalized → Pool
  + Generate Card editor page + PDF generation API.

ARCHITECTURE RULES (same as reprint):
- Views are ULTRA-THIN: parse request → call service → return JsonResponse.
- All mutations delegate to PrintWorkflowService / GenerateCardService.
"""
import json
import logging
import re
import uuid
import io
import base64

from django.shortcuts import get_object_or_404, redirect, render
from django.http import HttpResponse, JsonResponse, FileResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.timezone import localtime
from django.utils.dateparse import parse_datetime
from django.core.files.base import ContentFile
from django.urls import reverse

from idcards.models import IDCard, IDCardTable
from core.services.permission_service import PermissionService, api_require_permission
from core.services.activity_service import ActivityService
from core.views.base import get_user_role, require_any_admin
from core.services import IDCardService
from accounts.rate_limit import rate_limit

from .models import PrintRequest, CardTemplate, CardTemplateDoc, validate_field_mappings
from .services import PrintWorkflowService, GenerateCardService, PdfTemplateAnalyzerService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def _print_access_denied():
    return JsonResponse(
        {'status': 'error', 'message': 'Access denied. You are not assigned to this client.'},
        status=403,
    )


def _parse_offset_limit(request, *, default_limit=100, max_limit=200):
    """Parse and clamp offset/limit query params for list endpoints."""
    try:
        offset = int(request.GET.get('offset', 0))
    except (ValueError, TypeError):
        offset = 0
    try:
        limit = int(request.GET.get('limit', default_limit))
    except (ValueError, TypeError):
        limit = default_limit

    offset = max(offset, 0)
    limit = min(max(limit, 1), max_limit)
    return offset, limit


def _normalize_hex_color(value, default='#111111'):
    raw = str(value or '').strip()
    if not raw:
        return default

    v = raw[1:] if raw.startswith('#') else raw
    if re.fullmatch(r'[0-9a-fA-F]{3}', v):
        v = ''.join(ch * 2 for ch in v)
    if not re.fullmatch(r'[0-9a-fA-F]{6}', v):
        return default
    return f'#{v.upper()}'


def _parse_local_datetime_filter(value):
    """Parse datetime-local input safely into an aware datetime."""
    if not value:
        return None
    dt = parse_datetime(value)
    if not dt:
        return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _check_print_table_scope(user, table_id):
    """Check user has access to the client owning this table."""
    table = get_object_or_404(IDCardTable.objects.select_related('group'), id=table_id)
    if not PermissionService.is_super_admin(user):
        staff_profile = getattr(user, 'staff_profile', None)
        if staff_profile and staff_profile.staff_type == 'admin_staff':
            if not staff_profile.assigned_clients.filter(id=table.group.client_id).exists():
                return None, _print_access_denied()
        elif user.role in ('client', 'client_staff'):
            from client.services import ClientAccessService
            if not ClientAccessService.can_access_table(user, table):
                return None, _print_access_denied()
    return table, None


def _build_ordered_fields(table, fd=None, fd_upper=None):
    """Build ordered fields list for a card's field_data against table.fields."""
    if fd is None:
        fd = {}
    if fd_upper is None:
        fd_upper = {k.upper(): v for k, v in fd.items()}
    ordered = []
    for field in table.fields:
        fname = field['name']
        ftype = field.get('type', 'text')
        fval = fd.get(fname, '') or fd_upper.get(fname.upper(), '')
        ordered.append({'name': fname, 'type': ftype, 'value': fval})
    return ordered


def _get_selected_generate_field_names(table, template_obj=None):
    """Return selected field names for generate-list display; fallback to all fields."""
    if template_obj is None:
        template_obj = CardTemplate.objects.filter(table=table).first()

    all_field_names = [f.get('name') for f in (table.fields or []) if f.get('name')]
    if not template_obj:
        return all_field_names

    cfg = template_obj.field_config or {}
    front = cfg.get('front_fields') or []
    back = cfg.get('back_fields') or [] if cfg.get('is_two_sided') else []

    valid = set(all_field_names)
    selected = []
    for name in front + back:
        if name in valid and name not in selected:
            selected.append(name)

    return selected if selected else all_field_names


def _filter_ordered_fields_by_names(ordered_fields, allowed_names):
    """Filter ordered_fields to the selected names while preserving row order."""
    if not ordered_fields or not allowed_names:
        return ordered_fields
    allowed = set(allowed_names)
    return [f for f in ordered_fields if f.get('name') in allowed]


def _promote_legacy_print_list(table):
    """One-way compatibility: move legacy print_list rows into generate_list."""
    PrintRequest.objects.filter(table=table, status='print_list').update(status='generate_list')


def _safe_template_pdf_url(file_field):
    """Return a usable template file URL only when the underlying file exists."""
    if not file_field:
        return ''

    name = str(getattr(file_field, 'name', '') or '').strip()
    if not name:
        return ''

    storage = getattr(file_field, 'storage', None)
    try:
        if storage and not storage.exists(name):
            return ''
        return file_field.url
    except Exception:
        logger.warning('Template file missing/unreadable: %s', name, exc_info=True)
        return ''


def _clamp_float(value, minimum, maximum, default):
    try:
        num = float(value)
    except (TypeError, ValueError):
        return default
    if num < minimum:
        return minimum
    if num > maximum:
        return maximum
    return num


def _sanitize_name_list(values):
    if not isinstance(values, list):
        return []
    out = []
    seen = set()
    for raw in values:
        name = str(raw or '').strip()
        if not name or name in seen:
            continue
        if len(name) > 120:
            name = name[:120]
        out.append(name)
        seen.add(name)
        if len(out) >= 400:
            break
    return out


def _sanitize_editable_design_model(raw):
    if not isinstance(raw, dict):
        return None

    lines_out = []
    for item in (raw.get('lines') or []):
        if not isinstance(item, dict):
            continue
        align = str(item.get('text_align') or 'left').strip().lower()
        if align not in ('left', 'center', 'right'):
            align = 'left'
        weight = str(item.get('font_weight') or '400').strip().lower()
        if weight in ('bold', '700'):
            weight = '700'
        elif weight in ('semibold', '600'):
            weight = '600'
        else:
            weight = '400'
        lines_out.append({
            'text': str(item.get('text') or '')[:1200],
            'x_mm': round(_clamp_float(item.get('x_mm'), 0.0, 500.0, 0.0), 2),
            'y_mm': round(_clamp_float(item.get('y_mm'), 0.0, 500.0, 0.0), 2),
            'w_mm': round(_clamp_float(item.get('w_mm'), 0.5, 500.0, 20.0), 2),
            'h_mm': round(_clamp_float(item.get('h_mm'), 0.5, 500.0, 8.0), 2),
            'font_size_pt': round(_clamp_float(item.get('font_size_pt'), 6.0, 72.0, 11.0), 2),
            'font_family': str(item.get('font_family') or 'Arial')[:80],
            'font_weight': weight,
            'line_height': round(_clamp_float(item.get('line_height'), 0.8, 3.0, 1.15), 2),
            'char_spacing_pt': round(_clamp_float(item.get('char_spacing_pt'), -5.0, 20.0, 0.0), 2),
            'font_color_hex': _normalize_hex_color(item.get('font_color_hex') or '#111111'),
            'text_align': align,
        })
        if len(lines_out) >= 1200:
            break

    images_out = []
    for item in (raw.get('images') or []):
        if not isinstance(item, dict):
            continue
        data_url = str(item.get('data_url') or '').strip()
        if not data_url.startswith('data:image/'):
            continue
        # Keep field_config bounded to avoid runaway payload growth.
        if len(data_url) > 3_000_000:
            continue
        images_out.append({
            'x_mm': round(_clamp_float(item.get('x_mm'), 0.0, 500.0, 0.0), 2),
            'y_mm': round(_clamp_float(item.get('y_mm'), 0.0, 500.0, 0.0), 2),
            'w_mm': round(_clamp_float(item.get('w_mm'), 0.5, 500.0, 20.0), 2),
            'h_mm': round(_clamp_float(item.get('h_mm'), 0.5, 500.0, 20.0), 2),
            'data_url': data_url,
        })
        if len(images_out) >= 30:
            break

    if not lines_out and not images_out:
        return None

    page_mm = raw.get('page_mm') if isinstance(raw.get('page_mm'), dict) else {}
    return {
        'engine': str(raw.get('engine') or 'pymupdf-editable')[:60],
        'page_mm': {
            'width': round(_clamp_float(page_mm.get('width'), 1.0, 500.0, 87.0), 2),
            'height': round(_clamp_float(page_mm.get('height'), 1.0, 500.0, 57.0), 2),
        },
        'lines': lines_out,
        'images': images_out,
    }


def _editor_field_config_payload(field_config):
    cfg = field_config if isinstance(field_config, dict) else {}
    orientation = str(cfg.get('card_orientation') or 'landscape').strip().lower()
    if orientation not in ('landscape', 'portrait'):
        orientation = 'landscape'
    return {
        'is_two_sided': bool(cfg.get('is_two_sided', False)),
        'card_orientation': orientation,
        'front_fields': _sanitize_name_list(cfg.get('front_fields') or []),
        'back_fields': _sanitize_name_list(cfg.get('back_fields') or []),
        'doc_page_settings': _sanitize_doc_page_settings(cfg.get('doc_page_settings'), orientation),
    }


def _sanitize_doc_page_settings(raw, orientation='landscape'):
    settings = raw if isinstance(raw, dict) else {}
    safe_orientation = 'portrait' if orientation == 'portrait' else 'landscape'
    card_w_mm, card_h_mm = GenerateCardService.dimensions_for_orientation_mm(safe_orientation)

    margins = settings.get('margins_mm') if isinstance(settings.get('margins_mm'), dict) else {}
    left = _clamp_float(margins.get('left'), 0.0, 25.0, 3.0)
    right = _clamp_float(margins.get('right'), 0.0, 25.0, 3.0)
    top = _clamp_float(margins.get('top'), 0.0, 25.0, 3.0)
    bottom = _clamp_float(margins.get('bottom'), 0.0, 25.0, 3.0)

    max_horizontal = max(4.0, card_w_mm - 8.0)
    if (left + right) > max_horizontal:
        ratio = max_horizontal / max(0.1, left + right)
        left = round(left * ratio, 2)
        right = round(right * ratio, 2)

    max_vertical = max(4.0, card_h_mm - 8.0)
    if (top + bottom) > max_vertical:
        ratio = max_vertical / max(0.1, top + bottom)
        top = round(top * ratio, 2)
        bottom = round(bottom * ratio, 2)

    def _sanitize_mm_list(values, max_mm, max_items=24):
        if isinstance(values, str):
            src = [chunk.strip() for chunk in values.split(',')]
        elif isinstance(values, list):
            src = values
        else:
            src = []

        out = []
        seen = set()
        for raw_val in src:
            val = round(_clamp_float(raw_val, 0.0, max_mm, -1.0), 2)
            if val < 0.0:
                continue
            key = f'{val:.2f}'
            if key in seen:
                continue
            seen.add(key)
            out.append(val)
            if len(out) >= max_items:
                break
        return out

    wrap_mode = str(settings.get('wrap_mode') or 'margin').strip().lower()
    if wrap_mode not in ('margin', 'box'):
        wrap_mode = 'margin'

    return {
        'margins_mm': {
            'left': round(left, 2),
            'right': round(right, 2),
            'top': round(top, 2),
            'bottom': round(bottom, 2),
        },
        'line_gap_mm': round(_clamp_float(settings.get('line_gap_mm'), 0.0, 12.0, 2.5), 2),
        'wrap_mode': wrap_mode,
        'snap_to_guides': bool(settings.get('snap_to_guides', True)),
        'guides_x_mm': _sanitize_mm_list(settings.get('guides_x_mm'), card_w_mm),
        'guides_y_mm': _sanitize_mm_list(settings.get('guides_y_mm'), card_h_mm),
    }


def _sanitize_mapping_confidence(raw):
    out = {'front': {}, 'back': {}}
    if not isinstance(raw, dict):
        return out

    for side in ('front', 'back'):
        side_raw = raw.get(side)
        if not isinstance(side_raw, dict):
            continue
        for field_name, payload in side_raw.items():
            name = str(field_name or '').strip()
            if not name:
                continue
            payload = payload if isinstance(payload, dict) else {}
            confidence = _clamp_float(payload.get('confidence'), 0.0, 1.0, 0.5)
            reason = str(payload.get('reason') or '').strip()[:200]
            source = str(payload.get('source') or '').strip()[:50]
            try:
                updated_at = int(payload.get('updated_at', 0) or 0)
            except (TypeError, ValueError):
                updated_at = 0
            out[side][name] = {
                'confidence': round(confidence, 4),
                'reason': reason,
                'source': source,
                'updated_at': max(0, updated_at),
            }

    return out


def _sanitize_doc_layout_name(value):
    name = re.sub(r'\s+', ' ', str(value or '').strip())
    if not name:
        return ''
    return name[:80]


MAX_SAVED_DOC_LAYOUTS = 50


def _sanitize_doc_layout_library(raw):
    """Legacy snapshot validator for one-time migration from field_config."""
    if not isinstance(raw, list):
        return []

    out = []
    seen_ids = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        layout_id = str(item.get('id') or '').strip()
        name = _sanitize_doc_layout_name(item.get('name'))
        saved_at = str(item.get('saved_at') or '').strip()[:40]
        snapshot = item.get('snapshot') if isinstance(item.get('snapshot'), dict) else None
        if not re.fullmatch(r'[A-Za-z0-9_-]{6,40}', layout_id):
            continue
        if not name or not snapshot:
            continue
        if layout_id in seen_ids:
            continue
        seen_ids.add(layout_id)
        out.append({
            'id': layout_id,
            'name': name,
            'saved_at': saved_at,
            'snapshot': snapshot,
        })
        if len(out) >= 20:
            break
    return out


def _saved_doc_layout_meta(tmpl, table_id):
    docs = list(
        CardTemplateDoc.objects
        .filter(template=tmpl)
        .order_by('-updated_at', '-created_at', '-id')[:MAX_SAVED_DOC_LAYOUTS]
    )
    meta = []
    for item in docs:
        download_url = ''
        try:
            download_url = reverse(
                'cardprint:api_template_doc_layout_download',
                kwargs={'table_id': table_id, 'layout_id': item.layout_id},
            )
        except Exception:
            download_url = ''
        meta.append({
            'id': item.layout_id,
            'name': item.name,
            'saved_at': item.updated_at.isoformat() if item.updated_at else '',
            'has_doc_file': bool(item.docx_file),
            'download_url': download_url,
        })
    return meta


def _snapshot_to_docx_bytes(snapshot, name):
    """Build a real DOCX file from the current editor snapshot."""
    try:
        from docx import Document
        from docx.enum.section import WD_ORIENT
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.shared import Mm, Pt
    except Exception:
        return None, 'python-docx is not available for DOC save'

    if not isinstance(snapshot, dict):
        return None, 'Invalid snapshot payload'

    orientation = str(snapshot.get('card_orientation') or 'landscape').strip().lower()
    if orientation not in ('landscape', 'portrait'):
        orientation = 'landscape'

    page_w_mm = 87.0 if orientation == 'landscape' else 57.0
    page_h_mm = 57.0 if orientation == 'landscape' else 87.0
    page_settings = _sanitize_doc_page_settings(snapshot.get('doc_page_settings'), orientation)
    margins = page_settings.get('margins_mm') if isinstance(page_settings.get('margins_mm'), dict) else {}

    doc = Document()
    section = doc.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE if orientation == 'landscape' else WD_ORIENT.PORTRAIT
    section.page_width = Mm(page_w_mm)
    section.page_height = Mm(page_h_mm)
    section.left_margin = Mm(_clamp_float(margins.get('left'), 0.0, 25.0, 3.0))
    section.right_margin = Mm(_clamp_float(margins.get('right'), 0.0, 25.0, 3.0))
    section.top_margin = Mm(_clamp_float(margins.get('top'), 0.0, 25.0, 3.0))
    section.bottom_margin = Mm(_clamp_float(margins.get('bottom'), 0.0, 25.0, 3.0))

    doc.add_heading(str(name or 'Saved DOC'), level=1)
    doc.add_paragraph(f'Card Size: {page_w_mm:.0f}mm x {page_h_mm:.0f}mm')

    def _write_side(side_key, side_label):
        model = snapshot.get(f'editable_design_{side_key}') if isinstance(snapshot.get(f'editable_design_{side_key}'), dict) else None
        if not model:
            return

        doc.add_heading(side_label, level=2)
        lines = [x for x in (model.get('lines') or []) if isinstance(x, dict)]
        lines.sort(key=lambda x: (float(x.get('y_mm') or 0.0), float(x.get('x_mm') or 0.0)))
        for line in lines:
            txt = str(line.get('text') or '').strip()
            if not txt:
                continue
            p = doc.add_paragraph(txt)
            align = str(line.get('text_align') or 'left').strip().lower()
            if align == 'center':
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            elif align == 'right':
                p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            else:
                p.alignment = WD_ALIGN_PARAGRAPH.LEFT

            style_font_size = _clamp_float(line.get('font_size_pt'), 6.0, 72.0, 11.0)
            style_line_height = _clamp_float(line.get('line_height'), 0.8, 3.0, 1.15)
            if p.runs:
                run = p.runs[0]
                run.font.size = Pt(style_font_size)
                fam = str(line.get('font_family') or '').strip()
                if fam:
                    run.font.name = fam[:80]
                weight = str(line.get('font_weight') or '400').lower()
                run.bold = weight in ('700', '600', 'bold', 'semibold')

            try:
                p.paragraph_format.line_spacing = style_line_height
            except Exception:
                pass

        images = [x for x in (model.get('images') or []) if isinstance(x, dict)]
        for idx, image in enumerate(images[:8], start=1):
            data_url = str(image.get('data_url') or '').strip()
            if not data_url.startswith('data:image/') or ',' not in data_url:
                continue
            try:
                encoded = data_url.split(',', 1)[1]
                raw = base64.b64decode(encoded)
                width_mm = _clamp_float(image.get('w_mm'), 5.0, page_w_mm - 10.0, 25.0)
                doc.add_paragraph(f'Image {idx}')
                doc.add_picture(io.BytesIO(raw), width=Mm(width_mm))
            except Exception:
                continue

    _write_side('front', 'Front Side')
    if bool(snapshot.get('is_two_sided', False)):
        _write_side('back', 'Back Side')

    out = io.BytesIO()
    doc.save(out)
    out.seek(0)
    return out.getvalue(), None


def _migrate_legacy_doc_layouts(tmpl, user=None):
    """One-time migration: old field_config snapshots -> CardTemplateDoc rows."""
    cfg = dict(tmpl.field_config) if isinstance(tmpl.field_config, dict) else {}
    legacy = _sanitize_doc_layout_library(cfg.get('doc_layout_library') or [])
    if not legacy:
        return cfg

    existing_ids = set(
        CardTemplateDoc.objects.filter(template=tmpl).values_list('layout_id', flat=True)
    )
    changed = False

    for item in legacy:
        layout_id = str(item.get('id') or '').strip()
        if not layout_id or layout_id in existing_ids:
            continue
        snapshot = item.get('snapshot') if isinstance(item.get('snapshot'), dict) else None
        if not snapshot:
            continue

        doc_obj = CardTemplateDoc(
            template=tmpl,
            layout_id=layout_id,
            name=_sanitize_doc_layout_name(item.get('name')) or 'Saved DOC',
            snapshot=snapshot,
            created_by=user if getattr(user, 'is_authenticated', False) else None,
        )
        doc_bytes, _ = _snapshot_to_docx_bytes(snapshot, doc_obj.name)
        if doc_bytes:
            filename = f'table_{tmpl.table_id}_{layout_id}.docx'
            doc_obj.docx_file.save(filename, ContentFile(doc_bytes), save=False)
        doc_obj.save()
        existing_ids.add(layout_id)
        changed = True

    cfg.pop('doc_layout_library', None)
    if changed or 'doc_layout_library' in (tmpl.field_config or {}):
        tmpl.field_config = cfg
        tmpl.save(update_fields=['field_config', 'updated_at'])
    return cfg


def _trim_saved_doc_layouts(tmpl):
    stale = list(
        CardTemplateDoc.objects
        .filter(template=tmpl)
        .order_by('-updated_at', '-created_at', '-id')[MAX_SAVED_DOC_LAYOUTS:]
    )
    for item in stale:
        if item.docx_file:
            item.docx_file.delete(save=False)
        item.delete()


def _doc_layout_snapshot_from_template(tmpl):
    cfg = tmpl.field_config if isinstance(tmpl.field_config, dict) else {}
    mappings_raw = tmpl.field_mappings if isinstance(tmpl.field_mappings, dict) else {'front': {}, 'back': {}}
    try:
        mappings = json.loads(json.dumps(mappings_raw))
    except Exception:
        mappings = {'front': {}, 'back': {}}
    orientation = str(cfg.get('card_orientation') or 'landscape').strip().lower()
    if orientation not in ('landscape', 'portrait'):
        orientation = 'landscape'

    front_fields = _sanitize_name_list(cfg.get('front_fields') or [])
    back_fields = _sanitize_name_list(cfg.get('back_fields') or []) if tmpl.is_two_sided else []
    editable_front = _sanitize_editable_design_model(cfg.get('editable_design_front'))
    editable_back = _sanitize_editable_design_model(cfg.get('editable_design_back')) if tmpl.is_two_sided else None
    mapping_confidence = _sanitize_mapping_confidence(cfg.get('mapping_confidence'))

    raw_style = cfg.get('docx_text_style') if isinstance(cfg.get('docx_text_style'), dict) else {}
    style_align = str(raw_style.get('align') or 'left').strip().lower()
    if style_align not in ('left', 'center', 'right'):
        style_align = 'left'

    docx_style = {
        'font_family': str(raw_style.get('font_family') or tmpl.font_family or 'Arial').strip()[:80] or 'Arial',
        'font_size_pt': _clamp_float(raw_style.get('font_size_pt'), 6.0, 72.0, float(tmpl.font_size or 11)),
        'line_height': _clamp_float(raw_style.get('line_height'), 0.8, 3.0, 1.15),
        'char_spacing_pt': _clamp_float(raw_style.get('char_spacing_pt'), -5.0, 20.0, 0.0),
        'font_weight': str(raw_style.get('font_weight') or 'normal').strip().lower(),
        'font_color_hex': _normalize_hex_color(raw_style.get('font_color_hex') or '#111111'),
        'align': style_align,
    }
    if docx_style['font_weight'] not in ('normal', 'semibold', 'bold'):
        docx_style['font_weight'] = 'normal'

    return {
        'is_two_sided': bool(tmpl.is_two_sided),
        'card_orientation': orientation,
        'doc_page_settings': _sanitize_doc_page_settings(cfg.get('doc_page_settings'), orientation),
        'front_fields': front_fields,
        'back_fields': back_fields,
        'field_mappings': mappings,
        'mapping_confidence': mapping_confidence,
        'font_size': int(max(6, min(72, int(tmpl.font_size or 11)))),
        'font_family': str(tmpl.font_family or 'Arial').strip()[:50] or 'Arial',
        'docx_text_style': docx_style,
        'editable_design_front': editable_front,
        'editable_design_back': editable_back,
        'show_guides': bool(cfg.get('show_guides', True)),
    }


def _apply_doc_layout_snapshot_to_template(tmpl, snapshot):
    if not isinstance(snapshot, dict):
        return 'Invalid saved DOC snapshot'

    is_two_sided = bool(snapshot.get('is_two_sided', False))
    mappings = snapshot.get('field_mappings') if isinstance(snapshot.get('field_mappings'), dict) else {'front': {}, 'back': {}}
    mapping_err = validate_field_mappings(mappings)
    if mapping_err:
        return mapping_err

    tmpl.is_two_sided = is_two_sided
    tmpl.field_mappings = mappings

    try:
        font_size = int(snapshot.get('font_size', tmpl.font_size or 11) or 11)
    except (TypeError, ValueError):
        font_size = int(tmpl.font_size or 11)
    tmpl.font_size = max(6, min(72, font_size))

    font_family = str(snapshot.get('font_family', tmpl.font_family or 'Arial') or '').strip()
    tmpl.font_family = (font_family[:50] if font_family else (tmpl.font_family or 'Arial'))

    cfg = tmpl.field_config if isinstance(tmpl.field_config, dict) else {}
    orientation = str(snapshot.get('card_orientation') or 'landscape').strip().lower()
    if orientation not in ('landscape', 'portrait'):
        orientation = 'landscape'
    cfg['card_orientation'] = orientation
    cfg['is_two_sided'] = is_two_sided
    cfg['doc_page_settings'] = _sanitize_doc_page_settings(snapshot.get('doc_page_settings'), orientation)
    cfg['mapping_confidence'] = _sanitize_mapping_confidence(snapshot.get('mapping_confidence'))
    cfg['front_fields'] = _sanitize_name_list(snapshot.get('front_fields') or [])
    cfg['back_fields'] = _sanitize_name_list(snapshot.get('back_fields') or []) if is_two_sided else []
    cfg['show_guides'] = bool(snapshot.get('show_guides', cfg.get('show_guides', True)))

    raw_style = snapshot.get('docx_text_style') if isinstance(snapshot.get('docx_text_style'), dict) else {}
    style_weight = str(raw_style.get('font_weight') or 'normal').strip().lower()
    if style_weight not in ('normal', 'semibold', 'bold'):
        style_weight = 'normal'
    style_align = str(raw_style.get('align') or 'left').strip().lower()
    if style_align not in ('left', 'center', 'right'):
        style_align = 'left'

    cfg['docx_text_style'] = {
        'font_family': str(raw_style.get('font_family') or tmpl.font_family or 'Arial').strip()[:80] or 'Arial',
        'font_size_pt': _clamp_float(raw_style.get('font_size_pt'), 6.0, 72.0, float(tmpl.font_size or 11)),
        'line_height': _clamp_float(raw_style.get('line_height'), 0.8, 3.0, 1.15),
        'char_spacing_pt': _clamp_float(raw_style.get('char_spacing_pt'), -5.0, 20.0, 0.0),
        'font_weight': style_weight,
        'font_color_hex': _normalize_hex_color(raw_style.get('font_color_hex') or '#111111'),
        'align': style_align,
    }

    editable_front = _sanitize_editable_design_model(snapshot.get('editable_design_front'))
    editable_back = _sanitize_editable_design_model(snapshot.get('editable_design_back')) if is_two_sided else None
    if editable_front:
        cfg['editable_design_front'] = editable_front
    else:
        cfg.pop('editable_design_front', None)
    if editable_back:
        cfg['editable_design_back'] = editable_back
    else:
        cfg.pop('editable_design_back', None)

    tmpl.field_config = cfg
    return None


def _template_payload(tmpl):
    field_config = _migrate_legacy_doc_layouts(tmpl)
    card_orientation = field_config.get('card_orientation') or 'landscape'
    if card_orientation not in ('landscape', 'portrait'):
        card_orientation = 'landscape'
    front_pdf_url = _safe_template_pdf_url(tmpl.front_pdf)
    back_pdf_url = _safe_template_pdf_url(tmpl.back_pdf)
    raw_docx_style = field_config.get('docx_text_style') if isinstance(field_config.get('docx_text_style'), dict) else {}
    try:
        style_font_size = float(raw_docx_style.get('font_size_pt') or tmpl.font_size or 11)
    except (TypeError, ValueError):
        style_font_size = float(tmpl.font_size or 11)
    try:
        style_line_height = float(raw_docx_style.get('line_height') or 1.15)
    except (TypeError, ValueError):
        style_line_height = 1.15
    try:
        style_char_spacing = float(raw_docx_style.get('char_spacing_pt') or 0.0)
    except (TypeError, ValueError):
        style_char_spacing = 0.0
    style_weight = str(raw_docx_style.get('font_weight') or 'normal').strip().lower()
    if style_weight not in ('normal', 'semibold', 'bold'):
        style_weight = 'normal'
    style_align = str(raw_docx_style.get('align') or 'left').strip().lower()
    if style_align not in ('left', 'center', 'right'):
        style_align = 'left'
    style_color = _normalize_hex_color(raw_docx_style.get('font_color_hex') or '#111111')
    docx_style = {
        'font_family': str(raw_docx_style.get('font_family') or tmpl.font_family or 'Arial').strip()[:80] or 'Arial',
        'font_size_pt': max(6.0, min(72.0, style_font_size)),
        'line_height': max(0.8, min(3.0, style_line_height)),
        'char_spacing_pt': max(-5.0, min(20.0, style_char_spacing)),
        'font_weight': style_weight,
        'font_color_hex': style_color,
        'text_align': style_align,
    }
    front_fields = field_config.get('front_fields') or []
    back_fields = field_config.get('back_fields') or []
    editable_design_front = _sanitize_editable_design_model(field_config.get('editable_design_front'))
    editable_design_back = _sanitize_editable_design_model(field_config.get('editable_design_back'))
    mapping_confidence = _sanitize_mapping_confidence(field_config.get('mapping_confidence'))
    doc_layout_meta = _saved_doc_layout_meta(tmpl, tmpl.table_id)
    active_doc_layout_id = str(field_config.get('active_doc_layout_id') or '').strip()
    if not any(item['id'] == active_doc_layout_id for item in doc_layout_meta):
        active_doc_layout_id = ''

    return {
        'is_two_sided': tmpl.is_two_sided,
        'field_mappings': tmpl.field_mappings or {'front': {}, 'back': {}},
        'mapping_confidence': mapping_confidence,
        'font_size': tmpl.font_size,
        'font_family': tmpl.font_family,
        'docx_style': docx_style,
        'card_orientation': card_orientation,
        'has_front_pdf': bool(front_pdf_url),
        'has_back_pdf': bool(back_pdf_url),
        'front_pdf_url': front_pdf_url,
        'back_pdf_url': back_pdf_url,
        'front_fields': front_fields,
        'back_fields': back_fields,
        'editable_design_front': editable_design_front,
        'editable_design_back': editable_design_back,
        'show_guides': bool(field_config.get('show_guides', True)),
        'doc_page_settings': _sanitize_doc_page_settings(field_config.get('doc_page_settings'), card_orientation),
        'doc_layout_library': doc_layout_meta,
        'active_doc_layout_id': active_doc_layout_id,
    }


# ---------------------------------------------------------------------------
# PAGE VIEW
# ---------------------------------------------------------------------------

@login_required
@require_any_admin
def print_cards(request, table_id):
    """Print Cards workflow page with tabs: Generate List | Finalized."""
    table = get_object_or_404(
        IDCardTable.objects.select_related('group__client'), id=table_id,
    )
    user = request.user
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('active_clients')

    _promote_legacy_print_list(table)

    current_step = request.GET.get('step', 'generate_list')
    if current_step not in ('generate_list', 'finalized'):
        current_step = 'generate_list'

    # Step counts for tabs
    counts = PrintRequest.objects.filter(table=table).aggregate(
        fn=Count('id', filter=Q(status='finalized')),
        gl=Count('id', filter=Q(status='generate_list')),
    )
    step_counts = {
        'finalized': counts['fn'],
        'generate_list': counts['gl'],
    }
    approved_count = IDCard.objects.filter(table=table, status='approved').count()

    # Items for the current step
    generate_items = []
    finalized_items = []
    generate_total = 0
    finalized_total = 0

    # Existing field configuration drives which columns are shown in Generate List.
    template_obj = CardTemplate.objects.filter(table=table).first()
    selected_generate_field_names = _get_selected_generate_field_names(table, template_obj)

    if current_step == 'generate_list':
        base_qs = PrintRequest.objects.filter(table=table, status='generate_list')
        generate_total = base_qs.count()
        pr_qs = base_qs.select_related('card', 'requested_by').order_by('-updated_at')[:200]
        for idx, pr in enumerate(pr_qs):
            card = pr.card
            fd = card.field_data or {}
            fd_upper = {k.upper(): v for k, v in fd.items()}
            ordered_fields = _build_ordered_fields(table, fd, fd_upper)
            ordered_fields = _filter_ordered_fields_by_names(ordered_fields, selected_generate_field_names)
            req_by = pr.requested_by
            generate_items.append({
                'pr_id': pr.id,
                'card_id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'status_display': card.get_status_display(),
                'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
                'moved_at': localtime(pr.updated_at).strftime('%d %b %Y %H:%M'),
                'ordered_fields': ordered_fields,
            })

    elif current_step == 'finalized':
        base_qs = PrintRequest.objects.filter(table=table, status='finalized')
        finalized_total = base_qs.count()
        pr_qs = base_qs.select_related('card', 'requested_by').order_by('-updated_at')[:200]
        for idx, pr in enumerate(pr_qs):
            card = pr.card
            fd = card.field_data or {}
            fd_upper = {k.upper(): v for k, v in fd.items()}
            ordered_fields = _build_ordered_fields(table, fd, fd_upper)
            req_by = pr.requested_by
            finalized_items.append({
                'pr_id': pr.id,
                'card_id': card.id,
                'sr_no': idx + 1,
                'status': card.status,
                'status_display': card.get_status_display(),
                'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
                'finalized_at': localtime(pr.updated_at).strftime('%d %b %Y %H:%M'),
                'ordered_fields': ordered_fields,
            })

    # Generate-card editor data (for inline modal)
    template_data = _template_payload(template_obj) if template_obj else {
        'is_two_sided': False,
        'field_mappings': {'front': {}, 'back': {}},
        'font_size': 11,
        'font_family': 'Arial',
        'docx_style': {
            'font_family': 'Arial',
            'font_size_pt': 11,
            'line_height': 1.15,
            'char_spacing_pt': 0,
            'font_weight': 'normal',
            'font_color_hex': '#111111',
        },
        'card_orientation': 'landscape',
        'has_front_pdf': False,
        'has_back_pdf': False,
        'front_pdf_url': '',
        'back_pdf_url': '',
        'front_fields': [],
        'back_fields': [],
        'editable_design_front': None,
        'editable_design_back': None,
        'doc_page_settings': _sanitize_doc_page_settings({}, 'landscape'),
    }
    front_pdf_url = template_data.get('front_pdf_url') or ''
    back_pdf_url = template_data.get('back_pdf_url') or ''
    field_config = _editor_field_config_payload(template_obj.field_config if template_obj else {})

    import json as _json
    context = {
        'active_page': 'active_clients',
        'user_role': get_user_role(user),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'current_step': current_step,
        'step_counts': step_counts,
        'approved_count': approved_count,
        'generate_items': generate_items,
        'finalized_items': finalized_items,
        'generate_total': generate_total,
        'generate_has_more': generate_total > len(generate_items),
        'generate_display_fields': [
            f for f in (table.fields or [])
            if f.get('name') in set(selected_generate_field_names)
        ],
        'finalized_total': finalized_total,
        'finalized_has_more': finalized_total > len(finalized_items),
        'table_fields_json': _json.dumps(table.fields if table.fields else []),
        'field_config_json': _json.dumps(field_config),
        'has_template_front_pdf': bool(front_pdf_url),
        'has_template_back_pdf': bool(back_pdf_url),
        'template_data_json': _json.dumps(template_data),
        'front_pdf_url': front_pdf_url,
        'back_pdf_url': back_pdf_url,
    }
    return render(request, 'cardprint/print-cards.html', context)


# ---------------------------------------------------------------------------
# API VIEWS
# ---------------------------------------------------------------------------

@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_print_send(request, table_id):
    """Send approved cards to generate list.

    Body: { "card_ids": [1, 2, 3] }
    Only cards in 'approved' status are accepted.
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    _promote_legacy_print_list(table)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    card_ids = data.get('card_ids', [])
    if not card_ids:
        return JsonResponse({'status': 'error', 'message': 'No cards selected'}, status=400)

    # Only allow cards in 'approved' status
    valid_ids = list(
        IDCard.objects.filter(
            id__in=card_ids, table=table, status='approved',
        ).values_list('id', flat=True)
    )
    if not valid_ids:
        return JsonResponse(
            {'status': 'error', 'message': 'No approved cards found in selection'},
            status=400,
        )

    result = PrintWorkflowService.create_requests(table, valid_ids, request.user)

    if not result.success:
        return JsonResponse({'status': 'error', 'message': result.message}, status=400)

    # Move approved cards → download status so they leave the approve list
    if result.data['created'] > 0:
        IDCard.objects.filter(
            id__in=valid_ids,
            table=table,
            status='approved',
        ).update(status='download')
        for card_id in valid_ids:
            ActivityService.log(
                'card_status',
                'Card moved from Approved to Download (sent to generate list)',
                user=request.user,
                target_model='IDCard',
                target_id=card_id,
                target_name=f'Card #{card_id}',
            )

    return JsonResponse({
        'status': 'ok',
        'message': f"{result.data['created']} card(s) added to generate list"
                   + (f" ({result.data['skipped']} already in list)" if result.data['skipped'] else ''),
        'created': result.data['created'],
        'skipped': result.data['skipped'],
    })


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_print_step_counts(request, table_id):
    """Return step counts for the generate/finalized workflow tabs."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    _promote_legacy_print_list(table)

    counts = PrintRequest.objects.filter(table=table).aggregate(
        gl=Count('id', filter=Q(status='generate_list')),
        fn=Count('id', filter=Q(status='finalized')),
        po=Count('id', filter=Q(status='pool')),
    )
    approved_count = IDCard.objects.filter(table=table, status='approved').count()
    return JsonResponse({
        'status': 'ok',
        'generate_list': counts['gl'],
        'finalized': counts['fn'],
        'pool': counts['po'],
        'approved': approved_count,
    })


# ---------------------------------------------------------------------------
# 2-STEP API VIEWS: Generate, Finalized List, Mark Pool, Pool List
# ---------------------------------------------------------------------------


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_print_generate_list(request, table_id):
    """List generate_list items with pagination and search."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    _promote_legacy_print_list(table)

    query = request.GET.get('q', '').strip()
    from_dt = _parse_local_datetime_filter(request.GET.get('from'))
    to_dt = _parse_local_datetime_filter(request.GET.get('to'))
    offset, limit = _parse_offset_limit(request, default_limit=100, max_limit=200)

    pr_qs = PrintRequest.objects.filter(
        table=table, status='generate_list',
    ).select_related('card', 'requested_by').order_by('-updated_at')

    selected_generate_field_names = _get_selected_generate_field_names(table)

    if query:
        pr_qs = IDCardService._apply_search_filter(
            pr_qs,
            query,
            table=table,
            json_field='card__field_data',
            id_lookup='card__id',
        )

    if from_dt:
        pr_qs = pr_qs.filter(updated_at__gte=from_dt)
    if to_dt:
        pr_qs = pr_qs.filter(updated_at__lte=to_dt)

    total = pr_qs.count()
    batch = list(pr_qs[offset:offset + limit + 1])
    has_more = len(batch) > limit
    if has_more:
        batch = batch[:limit]

    items = []
    for idx, pr in enumerate(batch):
        card = pr.card
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}
        ordered_fields = _build_ordered_fields(table, fd, fd_upper)
        ordered_fields = _filter_ordered_fields_by_names(ordered_fields, selected_generate_field_names)
        req_by = pr.requested_by
        items.append({
            'pr_id': pr.id,
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
            'moved_at': localtime(pr.updated_at).strftime('%d %b %Y %H:%M'),
            'ordered_fields': ordered_fields,
        })

    return JsonResponse({
        'status': 'ok',
        'items': items,
        'total': total,
        'has_more': has_more,
        'offset': offset,
        'limit': limit,
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_field_config_save(request, table_id):
    """Save field_config (selected fields per side) for a table's CardTemplate.

    Body: {
        "is_two_sided": true/false,
        "front_fields": ["Name", "Photo", ...],
        "back_fields": ["Father Name", ...]
    }
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    is_two_sided = bool(data.get('is_two_sided', False))
    front_fields = data.get('front_fields', [])
    back_fields = data.get('back_fields', []) if is_two_sided else []

    if not front_fields:
        return JsonResponse({'status': 'error', 'message': 'Select at least one front field'}, status=400)

    # Validate field names against table fields
    valid_names = {f['name'] for f in (table.fields or [])}
    for fname in front_fields + back_fields:
        if fname not in valid_names:
            return JsonResponse({'status': 'error', 'message': f'Invalid field: {fname}'}, status=400)

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    existing_cfg = tmpl.field_config if isinstance(tmpl.field_config, dict) else {}
    card_orientation = existing_cfg.get('card_orientation') or 'landscape'
    if card_orientation not in ('landscape', 'portrait'):
        card_orientation = 'landscape'
    tmpl.field_config = {
        'is_two_sided': is_two_sided,
        'front_fields': front_fields,
        'back_fields': back_fields,
        'card_orientation': card_orientation,
    }
    tmpl.is_two_sided = is_two_sided
    tmpl.save()

    return JsonResponse({'status': 'ok', 'message': 'Field configuration saved'})


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_finalized_list')
def api_print_finalized_list(request, table_id):
    """List finalized print items with pagination and search."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    from_dt = _parse_local_datetime_filter(request.GET.get('from'))
    to_dt = _parse_local_datetime_filter(request.GET.get('to'))
    offset, limit = _parse_offset_limit(request, default_limit=100, max_limit=200)

    pr_qs = PrintRequest.objects.filter(
        table=table, status='finalized',
    ).select_related('card', 'requested_by').order_by('-updated_at')

    if query:
        pr_qs = IDCardService._apply_search_filter(
            pr_qs,
            query,
            table=table,
            json_field='card__field_data',
            id_lookup='card__id',
        )

    if from_dt:
        pr_qs = pr_qs.filter(updated_at__gte=from_dt)
    if to_dt:
        pr_qs = pr_qs.filter(updated_at__lte=to_dt)

    total = pr_qs.count()
    batch = list(pr_qs[offset:offset + limit + 1])
    has_more = len(batch) > limit
    if has_more:
        batch = batch[:limit]

    items = []
    for idx, pr in enumerate(batch):
        card = pr.card
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}
        ordered_fields = _build_ordered_fields(table, fd, fd_upper)
        req_by = pr.requested_by
        items.append({
            'pr_id': pr.id,
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
            'finalized_at': localtime(pr.updated_at).strftime('%d %b %Y %H:%M'),
            'ordered_fields': ordered_fields,
        })

    return JsonResponse({
        'status': 'ok',
        'items': items,
        'total': total,
        'has_more': has_more,
        'offset': offset,
        'limit': limit,
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_finalized_list')
def api_print_mark_pool(request, table_id):
    """Move finalized items to pool.

    Body: { "request_ids": [1, 2, 3] }
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    request_ids = data.get('request_ids', [])
    if not request_ids:
        return JsonResponse({'status': 'error', 'message': 'No items selected'}, status=400)

    valid_ids = list(
        PrintRequest.objects.filter(
            id__in=request_ids, table=table, status='finalized',
        ).values_list('id', flat=True)
    )
    if not valid_ids:
        return JsonResponse(
            {'status': 'error', 'message': 'No valid finalized items found'},
            status=400,
        )

    result = PrintWorkflowService.bulk_mark_pool(valid_ids, request.user)
    if not result.success:
        return JsonResponse({'status': 'error', 'message': result.message}, status=400)
    return JsonResponse({
        'status': 'ok',
        'message': f"{result.data['updated']} item(s) moved to pool",
        'updated': result.data['updated'],
        'skipped': result.data['skipped'],
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_print_retrieve_generate(request, table_id):
    """Move generate-list items back to approved list.

    Body: { "request_ids": [1, 2, 3] }
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    request_ids = data.get('request_ids', [])
    if not request_ids:
        return JsonResponse({'status': 'error', 'message': 'No items selected'}, status=400)

    prs = list(
        PrintRequest.objects.filter(
            id__in=request_ids,
            table=table,
            status='generate_list',
        ).values('id', 'card_id')
    )
    if not prs:
        return JsonResponse({'status': 'error', 'message': 'No valid generate-list items found'}, status=400)

    valid_request_ids = [row['id'] for row in prs]
    card_ids = [row['card_id'] for row in prs]

    with transaction.atomic():
        # Move cards back to approved list.
        IDCard.objects.filter(
            id__in=card_ids,
            table=table,
        ).update(status='approved')

        # Remove from active print workflow.
        updated = PrintRequest.objects.filter(
            id__in=valid_request_ids,
            table=table,
            status='generate_list',
        ).update(status='pool', updated_at=timezone.now())

    for card_id in card_ids:
        ActivityService.log(
            'card_status',
            'Card moved from Generate List to Approved',
            user=request.user,
            target_model='IDCard',
            target_id=card_id,
            target_name=f'Card #{card_id}',
        )

    return JsonResponse({
        'status': 'ok',
        'message': f'{updated} item(s) moved back to approved list',
        'updated': updated,
        'skipped': len(request_ids) - updated,
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_finalized_list')
def api_print_retrieve_finalized(request, table_id):
    """Move finalized items back to pending list.

    Body: { "request_ids": [1, 2, 3] }
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    request_ids = data.get('request_ids', [])
    if not request_ids:
        return JsonResponse({'status': 'error', 'message': 'No items selected'}, status=400)

    prs = list(
        PrintRequest.objects.filter(
            id__in=request_ids,
            table=table,
            status='finalized',
        ).values('id', 'card_id')
    )
    if not prs:
        return JsonResponse({'status': 'error', 'message': 'No valid finalized items found'}, status=400)

    valid_request_ids = [row['id'] for row in prs]
    card_ids = [row['card_id'] for row in prs]

    with transaction.atomic():
        # Move cards back to pending list.
        IDCard.objects.filter(
            id__in=card_ids,
            table=table,
        ).update(status='pending')

        # Remove from active print workflow.
        updated = PrintRequest.objects.filter(
            id__in=valid_request_ids,
            table=table,
            status='finalized',
        ).update(status='pool', updated_at=timezone.now())

    for card_id in card_ids:
        ActivityService.log(
            'card_status',
            'Card moved from Finalized to Pending',
            user=request.user,
            target_model='IDCard',
            target_id=card_id,
            target_name=f'Card #{card_id}',
        )

    return JsonResponse({
        'status': 'ok',
        'message': f'{updated} item(s) moved back to pending list',
        'updated': updated,
        'skipped': len(request_ids) - updated,
    })


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_print_pool_list(request, table_id):
    """List pool items with pagination and search."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    offset, limit = _parse_offset_limit(request, default_limit=100, max_limit=200)

    pr_qs = PrintRequest.objects.filter(
        table=table, status='pool',
    ).select_related('card', 'requested_by').order_by('-updated_at')

    if query:
        pr_qs = IDCardService._apply_search_filter(
            pr_qs,
            query,
            table=table,
            json_field='card__field_data',
            id_lookup='card__id',
        )

    total = pr_qs.count()
    batch = list(pr_qs[offset:offset + limit + 1])
    has_more = len(batch) > limit
    if has_more:
        batch = batch[:limit]

    items = []
    for idx, pr in enumerate(batch):
        card = pr.card
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}
        ordered_fields = _build_ordered_fields(table, fd, fd_upper)
        req_by = pr.requested_by
        items.append({
            'pr_id': pr.id,
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'status': card.status,
            'status_display': card.get_status_display(),
            'requested_by_name': req_by.get_full_name() or req_by.username if req_by else 'System',
            'pool_at': localtime(pr.updated_at).strftime('%d %b %Y %H:%M'),
            'ordered_fields': ordered_fields,
        })

    return JsonResponse({
        'status': 'ok',
        'items': items,
        'total': total,
        'has_more': has_more,
        'offset': offset,
        'limit': limit,
    })

# ===========================================================================
# GENERATE CARD � PAGE VIEWS
# ===========================================================================
@login_required
@require_any_admin
def generate_card(request, table_id):
    """Generate Card editor for a specific table."""
    table = get_object_or_404(
        IDCardTable.objects.select_related('group__client'), id=table_id,
    )
    user = request.user
    if not PermissionService.can_access_client(user, table.group.client_id):
        return redirect('active_clients')

    template_obj, _ = CardTemplate.objects.get_or_create(table=table)
    generate_count = PrintRequest.objects.filter(table=table, status='generate_list').count()
    field_config = _editor_field_config_payload(template_obj.field_config or {})

    import json as _json
    template_data = _template_payload(template_obj)

    table_fields = table.fields if hasattr(table, 'fields') and table.fields else []
    context = {
        'active_page': 'active_clients',
        'user_role': get_user_role(user),
        'table': table,
        'group': table.group,
        'client': table.group.client,
        'template': template_obj,
        'template_data_json': _json.dumps(template_data),
        'table_fields_json': _json.dumps(table_fields),
        'field_config_json': _json.dumps(field_config),
        'front_pdf_url': _safe_template_pdf_url(template_obj.front_pdf),
        'back_pdf_url': _safe_template_pdf_url(template_obj.back_pdf),
        'generate_count': generate_count,
    }
    return render(request, 'cardprint/generate-card.html', context)


# ===========================================================================
# GENERATE CARD � API ENDPOINTS
# ===========================================================================

@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_template_get(request, table_id):
    """Return the current template settings for a table."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    return JsonResponse({'status': 'ok', 'template': _template_payload(tmpl)})


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_template_save(request, table_id):
    """Save table template settings for PDF generation."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    tmpl.is_two_sided = bool(data.get('is_two_sided', False))

    raw_mappings = data.get('field_mappings')
    if raw_mappings is not None:
        mapping_err = validate_field_mappings(raw_mappings)
        if mapping_err:
            return JsonResponse({'status': 'error', 'message': mapping_err}, status=400)
        tmpl.field_mappings = raw_mappings

    try:
        font_size = int(data.get('font_size', tmpl.font_size or 11) or 11)
    except (TypeError, ValueError):
        font_size = int(tmpl.font_size or 11)
    tmpl.font_size = max(6, min(72, font_size))

    font_family = str(data.get('font_family', tmpl.font_family or 'Arial') or '').strip()
    tmpl.font_family = (font_family[:50] if font_family else (tmpl.font_family or 'Arial'))

    card_orientation = data.get('card_orientation', 'landscape')
    if card_orientation not in ('landscape', 'portrait'):
        card_orientation = 'landscape'

    cfg = tmpl.field_config if isinstance(tmpl.field_config, dict) else {}
    front_fields = _sanitize_name_list(data.get('front_fields', cfg.get('front_fields') or []))
    back_fields = _sanitize_name_list(data.get('back_fields', cfg.get('back_fields') or [])) if tmpl.is_two_sided else []
    cfg['front_fields'] = front_fields
    cfg['back_fields'] = back_fields
    cfg['card_orientation'] = card_orientation
    cfg['is_two_sided'] = tmpl.is_two_sided
    cfg['show_guides'] = bool(data.get('show_guides', cfg.get('show_guides', True)))
    cfg['mapping_confidence'] = _sanitize_mapping_confidence(
        data.get('mapping_confidence', cfg.get('mapping_confidence'))
    )
    cfg['doc_page_settings'] = _sanitize_doc_page_settings(
        data.get('doc_page_settings', cfg.get('doc_page_settings')),
        card_orientation,
    )

    try:
        style_font_size = float(data.get('docx_font_size_pt', tmpl.font_size or 11) or 11)
    except (TypeError, ValueError):
        style_font_size = float(tmpl.font_size or 11)
    style_font_size = max(6.0, min(72.0, style_font_size))

    try:
        line_height = float(data.get('docx_line_height', 1.15) or 1.15)
    except (TypeError, ValueError):
        line_height = 1.15
    line_height = max(0.8, min(3.0, line_height))

    try:
        char_spacing = float(data.get('docx_char_spacing_pt', 0.0) or 0.0)
    except (TypeError, ValueError):
        char_spacing = 0.0
    char_spacing = max(-5.0, min(20.0, char_spacing))

    style_family = str(data.get('docx_font_family', tmpl.font_family or 'Arial') or '').strip()[:80]
    if not style_family:
        style_family = 'Arial'
    style_weight = str(data.get('docx_font_weight', 'normal') or 'normal').strip().lower()
    if style_weight not in ('normal', 'semibold', 'bold'):
        style_weight = 'normal'
    style_align = str(data.get('docx_text_align', 'left') or 'left').strip().lower()
    if style_align not in ('left', 'center', 'right'):
        style_align = 'left'
    style_color = _normalize_hex_color(data.get('docx_font_color_hex', '#111111'))

    cfg['docx_text_style'] = {
        'font_family': style_family,
        'font_size_pt': style_font_size,
        'line_height': line_height,
        'char_spacing_pt': char_spacing,
        'font_weight': style_weight,
        'font_color_hex': style_color,
        'align': style_align,
    }

    if 'editable_design_front' in data:
        editable_front = _sanitize_editable_design_model(data.get('editable_design_front'))
        if editable_front:
            cfg['editable_design_front'] = editable_front
        else:
            cfg.pop('editable_design_front', None)

    if 'editable_design_back' in data:
        editable_back = _sanitize_editable_design_model(data.get('editable_design_back'))
        if editable_back and tmpl.is_two_sided:
            cfg['editable_design_back'] = editable_back
        else:
            cfg.pop('editable_design_back', None)

    if not tmpl.is_two_sided:
        cfg.pop('editable_design_back', None)

    tmpl.field_config = cfg

    tmpl.save()
    return JsonResponse({'status': 'ok', 'message': 'Template settings saved', 'template': _template_payload(tmpl)})


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_template_doc_layout_save(request, table_id):
    """Save current editor state as a named DOC with persisted DOCX file."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    name = _sanitize_doc_layout_name((data or {}).get('name'))
    if not name:
        return JsonResponse({'status': 'error', 'message': 'Please enter a DOC name'}, status=400)

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    cfg = _migrate_legacy_doc_layouts(tmpl, request.user)
    snapshot = _doc_layout_snapshot_from_template(tmpl)

    try:
        snapshot_size = len(json.dumps(snapshot))
    except Exception:
        snapshot_size = 0
    if snapshot_size > 2_500_000:
        return JsonResponse(
            {'status': 'error', 'message': 'DOC snapshot is too large. Reduce embedded images and try again.'},
            status=400,
        )

    layout_id = uuid.uuid4().hex[:12]
    doc_bytes, doc_err = _snapshot_to_docx_bytes(snapshot, name)
    if doc_err:
        return JsonResponse({'status': 'error', 'message': doc_err}, status=500)

    doc_obj = CardTemplateDoc(
        template=tmpl,
        layout_id=layout_id,
        name=name,
        snapshot=snapshot,
        created_by=request.user,
    )
    filename = f'table_{table.id}_{layout_id}.docx'
    doc_obj.docx_file.save(filename, ContentFile(doc_bytes), save=False)
    doc_obj.save()

    cfg.pop('doc_layout_library', None)
    cfg['active_doc_layout_id'] = layout_id
    tmpl.field_config = cfg
    tmpl.save(update_fields=['field_config', 'updated_at'])
    _trim_saved_doc_layouts(tmpl)

    return JsonResponse({'status': 'ok', 'message': 'DOC saved', 'template': _template_payload(tmpl)})


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_template_doc_layout_list(request, table_id):
    """Return persisted saved DOC list for the current table template."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    cfg = _migrate_legacy_doc_layouts(tmpl, request.user)
    docs = _saved_doc_layout_meta(tmpl, table.id)
    active_doc_layout_id = str(cfg.get('active_doc_layout_id') or '').strip()
    if not any(item['id'] == active_doc_layout_id for item in docs):
        active_doc_layout_id = ''

    return JsonResponse({'status': 'ok', 'docs': docs, 'active_doc_layout_id': active_doc_layout_id})


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_template_doc_layout_apply(request, table_id, layout_id):
    """Apply a previously saved DOC snapshot to the current template."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    cfg = _migrate_legacy_doc_layouts(tmpl, request.user)
    selected = CardTemplateDoc.objects.filter(template=tmpl, layout_id=str(layout_id or '').strip()).first()
    if not selected:
        return JsonResponse({'status': 'error', 'message': 'Saved DOC not found'}, status=404)

    snapshot = selected.snapshot if isinstance(selected.snapshot, dict) else None
    apply_err = _apply_doc_layout_snapshot_to_template(tmpl, snapshot)
    if apply_err:
        return JsonResponse({'status': 'error', 'message': apply_err}, status=400)

    updated_cfg = dict(tmpl.field_config) if isinstance(tmpl.field_config, dict) else {}
    updated_cfg.pop('doc_layout_library', None)
    updated_cfg['active_doc_layout_id'] = selected.layout_id
    tmpl.field_config = updated_cfg
    tmpl.save()
    selected.save(update_fields=['updated_at'])

    return JsonResponse({'status': 'ok', 'message': 'DOC loaded', 'template': _template_payload(tmpl)})


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_template_doc_layout_download(request, table_id, layout_id):
    """Download a saved DOCX file for a previously saved editor DOC layout."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    _migrate_legacy_doc_layouts(tmpl, request.user)

    selected = CardTemplateDoc.objects.filter(template=tmpl, layout_id=str(layout_id or '').strip()).first()
    if not selected:
        return JsonResponse({'status': 'error', 'message': 'Saved DOC not found'}, status=404)

    name = re.sub(r'[^A-Za-z0-9_-]+', '_', str(selected.name or 'saved_doc')).strip('_') or 'saved_doc'
    filename = f'{name}.docx'

    file_missing = not selected.docx_file or not selected.docx_file.name
    if not file_missing:
        try:
            file_missing = not selected.docx_file.storage.exists(selected.docx_file.name)
        except Exception:
            file_missing = True

    if file_missing:
        snapshot = selected.snapshot if isinstance(selected.snapshot, dict) else None
        if not snapshot:
            return JsonResponse({'status': 'error', 'message': 'Saved DOC file is unavailable'}, status=404)
        doc_bytes, doc_err = _snapshot_to_docx_bytes(snapshot, selected.name)
        if doc_err:
            return JsonResponse({'status': 'error', 'message': doc_err}, status=500)
        regen_name = f'table_{table.id}_{selected.layout_id}.docx'
        selected.docx_file.save(regen_name, ContentFile(doc_bytes), save=False)
        selected.save(update_fields=['docx_file', 'updated_at'])

    return FileResponse(selected.docx_file.open('rb'), as_attachment=True, filename=filename)


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_template_upload_pdf(request, table_id, side):
    """Upload front or back design PDF file."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    if side not in ('front', 'back'):
        return JsonResponse({'status': 'error', 'message': 'Invalid side'}, status=400)

    template_file = request.FILES.get('pdf') or request.FILES.get('template')
    if not template_file:
        return JsonResponse({'status': 'error', 'message': 'No file uploaded'}, status=400)

    if not template_file.name.lower().endswith('.pdf'):
        return JsonResponse({'status': 'error', 'message': 'File must be a design PDF (.pdf)'}, status=400)

    if template_file.size > 20 * 1024 * 1024:
        return JsonResponse({'status': 'error', 'message': 'File too large (max 20 MB)'}, status=400)

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    cfg = dict(tmpl.field_config) if isinstance(tmpl.field_config, dict) else {}
    if side == 'front':
        if tmpl.front_pdf:
            tmpl.front_pdf.delete(save=False)
        tmpl.front_pdf = template_file
        cfg.pop('editable_design_front', None)
    else:
        if tmpl.back_pdf:
            tmpl.back_pdf.delete(save=False)
        tmpl.back_pdf = template_file
        cfg.pop('editable_design_back', None)
    tmpl.field_config = cfg
    tmpl.save()

    template_url = (tmpl.front_pdf.url if side == 'front' else tmpl.back_pdf.url)
    return JsonResponse({'status': 'ok', 'message': 'Design PDF uploaded', 'pdf_url': template_url})


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_template_clear_pdf(request, table_id, side):
    """Clear saved front/back design PDF template."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    if side not in ('front', 'back'):
        return JsonResponse({'status': 'error', 'message': 'Invalid side'}, status=400)

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    cfg = dict(tmpl.field_config) if isinstance(tmpl.field_config, dict) else {}
    mappings = dict(tmpl.field_mappings) if isinstance(tmpl.field_mappings, dict) else {}
    confidence = _sanitize_mapping_confidence(cfg.get('mapping_confidence'))

    if side == 'front':
        if tmpl.front_pdf:
            tmpl.front_pdf.delete(save=False)
        tmpl.front_pdf = None
        cfg.pop('editable_design_front', None)
    else:
        if tmpl.back_pdf:
            tmpl.back_pdf.delete(save=False)
        tmpl.back_pdf = None
        cfg.pop('editable_design_back', None)

    if isinstance(mappings.get(side), dict):
        mappings[side] = {}
    else:
        mappings.pop(side, None)

    confidence[side] = {}

    cfg['mapping_confidence'] = confidence
    tmpl.field_config = cfg
    tmpl.field_mappings = mappings
    tmpl.save(update_fields=['front_pdf', 'back_pdf', 'field_config', 'field_mappings', 'updated_at'])
    return JsonResponse({'status': 'ok', 'message': f'{side.capitalize()} design PDF cleared', 'template': _template_payload(tmpl)})


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_template_analyze_pdf(request, table_id, side):
    """Analyze front/back design PDF and return detected mappings + style hints."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    if side not in ('front', 'back'):
        return JsonResponse({'status': 'error', 'message': 'Invalid side'}, status=400)

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    source_pdf = tmpl.back_pdf if side == 'back' else tmpl.front_pdf
    if not source_pdf:
        return JsonResponse({'status': 'error', 'message': f'Upload {side} design PDF first'}, status=400)

    try:
        payload = json.loads(request.body or '{}')
    except (json.JSONDecodeError, ValueError):
        payload = {}

    exclude_fields = payload.get('exclude_fields') or []
    if not isinstance(exclude_fields, list):
        exclude_fields = []
    exclude_fields = [str(x).strip() for x in exclude_fields if str(x).strip()]

    all_fields = table.fields if isinstance(table.fields, list) else []
    cfg = tmpl.field_config if isinstance(tmpl.field_config, dict) else {}
    selected_names = cfg.get('back_fields' if side == 'back' else 'front_fields') or []
    if selected_names:
        selected_set = set(str(x).strip() for x in selected_names if str(x).strip())
        target_fields = [f for f in all_fields if str((f or {}).get('name', '')).strip() in selected_set]
    else:
        target_fields = all_fields

    card_w_mm, card_h_mm = GenerateCardService._resolve_dimensions_mm(tmpl)
    result, detect_err = PdfTemplateAnalyzerService.analyze_template(
        tmpl,
        side,
        target_fields,
        card_w_mm,
        card_h_mm,
        exclude_fields=exclude_fields,
    )
    if detect_err:
        return JsonResponse({'status': 'error', 'message': detect_err}, status=500)

    return JsonResponse({'status': 'ok', **(result or {})})


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
def api_template_convert_inline(request, table_id, side):
    side = (side or '').strip().lower()
    if side not in {'front', 'back'}:
        return JsonResponse({'status': 'error', 'message': 'Invalid side'}, status=400)

    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    try:
        payload = json.loads(request.body or '{}')
    except (json.JSONDecodeError, ValueError, TypeError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    orientation = (payload.get('card_orientation') or '').strip().lower()
    if orientation not in {'landscape', 'portrait'}:
        orientation = (tmpl.field_config or {}).get('card_orientation') or 'landscape'
    card_w_mm, card_h_mm = GenerateCardService.dimensions_for_orientation_mm(orientation)

    model, model_err = PdfTemplateAnalyzerService.build_editable_design_model(
        tmpl,
        side,
        card_w_mm,
        card_h_mm,
    )
    if model_err:
        return JsonResponse({'status': 'error', 'message': model_err}, status=400)

    return JsonResponse({
        'status': 'ok',
        'side': side,
        'orientation': orientation,
        'design': model,
    })


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_template_convert_word(request, table_id, side):
    """Convert uploaded design PDF (front/back) to editable DOCX and download it."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    if side not in ('front', 'back'):
        return JsonResponse({'status': 'error', 'message': 'Invalid side'}, status=400)

    tmpl, _ = CardTemplate.objects.get_or_create(table=table)
    file_bytes, conv_err = PdfTemplateAnalyzerService.convert_template_pdf_to_docx(tmpl, side)
    if conv_err or not file_bytes:
        return JsonResponse({'status': 'error', 'message': conv_err or 'Conversion failed'}, status=400)

    safe_table_name = re.sub(r'[^a-zA-Z0-9_-]+', '_', str(table.name or 'table')).strip('_') or 'table'
    filename = f'{safe_table_name}_{side}_design_editable.docx'
    resp = HttpResponse(
        file_bytes,
        content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    resp['Content-Disposition'] = f'attachment; filename="{filename}"'
    return resp


@require_http_methods(["GET"])
@login_required
@api_require_permission('perm_print_list')
def api_generate_card_list(request, table_id):
    """List cards in generate_list status for this table (paginated + searchable)."""
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    query = request.GET.get('q', '').strip()
    offset, limit = _parse_offset_limit(request, default_limit=500, max_limit=500)

    pr_qs = PrintRequest.objects.filter(
        table=table, status='generate_list',
    ).select_related('card', 'requested_by').order_by('created_at')

    selected_generate_field_names = _get_selected_generate_field_names(table)

    if query:
        pr_qs = IDCardService._apply_search_filter(
            pr_qs,
            query,
            table=table,
            json_field='card__field_data',
            id_lookup='card__id',
        )

    total = pr_qs.count()
    batch = list(pr_qs[offset:offset + limit])

    items = []
    for idx, pr in enumerate(batch):
        card = pr.card
        fd = card.field_data or {}
        fd_upper = {k.upper(): v for k, v in fd.items()}
        ordered_fields = _build_ordered_fields(table, fd, fd_upper)
        ordered_fields = _filter_ordered_fields_by_names(ordered_fields, selected_generate_field_names)
        items.append({
            'pr_id': pr.id,
            'card_id': card.id,
            'sr_no': offset + idx + 1,
            'ordered_fields': ordered_fields,
        })

    return JsonResponse({
        'status': 'ok',
        'items': items,
        'total': total,
        'offset': offset,
        'limit': limit,
    })


@require_http_methods(["POST"])
@login_required
@api_require_permission('perm_print_list')
@rate_limit(max_requests=5, window_seconds=60, key_prefix='print_generate')
def api_generate_pdf(request, table_id):
    """Generate output PDF for selected generate_list cards.

    Uses saved field mappings and design PDFs.
    On success: returns PDF and moves cards to finalized.
    Body: { "request_ids": [1, 2, 3] }
    """
    table, err = _check_print_table_scope(request.user, table_id)
    if err:
        return err

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)

    preview_raw = data.get('preview_only', False)
    if isinstance(preview_raw, str):
        preview_only = preview_raw.strip().lower() in {'1', 'true', 'yes', 'y'}
    else:
        preview_only = bool(preview_raw)

    request_ids = data.get('request_ids', [])
    if not request_ids:
        return JsonResponse({'status': 'error', 'message': 'No cards selected'}, status=400)

    try:
        tmpl = CardTemplate.objects.get(table=table)
    except CardTemplate.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'No template configured for this table'}, status=400)

    cfg = tmpl.field_config if isinstance(tmpl.field_config, dict) else {}
    editable_front = cfg.get('editable_design_front') if isinstance(cfg.get('editable_design_front'), dict) else None
    editable_back = cfg.get('editable_design_back') if isinstance(cfg.get('editable_design_back'), dict) else None
    has_editable_front = bool(editable_front and ((editable_front.get('lines') or []) or (editable_front.get('images') or [])))
    has_editable_back = bool(editable_back and ((editable_back.get('lines') or []) or (editable_back.get('images') or [])))

    if not tmpl.front_pdf and not has_editable_front:
        return JsonResponse({'status': 'error', 'message': 'Upload front design PDF or convert/save editable front design before generating'}, status=400)
    if tmpl.is_two_sided and not tmpl.back_pdf and not has_editable_back:
        return JsonResponse({'status': 'error', 'message': 'Upload back design PDF or convert/save editable back design before generating'}, status=400)

    mappings = tmpl.field_mappings if isinstance(tmpl.field_mappings, dict) else {}
    front_map = mappings.get('front') if isinstance(mappings.get('front'), dict) else {}
    back_map = mappings.get('back') if isinstance(mappings.get('back'), dict) else {}
    if not front_map:
        return JsonResponse({'status': 'error', 'message': 'Place at least one front field before generating'}, status=400)
    if tmpl.is_two_sided and not back_map:
        return JsonResponse({'status': 'error', 'message': 'Place at least one back field before generating'}, status=400)

    prs = list(
        PrintRequest.objects.filter(
            id__in=request_ids, table=table, status='generate_list',
        ).select_related('card').order_by('created_at')
    )
    if not prs:
        return JsonResponse({'status': 'error', 'message': 'No valid generate-list cards found'}, status=400)

    if preview_only:
        prs = prs[:1]

    file_buffer, error = GenerateCardService.generate(table, tmpl, prs)
    file_bytes = file_buffer.getvalue() if file_buffer else None
    if error or not file_bytes:
        logger.error('api_generate_pdf: %s', error)
        return JsonResponse({'status': 'error', 'message': f'Generation failed: {error or "Unknown error"}'}, status=500)

    if not preview_only:
        # Move cards to finalized
        valid_ids = [pr.id for pr in prs]
        PrintWorkflowService.bulk_generate(valid_ids, request.user)

    file_prefix = 'preview_card' if preview_only else 'cards'
    safe_filename = f'{file_prefix}_{table.id}_{timezone.now().strftime("%Y%m%d_%H%M%S")}.pdf'
    response = HttpResponse(file_bytes, content_type='application/pdf')
    disposition = 'inline' if preview_only else 'attachment'
    response['Content-Disposition'] = f'{disposition}; filename="{safe_filename}"'
    return response
