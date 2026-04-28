"""
Card Print Workflow Service
===========================
All mutations for PrintRequest go through this service.
Views must NOT call .save(), .create(), .delete() directly.
Modelled after ReprintWorkflowService.

Workflow: generate_list (queued) → finalized (via Generate Card PDF) → pool
"""
import io
import logging
import os
import re
import hashlib
import base64
import tempfile
import zipfile
from urllib.parse import urlparse, unquote_to_bytes

from django.db import transaction
from django.utils import timezone

from core.services.base import ServiceResult
from core.services.activity_service import ActivityService
from .models import PrintRequest

logger = logging.getLogger(__name__)


class PrintWorkflowService:
    """Service layer for the card-print workflow."""

    ALLOWED_TRANSITIONS = {
        'generate_list': ['finalized'],
        'finalized': ['pool'],
    }

    VALID_STATUSES = ['generate_list', 'finalized', 'pool']

    @staticmethod
    def _status_label(status):
        labels = {
            'generate_list': 'Generate List',
            'finalized': 'Finalized',
            'pool': 'Pool',
        }
        return labels.get(status, str(status or '').replace('_', ' ').title())

    @classmethod
    def create_requests(cls, table, card_ids, user):
        """Create PrintRequest rows for the given card IDs.

        Skips cards that already have an active (non-pool) print request
        for the same table to avoid duplicates.

        Returns ServiceResult with data: {created: int, skipped: int}
        """
        if not card_ids:
            return ServiceResult(success=False, message='No card IDs provided')

        with transaction.atomic():
            existing_ids = set(
                PrintRequest.objects.select_for_update().filter(
                    table=table,
                    card_id__in=card_ids,
                    status__in=['generate_list', 'finalized'],
                ).values_list('card_id', flat=True)
            )

            to_create = []
            skipped = 0
            for cid in card_ids:
                if cid in existing_ids:
                    skipped += 1
                    continue
                to_create.append(PrintRequest(
                    card_id=cid,
                    table=table,
                    status='generate_list',
                    requested_by=user,
                ))

            if to_create:
                PrintRequest.objects.bulk_create(to_create, ignore_conflicts=True)

        created = len(to_create)
        if created:
            created_card_ids = [pr.card_id for pr in to_create]
            for card_id in created_card_ids:
                ActivityService.log(
                    'card_status',
                    'Card moved from Approved to Generate List',
                    user=user,
                    target_model='IDCard',
                    target_id=card_id,
                    target_name=f'Card #{card_id}',
                )
        logger.info(
            'PrintWorkflow: created=%d skipped=%d table=%d user=%s',
            created, skipped, table.id, user.username,
        )
        return ServiceResult(
            success=True,
            message=f'{created} card(s) added to generate list',
            data={'created': created, 'skipped': skipped},
        )

    @classmethod
    def bulk_generate(cls, request_ids, user):
        """Transition generate_list → finalized for a batch of PrintRequest IDs.
        Called after PDF has been generated and downloaded in Generate Card page.

        Returns ServiceResult with data: {updated: int, skipped: int}
        """
        target_status = 'finalized'
        valid_from = [s for s, targets in cls.ALLOWED_TRANSITIONS.items() if target_status in targets]

        with transaction.atomic():
            qs = PrintRequest.objects.select_for_update().filter(
                id__in=request_ids,
                status__in=valid_from,
            )
            transition_rows = list(qs.values('id', 'card_id', 'status'))
            updated = qs.update(status=target_status, updated_at=timezone.now())

        skipped = len(request_ids) - updated
        logger.info(
            'PrintWorkflow: finalize updated=%d skipped=%d user=%s',
            updated, skipped, user.username,
        )
        for row in transition_rows:
            ActivityService.log(
                'card_status',
                f'Card moved from {cls._status_label(row.get("status"))} to {cls._status_label(target_status)}',
                user=user,
                target_model='IDCard',
                target_id=row.get('card_id'),
                target_name=f'Card #{row.get("card_id")}',
            )
        if not updated:
            return ServiceResult(
                success=False,
                message='No generate list items eligible for finalization.',
                data={'updated': 0, 'skipped': skipped},
            )
        return ServiceResult(
            success=True,
            message=f'{updated} item(s) finalized successfully',
            data={'updated': updated, 'skipped': skipped},
        )

    @classmethod
    def bulk_mark_pool(cls, request_ids, user):
        """Transition finalized → pool for a batch of PrintRequest IDs.

        Returns ServiceResult with data: {updated: int, skipped: int}
        """
        target_status = 'pool'
        valid_from = [s for s, targets in cls.ALLOWED_TRANSITIONS.items() if target_status in targets]

        with transaction.atomic():
            qs = PrintRequest.objects.select_for_update().filter(
                id__in=request_ids,
                status__in=valid_from,
            )
            transition_rows = list(qs.values('id', 'card_id', 'status'))
            updated = qs.update(status=target_status, updated_at=timezone.now())

        skipped = len(request_ids) - updated
        logger.info(
            'PrintWorkflow: mark_pool updated=%d skipped=%d user=%s',
            updated, skipped, user.username,
        )
        for row in transition_rows:
            ActivityService.log(
                'card_status',
                f'Card moved from {cls._status_label(row.get("status"))} to {cls._status_label(target_status)}',
                user=user,
                target_model='IDCard',
                target_id=row.get('card_id'),
                target_name=f'Card #{row.get("card_id")}',
            )
        if not updated:
            return ServiceResult(
                success=False,
                message='No finalized items eligible for pool.',
                data={'updated': 0, 'skipped': skipped},
            )
        return ServiceResult(
            success=True,
            message=f'{updated} item(s) moved to pool',
            data={'updated': updated, 'skipped': skipped},
        )

# ─────────────────────────────────────────────────────────────────────────────
# PDF GENERATION SERVICE
# ─────────────────────────────────────────────────────────────────────────────

IMAGE_FIELD_TYPES = {'photo', 'rel_photo', 'image', 'mother_photo', 'father_photo', 'signature', 'barcode', 'qr_code'}


class GenerateCardService:
    """
    Generates ID-card PDFs using ReportLab data overlay merged onto design PDFs.
    Card size: 87mm × 57mm (CR80 ID card).
    One page per card side.
    """
    CARD_LANDSCAPE_W_MM = 87.0
    CARD_LANDSCAPE_H_MM = 57.0
    CARD_PORTRAIT_W_MM = 57.0
    CARD_PORTRAIT_H_MM = 87.0
    DEFAULT_RENDER_BATCH_SIZE = 100
    MERGE_TOKEN_PATTERN = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}|<<\s*([^<>]+?)\s*>>|\[\[\s*([^\[\]]+?)\s*\]\]")

    @classmethod
    def dimensions_for_orientation_mm(cls, orientation):
        if orientation == 'portrait':
            return cls.CARD_PORTRAIT_W_MM, cls.CARD_PORTRAIT_H_MM
        return cls.CARD_LANDSCAPE_W_MM, cls.CARD_LANDSCAPE_H_MM

    @classmethod
    def _resolve_dimensions_mm(cls, template):
        cfg = template.field_config if isinstance(template.field_config, dict) else {}
        orientation = cfg.get('card_orientation') or 'landscape'
        return cls.dimensions_for_orientation_mm(orientation)

    @classmethod
    def generate(cls, table, template, print_requests, layout_options=None, batch_size=None):
        """
        Generate a multi-page PDF: one page per card (two pages per card for 2-sided).
        Uses ReportLab for data overlay and merges each page onto uploaded design PDF.

        Args:
            table: IDCardTable instance
            template: CardTemplate instance
            print_requests: list of PrintRequest instances (with card pre-fetched)

        Returns:
            (io.BytesIO buffer, None) on success
            (None, error_message) on failure
        """
        try:
            from reportlab.lib.units import mm
            from reportlab.pdfgen import canvas as rl_canvas

            style = cls._pdf_style_from_template(template)
            front_elements = cls._template_elements_for_side(template, 'front')
            back_elements = cls._template_elements_for_side(template, 'back')

            card_w_mm, card_h_mm = cls._resolve_dimensions_mm(template)
            canvas_metrics = cls._template_canvas_metrics(template, card_w_mm, card_h_mm)

            render_card_w_mm = canvas_metrics['real_width_mm']
            render_card_h_mm = canvas_metrics['real_height_mm']

            layout = cls._resolve_layout_config(
                template=template,
                card_w_mm=render_card_w_mm,
                card_h_mm=render_card_h_mm,
                layout_options=layout_options,
            )

            page_w_pt = layout['page_width_mm'] * mm
            page_h_pt = layout['page_height_mm'] * mm

            # Use spooled temp file so large jobs spill to disk instead of exhausting memory.
            buffer = tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024, mode='w+b')
            c = rl_canvas.Canvas(buffer, pagesize=(page_w_pt, page_h_pt))

            render_batch_size = max(1, int(batch_size or cls.DEFAULT_RENDER_BATCH_SIZE))

            # Build field type map from table definition
            field_type_map = {f['name']: f.get('type', 'text') for f in (table.fields or [])}

            if layout['cards_per_page'] <= 1:
                for request_batch in cls._iter_batches(print_requests, render_batch_size):
                    for pr in request_batch:
                        card = pr.card
                        fd = card.field_data or {}
                        fd_upper = {k.upper(): v for k, v in fd.items()}

                        cls._draw_side_from_template_json(
                            c,
                            template,
                            'front',
                            front_elements,
                            fd,
                            fd_upper,
                            field_type_map,
                            render_card_w_mm,
                            render_card_h_mm,
                            style,
                            origin_x_pt=0.0,
                            origin_y_pt=0.0,
                            slot_w_mm=render_card_w_mm,
                            slot_h_mm=render_card_h_mm,
                            canvas_metrics=canvas_metrics,
                        )
                        c.showPage()

                        if template.is_two_sided:
                            cls._draw_side_from_template_json(
                                c,
                                template,
                                'back',
                                back_elements,
                                fd,
                                fd_upper,
                                field_type_map,
                                render_card_w_mm,
                                render_card_h_mm,
                                style,
                                origin_x_pt=0.0,
                                origin_y_pt=0.0,
                                slot_w_mm=render_card_w_mm,
                                slot_h_mm=render_card_h_mm,
                                canvas_metrics=canvas_metrics,
                            )
                            c.showPage()
            else:
                slots = cls._layout_slots(layout, render_card_w_mm, render_card_h_mm)
                if not slots:
                    slots = [{'x_mm': 0.0, 'y_mm': 0.0}]

                page_slot_size = max(1, layout['cards_per_page'])
                for request_batch in cls._iter_batches(print_requests, render_batch_size):
                    for i in range(0, len(request_batch), page_slot_size):
                        chunk = request_batch[i:i + page_slot_size]

                        for slot_idx, pr in enumerate(chunk):
                            slot = slots[slot_idx]
                            card = pr.card
                            fd = card.field_data or {}
                            fd_upper = {k.upper(): v for k, v in fd.items()}
                            cls._draw_side_from_template_json(
                                c,
                                template,
                                'front',
                                front_elements,
                                fd,
                                fd_upper,
                                field_type_map,
                                render_card_w_mm,
                                render_card_h_mm,
                                style,
                                origin_x_pt=slot['x_mm'] * mm,
                                origin_y_pt=slot['y_mm'] * mm,
                                slot_w_mm=render_card_w_mm,
                                slot_h_mm=render_card_h_mm,
                                canvas_metrics=canvas_metrics,
                            )
                        c.showPage()

                        if template.is_two_sided:
                            for slot_idx, pr in enumerate(chunk):
                                slot = slots[slot_idx]
                                card = pr.card
                                fd = card.field_data or {}
                                fd_upper = {k.upper(): v for k, v in fd.items()}
                                cls._draw_side_from_template_json(
                                    c,
                                    template,
                                    'back',
                                    back_elements,
                                    fd,
                                    fd_upper,
                                    field_type_map,
                                    render_card_w_mm,
                                    render_card_h_mm,
                                    style,
                                    origin_x_pt=slot['x_mm'] * mm,
                                    origin_y_pt=slot['y_mm'] * mm,
                                    slot_w_mm=render_card_w_mm,
                                    slot_h_mm=render_card_h_mm,
                                    canvas_metrics=canvas_metrics,
                                )
                            c.showPage()

            c.save()
            buffer.seek(0)

            if layout['cards_per_page'] > 1:
                return buffer, None

            merged_buffer, merge_err = cls._merge_overlay_with_design(template, buffer)
            if merge_err:
                return None, merge_err
            return merged_buffer, None

        except Exception as exc:
            logger.error('GenerateCardService.generate error: %s', exc, exc_info=True)
            return None, str(exc)

    @classmethod
    def _iter_batches(cls, items, batch_size):
        size = max(1, int(batch_size or cls.DEFAULT_RENDER_BATCH_SIZE))
        for idx in range(0, len(items), size):
            yield items[idx:idx + size]



    @classmethod
    def render_pdf_pages_to_png(cls, pdf_bytes, dpi=220):
        if not pdf_bytes:
            return None, 'No PDF data to convert'
        try:
            import fitz
        except Exception:
            return None, 'PyMuPDF is not available for PNG export'

        try:
            doc = fitz.open(stream=pdf_bytes, filetype='pdf')
        except Exception as exc:
            logger.error('PNG export open failed: %s', exc, exc_info=True)
            return None, 'Unable to open generated PDF for PNG conversion'

        images = []
        try:
            scale = max(1.0, float(dpi) / 72.0)
            matrix = fitz.Matrix(scale, scale)
            for page_idx in range(doc.page_count):
                page = doc.load_page(page_idx)
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                images.append({'name': f'card_{page_idx + 1:04d}.png', 'bytes': pix.tobytes('png')})
            return images, None
        except Exception as exc:
            logger.error('PNG export render failed: %s', exc, exc_info=True)
            return None, 'Failed to render PDF pages as PNG'
        finally:
            try:
                doc.close()
            except Exception:
                pass

    @classmethod
    def build_png_zip_bytes(cls, image_items, file_prefix='cards'):
        out = io.BytesIO()
        with zipfile.ZipFile(out, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:
            for idx, item in enumerate(image_items or [], start=1):
                if isinstance(item, dict):
                    name = str((item or {}).get('name') or '').strip()
                    data = (item or {}).get('bytes')
                else:
                    name = ''
                    data = item
                if not name or not data:
                    name = f'{file_prefix}_{idx:04d}.png'
                zf.writestr(name, data)
        out.seek(0)
        return out.getvalue()

    @classmethod
    def build_pdf_zip_for_cards(cls, table, template, print_requests, layout_options=None, batch_size=None):
        out = io.BytesIO()
        with zipfile.ZipFile(out, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:
            for idx, pr in enumerate(print_requests or [], start=1):
                single_buffer, err = cls.generate(
                    table,
                    template,
                    [pr],
                    layout_options=layout_options or {'mode': '1'},
                    batch_size=batch_size or 1,
                )
                if err or not single_buffer:
                    return None, err or f'Failed to generate card {idx}'

                try:
                    if hasattr(single_buffer, 'seek'):
                        single_buffer.seek(0)
                    pdf_bytes = single_buffer.read()
                except Exception as exc:
                    logger.error('Single-card zip read failed: %s', exc, exc_info=True)
                    return None, f'Failed to read generated card {idx}'

                zf.writestr(f'card_{idx:04d}.pdf', pdf_bytes)

        out.seek(0)
        return out.getvalue(), None

    @classmethod
    def _template_canvas_metrics(cls, template, fallback_w_mm, fallback_h_mm):
        raw = template.template_json if isinstance(getattr(template, 'template_json', None), dict) else {}
        canvas = raw.get('canvas') if isinstance(raw.get('canvas'), dict) else {}

        try:
            width = float(canvas.get('width') or 350)
        except (TypeError, ValueError):
            width = 350.0
        try:
            height = float(canvas.get('height') or 200)
        except (TypeError, ValueError):
            height = 200.0

        width = max(100.0, width)
        height = max(60.0, height)

        if canvas.get('realWidthMM') is not None:
            try:
                real_w_mm = float(canvas.get('realWidthMM'))
            except (TypeError, ValueError):
                real_w_mm = float(fallback_w_mm)
        else:
            real_w_mm = float(fallback_w_mm)

        if canvas.get('realHeightMM') is not None:
            try:
                real_h_mm = float(canvas.get('realHeightMM'))
            except (TypeError, ValueError):
                real_h_mm = float(fallback_h_mm)
        else:
            real_h_mm = float(fallback_h_mm)

        real_w_mm = max(10.0, real_w_mm)
        real_h_mm = max(10.0, real_h_mm)

        return {
            'width': width,
            'height': height,
            'real_width_mm': real_w_mm,
            'real_height_mm': real_h_mm,
        }

    @classmethod
    def _resolve_layout_config(cls, template, card_w_mm, card_h_mm, layout_options=None):
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm

        raw = template.template_json if isinstance(getattr(template, 'template_json', None), dict) else {}
        canvas = raw.get('canvas') if isinstance(raw.get('canvas'), dict) else {}
        layout_raw = canvas.get('printLayout') if isinstance(canvas.get('printLayout'), dict) else {}

        override = layout_options if isinstance(layout_options, dict) else {}

        mode = str(override.get('mode') or layout_raw.get('mode') or '1').strip().lower()
        if mode not in ('1', '2', '4', 'custom'):
            mode = '1'

        def _intv(value, default):
            try:
                return int(value)
            except (TypeError, ValueError):
                return int(default)

        def _floatv(value, default):
            try:
                return float(value)
            except (TypeError, ValueError):
                return float(default)

        cols = _intv(override.get('columns') or layout_raw.get('columns'), 1)
        rows = _intv(override.get('rows') or layout_raw.get('rows'), 1)

        if mode == '1':
            cols, rows = 1, 1
        elif mode == '2':
            cols, rows = 2, 1
        elif mode == '4':
            cols, rows = 2, 2

        cols = max(1, min(12, cols))
        rows = max(1, min(12, rows))

        margin_mm = max(0.0, min(40.0, _floatv(override.get('marginMM') or layout_raw.get('marginMM'), 8.0)))
        gap_x_mm = max(0.0, min(40.0, _floatv(override.get('gapXMM') or layout_raw.get('gapXMM'), 4.0)))
        gap_y_mm = max(0.0, min(40.0, _floatv(override.get('gapYMM') or layout_raw.get('gapYMM'), 4.0)))

        page_size = str(override.get('pageSize') or layout_raw.get('pageSize') or 'a4').strip().lower()
        if page_size not in ('a4',):
            page_size = 'a4'

        if cols == 1 and rows == 1:
            return {
                'mode': '1',
                'columns': 1,
                'rows': 1,
                'cards_per_page': 1,
                'margin_mm': 0.0,
                'gap_x_mm': 0.0,
                'gap_y_mm': 0.0,
                'page_width_mm': float(card_w_mm),
                'page_height_mm': float(card_h_mm),
                'page_size': 'card',
            }

        page_w_mm = A4[0] / mm
        page_h_mm = A4[1] / mm

        usable_w = max(1.0, page_w_mm - (2.0 * margin_mm))
        usable_h = max(1.0, page_h_mm - (2.0 * margin_mm))
        max_cols = max(1, int((usable_w + gap_x_mm) // max(0.1, (card_w_mm + gap_x_mm))))
        max_rows = max(1, int((usable_h + gap_y_mm) // max(0.1, (card_h_mm + gap_y_mm))))

        cols = max(1, min(cols, max_cols))
        rows = max(1, min(rows, max_rows))

        return {
            'mode': mode,
            'columns': cols,
            'rows': rows,
            'cards_per_page': max(1, cols * rows),
            'margin_mm': margin_mm,
            'gap_x_mm': gap_x_mm,
            'gap_y_mm': gap_y_mm,
            'page_width_mm': float(page_w_mm),
            'page_height_mm': float(page_h_mm),
            'page_size': page_size,
        }

    @classmethod
    def _layout_slots(cls, layout, card_w_mm, card_h_mm):
        cols = int(layout.get('columns') or 1)
        rows = int(layout.get('rows') or 1)
        margin_mm = float(layout.get('margin_mm') or 0.0)
        gap_x_mm = float(layout.get('gap_x_mm') or 0.0)
        gap_y_mm = float(layout.get('gap_y_mm') or 0.0)
        page_h_mm = float(layout.get('page_height_mm') or card_h_mm)

        slots = []
        for row in range(rows):
            for col in range(cols):
                x_mm = margin_mm + (col * (card_w_mm + gap_x_mm))
                y_top_mm = page_h_mm - margin_mm - (row * (card_h_mm + gap_y_mm))
                y_mm = y_top_mm - card_h_mm
                slots.append({'x_mm': x_mm, 'y_mm': y_mm})
        return slots

    @classmethod
    def _normalize_font_weight_value(cls, weight_raw):
        weight = str(weight_raw or '').strip().lower()
        if weight == 'normal':
            return 400
        if weight == 'bold':
            return 700
        try:
            num = int(round(float(weight)))
        except (TypeError, ValueError):
            num = 400
        num = int(round(num / 100.0) * 100)
        return max(100, min(900, num))

    @classmethod
    def _normalize_font_style_value(cls, style_raw):
        style = str(style_raw or '').strip().lower()
        return 'italic' if style in ('italic', 'oblique') else 'normal'

    @classmethod
    def _builtin_font_name(cls, base_family, weight_raw, style_raw='normal'):
        base = str(base_family or 'helvetica').strip().lower()
        weight = cls._normalize_font_weight_value(weight_raw)
        style = cls._normalize_font_style_value(style_raw)
        is_bold = weight >= 600
        is_italic = style == 'italic'

        if base == 'times':
            if is_bold and is_italic:
                return 'Times-BoldItalic'
            if is_bold:
                return 'Times-Bold'
            if is_italic:
                return 'Times-Italic'
            return 'Times-Roman'

        if base == 'courier':
            if is_bold and is_italic:
                return 'Courier-BoldOblique'
            if is_bold:
                return 'Courier-Bold'
            if is_italic:
                return 'Courier-Oblique'
            return 'Courier'

        if is_bold and is_italic:
            return 'Helvetica-BoldOblique'
        if is_bold:
            return 'Helvetica-Bold'
        if is_italic:
            return 'Helvetica-Oblique'
        return 'Helvetica'

    @classmethod
    def _font_family_key(cls, family_raw):
        family = str(family_raw or '').strip().lower()
        primary = family.split(',')[0].replace('"', '').replace("'", '').strip()
        if 'futura' in primary:
            return 'futura'
        if 'saira' in primary:
            return 'saira'
        if any(token in primary for token in ('arial black', 'arial')):
            return 'arial'
        if any(token in primary for token in ('calibri', 'poppins', 'helvetica', 'verdana', 'tahoma')):
            return 'arial'
        return 'arial'

    @classmethod
    def _font_search_dirs(cls):
        from django.conf import settings

        base_dir = str(getattr(settings, 'BASE_DIR', '') or '')
        paths = []
        if base_dir:
            paths.append(os.path.join(base_dir, 'static', 'fonts'))
            paths.append(os.path.join(base_dir, 'static', 'fonts', 'Roshan_Font'))
            paths.append(os.path.join(base_dir, 'static', 'fonts', 'roshanfonts'))
            paths.append(os.path.join(base_dir, 'staticfiles', 'fonts'))
            paths.append(os.path.join(base_dir, 'staticfiles', 'fonts', 'Roshan_Font'))
            paths.append(os.path.join(base_dir, 'staticfiles', 'fonts', 'roshanfonts'))

        windir = os.environ.get('WINDIR')
        if windir:
            paths.append(os.path.join(windir, 'Fonts'))

        out = []
        seen = set()
        for item in paths:
            norm = os.path.normcase(os.path.normpath(item))
            if norm in seen:
                continue
            seen.add(norm)
            out.append(item)
        return out

    @classmethod
    def _font_candidate_files(cls, family_key, weight_raw, style_raw='normal'):
        weight = cls._normalize_font_weight_value(weight_raw)
        bold = weight >= 600

        if family_key == 'arial':
            if bold:
                return [
                    'Roshan_Font/Arial Bold.ttf',
                    'Arial Bold.ttf',
                ]
            return [
                'Roshan_Font/arial.ttf',
                'Arial.ttf',
            ]

        if family_key == 'saira':
            if weight >= 700:
                return ['saira-semi-condensed-700.ttf', 'saira-semi-condensed-600.ttf']
            if weight >= 600:
                return ['saira-semi-condensed-600.ttf', 'saira-semi-condensed-500.ttf']
            if weight >= 500:
                return ['saira-semi-condensed-500.ttf', 'saira-semi-condensed-400.ttf']
            return ['saira-semi-condensed-400.ttf']

        if family_key == 'futura':
            if bold:
                return [
                    'Roshan_Font/Futura Bold font.ttf',
                    'Futura Bold font.ttf',
                    'Roshan_Font/Futura XBlk BT.ttf',
                    'Futura XBlk BT.ttf',
                ]
            if weight <= 350:
                return [
                    'Roshan_Font/futura light bt.ttf',
                    'futura light bt.ttf',
                    'Roshan_Font/Futura Light font.ttf',
                    'Futura Light font.ttf',
                ]
            return [
                'Roshan_Font/futura medium bt.ttf',
                'futura medium bt.ttf',
                'Roshan_Font/Futura Book font.ttf',
                'Futura Book font.ttf',
                'Roshan_Font/futura medium condensed bt.ttf',
                'futura medium condensed bt.ttf',
            ]

        return []

    @classmethod
    def _find_font_path(cls, candidate_files):
        if not candidate_files:
            return None
        dirs = cls._font_search_dirs()
        for folder in dirs:
            for candidate in candidate_files:
                path = os.path.join(folder, candidate)
                if os.path.isfile(path):
                    return path
        return None

    @classmethod
    def _register_ttf_font(cls, font_path):
        if not font_path:
            return None
        try:
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.ttfonts import TTFont
        except Exception:
            return None

        cache = getattr(cls, '_registered_ttf_fonts', None)
        if not isinstance(cache, dict):
            cache = {}
            setattr(cls, '_registered_ttf_fonts', cache)

        key = os.path.normcase(os.path.abspath(font_path))
        existing = cache.get(key)
        if existing:
            return existing

        alias = 'GCF_' + hashlib.md5(key.encode('utf-8', errors='ignore')).hexdigest()[:16]
        try:
            if alias not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(alias, font_path))
            cache[key] = alias
            return alias
        except Exception as exc:
            logger.warning('GenerateCardService: font register failed for %s: %s', font_path, exc)
            return None

    @classmethod
    def _resolve_pdf_font_name(cls, family_raw, weight_raw, style_raw='normal'):
        family_key = cls._font_family_key(family_raw)
        weight = cls._normalize_font_weight_value(weight_raw)
        style = cls._normalize_font_style_value(style_raw)

        candidates = cls._font_candidate_files(family_key, weight, style)
        font_path = cls._find_font_path(candidates)
        font_alias = cls._register_ttf_font(font_path)
        if font_alias:
            return font_alias

        if family_key != 'arial':
            fallback_path = cls._find_font_path(cls._font_candidate_files('arial', weight, style))
            fallback_alias = cls._register_ttf_font(fallback_path)
            if fallback_alias:
                return fallback_alias

        return cls._builtin_font_name('helvetica', weight, style)

    @classmethod
    def _pdf_style_from_template(cls, template):
        cfg = template.field_config if isinstance(template.field_config, dict) else {}
        raw = cfg.get('docx_text_style') if isinstance(cfg.get('docx_text_style'), dict) else {}

        family_raw = str(raw.get('font_family') or template.font_family or 'Arial').strip().lower()
        weight = str(raw.get('font_weight') or 'normal').strip().lower()
        font_style = str(raw.get('font_style') or 'normal').strip().lower()
        try:
            size = float(raw.get('font_size_pt') or template.font_size or 11)
        except (TypeError, ValueError):
            size = float(template.font_size or 11)
        size = max(6.0, min(72.0, size))

        try:
            line_height = float(raw.get('line_height') or 1.15)
        except (TypeError, ValueError):
            line_height = 1.15
        line_height = max(0.8, min(3.0, line_height))

        align = str(raw.get('align') or 'left').strip().lower()
        if align not in ('left', 'center', 'right'):
            align = 'left'

        font_name = cls._resolve_pdf_font_name(family_raw, weight, font_style)

        color_hex = cls._normalize_hex_color(raw.get('font_color_hex'), default='111111')
        r = int(color_hex[0:2], 16) / 255.0
        g = int(color_hex[2:4], 16) / 255.0
        b = int(color_hex[4:6], 16) / 255.0

        return {
            'font_name': font_name,
            'font_size': size,
            'line_height': line_height,
            'align': align,
            'font_style': cls._normalize_font_style_value(font_style),
            'color_rgb': (r, g, b),
        }

    @classmethod
    def _template_canvas_size(cls, template):
        fallback_w_mm, fallback_h_mm = cls._resolve_dimensions_mm(template)
        metrics = cls._template_canvas_metrics(template, fallback_w_mm, fallback_h_mm)
        return metrics['width'], metrics['height']

    @classmethod
    def _template_elements_for_side(cls, template, side):
        raw = template.template_json if isinstance(getattr(template, 'template_json', None), dict) else {}
        elements = raw.get('elements') if isinstance(raw.get('elements'), list) else []
        wanted_side = 'back' if side == 'back' else 'front'
        backgrounds = []
        regular = []
        for item in elements:
            if not isinstance(item, dict):
                continue
            item_side = str(item.get('side') or 'front').strip().lower()
            if item_side not in ('front', 'back', 'both'):
                item_side = 'front'
            if item_side not in (wanted_side, 'both'):
                continue
            if str(item.get('type') or '').strip().lower() == 'background':
                backgrounds.append(item)
            else:
                regular.append(item)
        return backgrounds + regular

    @classmethod
    def _resolve_field_value(cls, fd, fd_upper, field_name):
        key = str(field_name or '').strip()
        if not key:
            return ''
        value = fd.get(key)
        if value in (None, ''):
            value = fd_upper.get(key.upper())
        return '' if value in (None, '') else value

    @classmethod
    def _auto_image_field_candidates(cls, field_type_map):
        candidates = []
        for field_name, field_type in (field_type_map or {}).items():
            if not cls._is_image_field(field_type, field_name):
                continue
            name = str(field_name or '').strip().lower()
            score = 0
            if 'photo' in name:
                score += 100
            if name in {'photo', 'student_photo'}:
                score += 50
            if 'image' in name:
                score += 25
            if 'signature' in name:
                score += 15
            if 'barcode' in name or 'qr' in name:
                score -= 15
            candidates.append((score, str(field_name or '').strip()))

        candidates.sort(key=lambda item: item[0], reverse=True)
        return [name for _score, name in candidates if name]

    @classmethod
    def _resolve_auto_image_value(cls, fd, fd_upper, field_type_map):
        for field_name in cls._auto_image_field_candidates(field_type_map):
            value = cls._resolve_field_value(fd, fd_upper, field_name)
            if value not in (None, ''):
                return value
        return ''

    @classmethod
    def _render_merge_tokens(cls, text, fd, fd_upper, fallback='XXXXX'):
        raw = str(text or '')
        if not raw:
            return ''

        def repl(match):
            field_name = str(match.group(1) or match.group(2) or match.group(3) or '').strip()
            if not field_name:
                return ''
            token_value = cls._resolve_field_value(fd, fd_upper, field_name)
            if token_value in (None, ''):
                return fallback
            return str(token_value)

        return cls.MERGE_TOKEN_PATTERN.sub(repl, raw)

    @classmethod
    def _draw_side_from_template_json(
        cls,
        c,
        template,
        side,
        elements,
        fd,
        fd_upper,
        field_type_map,
        card_w_mm,
        card_h_mm,
        default_style,
        origin_x_pt=0.0,
        origin_y_pt=0.0,
        slot_w_mm=None,
        slot_h_mm=None,
        canvas_metrics=None,
    ):
        from reportlab.lib.units import mm
        from django.conf import settings

        metrics = canvas_metrics if isinstance(canvas_metrics, dict) else cls._template_canvas_metrics(template, card_w_mm, card_h_mm)
        canvas_w = float(metrics.get('width') or 350.0)
        canvas_h = float(metrics.get('height') or 200.0)
        real_w_mm = float(metrics.get('real_width_mm') or card_w_mm)
        real_h_mm = float(metrics.get('real_height_mm') or card_h_mm)

        target_w_mm = float(slot_w_mm if slot_w_mm is not None else real_w_mm)
        target_h_mm = float(slot_h_mm if slot_h_mm is not None else real_h_mm)

        scale_x = target_w_mm / max(0.001, real_w_mm)
        scale_y = target_h_mm / max(0.001, real_h_mm)

        for item in elements:
            etype = str(item.get('type') or 'text').strip().lower()
            field_name = str(item.get('field') or '').strip()

            value = ''
            if etype in ('text', 'image') and field_name:
                value = cls._resolve_field_value(fd, fd_upper, field_name)
            elif etype == 'text':
                value = str(item.get('label') or '').strip()
            elif etype == 'image':
                value = item.get('src') or item.get('data_url') or ''
            elif etype == 'background':
                value = item.get('src') or ''

            try:
                x = float(item.get('x') or 0.0)
            except (TypeError, ValueError):
                x = 0.0
            try:
                y = float(item.get('y') or 0.0)
            except (TypeError, ValueError):
                y = 0.0
            try:
                w = float(item.get('width') or 120.0)
            except (TypeError, ValueError):
                w = 120.0
            try:
                h = float(item.get('height') or (50.0 if etype == 'image' else 24.0))
            except (TypeError, ValueError):
                h = 50.0 if etype == 'image' else 24.0

            if etype == 'background':
                x = 0.0
                y = 0.0
                w = canvas_w
                h = canvas_h

            x_mm = max(0.0, min(target_w_mm, ((x / canvas_w) * real_w_mm) * scale_x))
            y_mm = max(0.0, min(target_h_mm, ((y / canvas_h) * real_h_mm) * scale_y))
            w_mm = max(0.5, min(target_w_mm, ((w / canvas_w) * real_w_mm) * scale_x))
            h_mm = max(0.5, min(target_h_mm, ((h / canvas_h) * real_h_mm) * scale_y))

            rl_x = origin_x_pt + (x_mm * mm)
            rl_y = origin_y_pt + ((target_h_mm - (y_mm + h_mm)) * mm)
            rl_w = w_mm * mm
            rl_h = h_mm * mm

            if etype == 'background':
                cls._draw_image(c, value, rl_x, rl_y, rl_w, rl_h, settings)
                continue

            if etype == 'rectangle':
                color_hex = cls._normalize_hex_color(item.get('color'), default='2563EB')
                try:
                    stroke_w = float(item.get('strokeWidth') or 1.2)
                except (TypeError, ValueError):
                    stroke_w = 1.2
                stroke_w = max(0.2, min(8.0, stroke_w))

                c.saveState()
                c.setStrokeColorRGB(
                    int(color_hex[0:2], 16) / 255.0,
                    int(color_hex[2:4], 16) / 255.0,
                    int(color_hex[4:6], 16) / 255.0,
                )
                c.setLineWidth(stroke_w)
                c.rect(rl_x, rl_y, rl_w, rl_h, stroke=1, fill=0)
                c.restoreState()
                continue

            mapped_type = field_type_map.get(field_name, 'text') if field_name else 'image'
            if etype == 'image' and not field_name and not value:
                value = cls._resolve_auto_image_value(fd, fd_upper, field_type_map)
            if etype == 'image' or (field_name and cls._is_image_field(mapped_type, field_name)):
                cls._draw_image(c, value, rl_x, rl_y, rl_w, rl_h, settings)
                continue

            elem_style = dict(default_style) if isinstance(default_style, dict) else {}
            try:
                elem_style['font_size'] = max(6.0, min(72.0, float(item.get('fontSize') or elem_style.get('font_size') or 11.0)))
            except (TypeError, ValueError):
                elem_style['font_size'] = float(elem_style.get('font_size') or 11.0)

            try:
                elem_style['line_height'] = max(0.8, min(3.0, float(item.get('lineHeight') or item.get('line_height') or elem_style.get('line_height') or 1.15)))
            except (TypeError, ValueError):
                elem_style['line_height'] = float(elem_style.get('line_height') or 1.15)

            align = str(item.get('textAlign') or item.get('text_align') or item.get('align') or elem_style.get('align') or 'left').strip().lower()
            if align not in ('left', 'center', 'right'):
                align = 'left'
            elem_style['align'] = align

            family_raw = item.get('fontFamily') or item.get('font_family') or item.get('font') or ''
            weight_raw = item.get('fontWeight') or item.get('font_weight') or ''
            style_raw = item.get('fontStyle') or item.get('font_style') or elem_style.get('font_style') or 'normal'
            if not weight_raw:
                default_font_name = str(elem_style.get('font_name') or '')
                weight_raw = 'bold' if default_font_name.lower().endswith('-bold') else 'normal'
            elem_style['font_style'] = cls._normalize_font_style_value(style_raw)
            elem_style['font_name'] = cls._resolve_pdf_font_name(family_raw, weight_raw, style_raw)

            color_hex = cls._normalize_hex_color(item.get('color'), default='111111')
            elem_style['color_rgb'] = (
                int(color_hex[0:2], 16) / 255.0,
                int(color_hex[2:4], 16) / 255.0,
                int(color_hex[4:6], 16) / 255.0,
            )

            # --- Letter spacing (from editor, in px — convert to pt for PDF) ---
            try:
                letter_spacing = float(item.get('letterSpacing') or item.get('letter_spacing') or 0)
            except (TypeError, ValueError):
                letter_spacing = 0.0
            elem_style['letter_spacing'] = letter_spacing

            # --- Mail-merge text resolution (MS Word / CorelDRAW style) ---
            # Priority: item['text'] → item['label'] (matches frontend draftTextValue)
            raw_text_content = ''
            if item.get('text') not in (None, ''):
                raw_text_content = str(item['text'])
            elif item.get('label') not in (None, ''):
                raw_text_content = str(item['label'])

            has_merge_tokens = bool(cls.MERGE_TOKEN_PATTERN.search(raw_text_content))

            if has_merge_tokens:
                # Text contains {{field_name}} tokens — resolve them like MS Word mail merge.
                # Each {{token}} is replaced with the corresponding field value from the card data.
                text = cls._render_merge_tokens(raw_text_content, fd, fd_upper, fallback='').strip()
                if not text:
                    text = ''
            elif field_name:
                # Element is bound to a field but has no merge tokens.
                # Use the field value directly (simple single-field binding).
                field_value = str(value).strip() if value not in (None, '') else ''
                show_label = bool(item.get('showLabel', True))
                if show_label and raw_text_content.strip():
                    # Legacy label+value mode: "Label: Value"
                    text = f'{raw_text_content.strip()}: {field_value}' if field_value else raw_text_content.strip()
                else:
                    text = field_value
            else:
                # No field, no tokens — render the static text as-is.
                text = raw_text_content.strip()

            if not text:
                continue

            cls._draw_text(c, text, rl_x, rl_y, rl_w, rl_h, elem_style)

    @classmethod
    def _template_pdf_bytes(cls, file_field):
        if not file_field:
            return None
        try:
            with file_field.open('rb') as fobj:
                return fobj.read()
        except Exception as exc:
            logger.warning('Template PDF read failed: %s', exc)
            return None

    @classmethod
    def _merge_overlay_with_design(cls, template, overlay_buffer):
        try:
            from pypdf import PdfReader, PdfWriter
        except Exception:
            # pypdf unavailable: return overlay-only PDF.
            overlay_buffer.seek(0)
            return overlay_buffer, None

        try:
            overlay_buffer.seek(0)
            overlay_reader = PdfReader(overlay_buffer)
            writer = PdfWriter()

            front_design = cls._template_pdf_bytes(getattr(template, 'front_pdf', None))
            back_design = cls._template_pdf_bytes(getattr(template, 'back_pdf', None))

            page_idx = 0
            for _ in range(len(overlay_reader.pages)):
                side = 'front'
                if template.is_two_sided and (page_idx % 2 == 1):
                    side = 'back'

                overlay_page = overlay_reader.pages[page_idx]
                page_idx += 1

                design_bytes = back_design if side == 'back' else front_design
                if design_bytes:
                    design_reader = PdfReader(io.BytesIO(design_bytes))
                    base_page = design_reader.pages[0]
                    base_page.merge_page(overlay_page)
                    writer.add_page(base_page)
                else:
                    writer.add_page(overlay_page)

            out = io.BytesIO()
            writer.write(out)
            out.seek(0)
            return out, None
        except Exception as exc:
            logger.error('PDF merge failed: %s', exc, exc_info=True)
            return None, 'Failed to merge data with design PDF'



    @classmethod
    def _format_field_label(cls, field_name):
        raw = str(field_name or '').strip()
        if not raw:
            return 'Field'
        txt = re.sub(r'[_\-]+', ' ', raw)
        txt = re.sub(r'\s+', ' ', txt).strip()
        return txt.title()

    @classmethod
    def _normalize_hex_color(cls, value, default='111111'):
        raw = str(value or '').strip()
        if not raw:
            return default

        v = raw[1:] if raw.startswith('#') else raw
        if re.fullmatch(r'[0-9a-fA-F]{3}', v):
            v = ''.join(ch * 2 for ch in v)
        if not re.fullmatch(r'[0-9a-fA-F]{6}', v):
            return default
        return v.upper()

    @classmethod
    def _is_image_field(cls, ftype, field_name=''):
        """Detect image-like fields from type/name using tolerant matching."""
        t = (ftype or '').strip().lower()
        n = (field_name or '').strip().lower()
        if t in IMAGE_FIELD_TYPES:
            return True
        if t in {'file', 'img', 'picture'}:
            return True
        if ('photo' in n) or ('image' in n) or ('barcode' in n):
            return True
        if re.search(r'\bsignature\b|\bsign\b', n):
            return True
        if re.search(r'\bqr\b', n):
            return True
        return False

    @classmethod
    def _draw_image(cls, c, value, x, y, w, h, settings):
        """Draw an image scaled to fit within the bounding box (preserveAspectRatio)."""
        if not value or value == 'NOT_FOUND' or str(value).startswith('PENDING:'):
            return
        try:
            from reportlab.lib.utils import ImageReader

            raw_value = str(value).replace('\\', '/')
            img_reader = None

            if raw_value.startswith('data:image'):
                _, _, payload = raw_value.partition(',')
                if not payload:
                    return
                header = raw_value.split(',', 1)[0]
                if ';base64' in header:
                    img_bytes = base64.b64decode(payload)
                else:
                    img_bytes = unquote_to_bytes(payload)
                img_reader = ImageReader(io.BytesIO(img_bytes))
            else:
                if raw_value.startswith('http://') or raw_value.startswith('https://'):
                    parsed = urlparse(raw_value)
                    raw_value = parsed.path or ''

                if raw_value.startswith('/media/'):
                    raw_value = raw_value[len('/media/'):]
                elif raw_value.startswith('media/'):
                    raw_value = raw_value[len('media/'):]

                if os.path.isabs(raw_value):
                    img_path = raw_value
                else:
                    img_path = os.path.join(settings.MEDIA_ROOT, raw_value)

                if not os.path.exists(img_path):
                    return
                img_reader = ImageReader(img_path)

            if img_reader is None:
                return
            iw, ih = img_reader.getSize()
            if iw <= 0 or ih <= 0:
                return
            # Scale to fit while preserving aspect ratio
            scale = min(w / iw, h / ih)
            draw_w = iw * scale
            draw_h = ih * scale
            # Centre inside the box
            offset_x = (w - draw_w) / 2
            offset_y = (h - draw_h) / 2
            c.drawImage(img_reader, x + offset_x, y + offset_y,
                        width=draw_w, height=draw_h, mask='auto')
        except Exception as exc:
            logger.warning('GenerateCardService: image draw failed for %s: %s', value, exc)

    @classmethod
    def _draw_text(cls, c, text, x, y, w, h, style):
        """Draw text inside a bounding box with word-wrap, alignment, and letter spacing."""
        if not text:
            return
        try:
            font_name = style.get('font_name', 'Helvetica') if isinstance(style, dict) else 'Helvetica'
            font_size = float(style.get('font_size', 11)) if isinstance(style, dict) else 11.0
            line_height_mult = float(style.get('line_height', 1.3)) if isinstance(style, dict) else 1.3
            align = style.get('align', 'left') if isinstance(style, dict) else 'left'
            color_rgb = style.get('color_rgb', (0, 0, 0)) if isinstance(style, dict) else (0, 0, 0)
            letter_spacing = float(style.get('letter_spacing', 0)) if isinstance(style, dict) else 0.0

            c.saveState()
            # Clip to bounding box
            path = c.beginPath()
            path.rect(x, y, w, h)
            c.clipPath(path, stroke=0, fill=0)

            try:
                c.setFont(font_name, font_size)
            except Exception:
                fallback_name = cls._builtin_font_name(
                    'helvetica',
                    700 if 'bold' in str(font_name).lower() else 400,
                    'italic' if any(token in str(font_name).lower() for token in ('italic', 'oblique')) else 'normal',
                )
                font_name = fallback_name
                c.setFont(font_name, font_size)
            c.setFillColorRGB(color_rgb[0], color_rgb[1], color_rgb[2])

            line_height = font_size * line_height_mult
            max_text_width = max(1.0, w - 2.0)

            lines = cls._wrap_text_to_width(c, font_name, font_size, text, max_text_width)

            # Calculate total text block height for vertical centering
            total_text_height = len(lines) * line_height if lines else 0
            # Vertically center the text block within the bounding box
            if total_text_height < h:
                baseline_y = y + h - ((h - total_text_height) / 2) - font_size
            else:
                baseline_y = y + h - font_size

            def _string_width_with_spacing(line_text):
                """Calculate effective string width including letter spacing."""
                base_w = c.stringWidth(line_text, font_name, font_size)
                if letter_spacing and len(line_text) > 1:
                    base_w += letter_spacing * (len(line_text) - 1)
                return base_w

            def _draw_string_with_spacing(draw_x, draw_y, line_text):
                """Draw a string character-by-character when letter spacing is non-zero."""
                if not letter_spacing or abs(letter_spacing) < 0.01:
                    c.drawString(draw_x, draw_y, line_text)
                    return
                cursor_x = draw_x
                for ch in line_text:
                    c.drawString(cursor_x, draw_y, ch)
                    cursor_x += c.stringWidth(ch, font_name, font_size) + letter_spacing

            for line in lines:
                if baseline_y < y:
                    break
                if align == 'right':
                    text_width = _string_width_with_spacing(line)
                    draw_x = max(x + 1, x + w - text_width - 1)
                elif align == 'center':
                    text_width = _string_width_with_spacing(line)
                    draw_x = x + max(1, (w - text_width) / 2)
                else:
                    draw_x = x + 1
                _draw_string_with_spacing(draw_x, baseline_y, line)
                baseline_y -= line_height

            c.restoreState()
        except Exception as exc:
            logger.warning('GenerateCardService: text draw failed: %s', exc)

    @classmethod
    def _wrap_text_to_width(cls, c, font_name, font_size, text, max_width, first_line_width=None):
        lines = []
        first_limit = max(1.0, float(first_line_width if first_line_width is not None else max_width))
        normal_limit = max(1.0, float(max_width))
        line_limit = first_limit

        for raw_line in str(text or '').split('\n'):
            src = str(raw_line or '').strip()
            if not src:
                lines.append('')
                line_limit = normal_limit
                continue

            words = src.split()
            current = ''
            for word in words:
                candidate = (current + ' ' + word).strip() if current else word
                if c.stringWidth(candidate, font_name, font_size) <= line_limit:
                    current = candidate
                    continue

                if current:
                    lines.append(current)
                    current = ''
                    line_limit = normal_limit

                if c.stringWidth(word, font_name, font_size) <= line_limit:
                    current = word
                    continue

                frag = ''
                for ch in word:
                    cand = frag + ch
                    if c.stringWidth(cand, font_name, font_size) <= line_limit:
                        frag = cand
                    else:
                        if frag:
                            lines.append(frag)
                            line_limit = normal_limit
                        frag = ch
                current = frag

            if current:
                lines.append(current)
            line_limit = normal_limit

        return lines
