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

from django.db import transaction
from django.utils import timezone

from core.services.base import ServiceResult
from .models import PrintRequest

logger = logging.getLogger(__name__)


class PrintWorkflowService:
    """Service layer for the card-print workflow."""

    ALLOWED_TRANSITIONS = {
        'generate_list': ['finalized'],
        'finalized': ['pool'],
    }

    VALID_STATUSES = ['generate_list', 'finalized', 'pool']

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
            updated = qs.update(status=target_status, updated_at=timezone.now())

        skipped = len(request_ids) - updated
        logger.info(
            'PrintWorkflow: finalize updated=%d skipped=%d user=%s',
            updated, skipped, user.username,
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
            updated = qs.update(status=target_status, updated_at=timezone.now())

        skipped = len(request_ids) - updated
        logger.info(
            'PrintWorkflow: mark_pool updated=%d skipped=%d user=%s',
            updated, skipped, user.username,
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

IMAGE_FIELD_TYPES = {'photo', 'image', 'mother_photo', 'father_photo', 'signature', 'barcode', 'qr_code'}


class GenerateCardService:
    """
    Generates a data-layer PDF for ID cards using ReportLab.
    Card size: 87mm × 57mm (CR80 ID card).
    One page per card side. No background — pure positioned data.
    Merging with the template design PDF is done separately.
    """
    CARD_W_MM = 87.0
    CARD_H_MM = 57.0

    @classmethod
    def generate(cls, table, template, print_requests):
        """
        Generate a multi-page PDF: one page per card (two pages per card for 2-sided).

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

            buffer = io.BytesIO()
            card_w_pt = cls.CARD_W_MM * mm
            card_h_pt = cls.CARD_H_MM * mm

            c = rl_canvas.Canvas(buffer, pagesize=(card_w_pt, card_h_pt))

            font = template.font_family or 'Helvetica-Bold'
            font_size = max(7, min(10, template.font_size or 8))
            front_mappings = (template.field_mappings or {}).get('front', {})
            back_mappings = (template.field_mappings or {}).get('back', {})
            field_cfg = template.field_config or {}
            front_allowed = set(field_cfg.get('front_fields') or [])
            back_allowed = set(field_cfg.get('back_fields') or [])

            # Build field type map from table definition
            field_type_map = {f['name']: f.get('type', 'text') for f in (table.fields or [])}

            for pr in print_requests:
                card = pr.card
                fd = card.field_data or {}
                fd_upper = {k.upper(): v for k, v in fd.items()}

                # Front
                cls._draw_side(
                    c, fd, fd_upper, field_type_map, front_mappings,
                    font, font_size, card_h_pt, front_allowed,
                )
                c.showPage()

                # Back (only if 2-sided and back mappings exist)
                if template.is_two_sided and back_mappings:
                    cls._draw_side(
                        c, fd, fd_upper, field_type_map, back_mappings,
                        font, font_size, card_h_pt, back_allowed,
                    )
                    c.showPage()

            c.save()
            buffer.seek(0)
            return buffer, None

        except Exception as exc:
            logger.error('GenerateCardService.generate error: %s', exc, exc_info=True)
            return None, str(exc)

    @classmethod
    def _draw_side(
        cls,
        c,
        fd,
        fd_upper,
        field_type_map,
        mappings,
        font,
        font_size,
        card_h_pt,
        allowed_fields=None,
    ):
        """Draw all mapped fields onto the current ReportLab canvas page."""
        from reportlab.lib.units import mm
        from django.conf import settings

        for field_name, mapping in mappings.items():
            if allowed_fields and field_name not in allowed_fields:
                continue
            value = fd.get(field_name) or fd_upper.get(field_name.upper()) or ''
            ftype = field_type_map.get(field_name, 'text')

            x_mm = float(mapping.get('x_mm', 0))
            y_mm = float(mapping.get('y_mm', 0))
            w_mm = float(mapping.get('w_mm', 20))
            h_mm = float(mapping.get('h_mm', 10))

            # ReportLab: (0,0) = bottom-left. Our origin: top-left.
            rl_x = x_mm * mm
            rl_y = card_h_pt - (y_mm + h_mm) * mm  # bottom-left of box in RL coords
            rl_w = w_mm * mm
            rl_h = h_mm * mm

            if cls._is_image_field(ftype, field_name):
                cls._draw_image(c, value, rl_x, rl_y, rl_w, rl_h, settings)
            else:
                cls._draw_text(c, str(value) if value else '', rl_x, rl_y, rl_w, rl_h, font, font_size)

    @classmethod
    def _is_image_field(cls, ftype, field_name=''):
        """Detect image-like fields from type/name using tolerant matching."""
        t = (ftype or '').strip().lower()
        n = (field_name or '').strip().lower()
        if t in IMAGE_FIELD_TYPES:
            return True
        if t in {'file', 'img', 'picture'}:
            return True
        if any(key in n for key in ('photo', 'image', 'signature', 'sign', 'barcode', 'qr')):
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
            if raw_value.startswith('/media/'):
                raw_value = raw_value[len('/media/'):]
            elif raw_value.startswith('media/'):
                raw_value = raw_value[len('media/'):]

            img_path = os.path.join(settings.MEDIA_ROOT, raw_value)
            if not os.path.exists(img_path):
                return
            img_reader = ImageReader(img_path)
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
    def _draw_text(cls, c, text, x, y, w, h, font, font_size):
        """Draw text inside a bounding box with basic word-wrap."""
        if not text:
            return
        try:
            c.saveState()
            # Clip to box
            path = c.beginPath()
            path.rect(x, y, w, h)
            c.clipPath(path, stroke=0, fill=0)

            c.setFont(font, font_size)
            c.setFillColorRGB(0, 0, 0)

            line_height = font_size * 1.3
            avg_char_w = font_size * 0.55
            max_chars = max(1, int(w / avg_char_w))

            # Simple word wrap
            lines = []
            for raw_line in text.split('\n'):
                words = raw_line.split()
                current = ''
                for word in words:
                    candidate = (current + ' ' + word).strip() if current else word
                    if len(candidate) <= max_chars:
                        current = candidate
                    else:
                        if current:
                            lines.append(current)
                        current = word[:max_chars]
                if current:
                    lines.append(current)

            # Draw lines from top of box downward
            # In RL, y is from bottom. Top of box = y + h. First baseline just inside top.
            baseline_y = y + h - font_size
            for line in lines:
                if baseline_y < y:
                    break
                c.drawString(x + 1, baseline_y, line)
                baseline_y -= line_height

            c.restoreState()
        except Exception as exc:
            logger.warning('GenerateCardService: text draw failed: %s', exc)
