""" 
PDF Export Module

Handles PDF file generation for ID card data using xhtml2pdf.
This module is READ-ONLY - it never mutates data.

Adapted from new_test project's student_card_pdf view.

Features:
- Landscape A4 format
- Dynamic column widths based on content
- Supports text + image fields
- Repeating header/footer on every page
- UPPERCASE text for printing clarity
- Images rendered at 2.5cm height (matches Word export)
- 1cm margins on all 4 sides (matches Word export)
- Phase 4: Uses THUMBNAILS for optimized export file size
"""
import os
import io
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from datetime import datetime

from django.utils import timezone as django_tz
from django.conf import settings
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.db.models import QuerySet

from mediafiles.services import ImageService

from django.utils.html import escape as html_escape
from django.utils.safestring import mark_safe

from .utils import (
    separate_fields_by_type,
    generate_export_filename,
    format_field_value,
    is_valid_image_path,
    sort_cards_for_export,
    get_class_field_name,
    stream_file_response,
)

logger = logging.getLogger(__name__)

# Absolute path to the placeholder image shown when a record has no photo
_PLACEHOLDER_IMAGE_PATH = os.path.join(
    settings.BASE_DIR, 'static', 'assets', 'no-image-placeholder.png'
)


@dataclass
class PdfExportResult:
    """Result of a PDF export operation."""
    success: bool
    message: str = ''
    response: Optional[HttpResponse] = None
    filename: str = ''
    card_count: int = 0


def _link_callback(uri, rel):
    """
    Resolve absolute file paths for images and static assets.
    xhtml2pdf needs local filesystem paths to embed images.
    """
    if uri.startswith(settings.MEDIA_URL):
        path = os.path.join(
            settings.MEDIA_ROOT,
            uri.replace(settings.MEDIA_URL, '')
        )
        # Guard against path traversal
        path = os.path.realpath(path)
        if not path.startswith(os.path.realpath(settings.MEDIA_ROOT)):
            return uri
    elif uri.startswith(settings.STATIC_URL):
        static_root = getattr(settings, 'STATIC_ROOT', None)
        if static_root:
            path = os.path.join(static_root, uri.replace(settings.STATIC_URL, ''))
            # Guard against path traversal
            path = os.path.realpath(path)
            if not path.startswith(os.path.realpath(static_root)):
                return uri
        else:
            # Fallback for dev: use STATICFILES_DIRS
            for sdir in getattr(settings, 'STATICFILES_DIRS', []):
                candidate = os.path.join(sdir, uri.replace(settings.STATIC_URL, ''))
                candidate = os.path.realpath(candidate)
                if not candidate.startswith(os.path.realpath(sdir)):
                    continue
                if os.path.isfile(candidate):
                    return candidate
            return uri
    else:
        return uri

    return path if os.path.isfile(path) else uri


class PdfExporter:
    """
    Handles PDF export operations.

    Features:
    - Landscape A4 with dynamic column widths
    - Text fields + image fields rendered side by side
    - Repeating header and footer on every page
    - UPPERCASE text for printing clarity
    - Image height fixed at 2.5cm (matches Word export)
    - 1cm margins on all 4 sides

    Usage:
        exporter = PdfExporter()
        result = exporter.export_cards(table, cards)
        if result.success:
            return result.response
    """

    # Width boost multiplier for name/address fields
    NAME_ADDRESS_BOOST = 1.4
    # Width boost for non-wrappable fields (mobile, DOB, Aadhar, etc.)
    NOWRAP_BOOST = 1.35
    # Image column weight (fixed)
    IMAGE_COLUMN_WEIGHT = 25
    # Column width bounds (percentage)
    MIN_COL_WIDTH = 4.0
    MAX_COL_WIDTH = 30.0
    # Minimum width for non-wrappable fields (percentage)
    MIN_NOWRAP_COL_WIDTH = 5.5
    # Landscape A4 content width (29.7cm page - 0.5cm left - 0.5cm right margins)
    PAGE_CONTENT_WIDTH_CM = 28.7

    # ── Page height budget (all values in cm) ──
    # A4 landscape height = 21cm
    # @page margin: top=1.5cm, bottom=0.3cm → content height = 19.2cm
    PAGE_CONTENT_HEIGHT_CM = 19.2
    # Inline footer: 3 lines at 6.5pt, ~0.15cm top margin, page number
    FOOTER_HEIGHT_CM = 0.85
    # Safety margin to account for xhtml2pdf rendering differences
    PAGE_SAFETY_MARGIN_CM = 0.15
    # Header row: base padding + per-line text height
    HEADER_BASE_CM = 0.12  # ~1px top + 1px bottom padding
    HEADER_LINE_CM = 0.24  # ~7pt text + leading per line

    # Field name keywords that indicate non-wrappable content
    NOWRAP_KEYWORDS = [
        'mobile', 'phone', 'contact', 'tel', 'cell',
        'dob', 'date', 'birth', 'joining',
        'aadhar', 'aadhaar', 'aadharno', 'aadhaarno',
        'pan', 'pincode', 'pin', 'zip',
        'roll', 'enrollment', 'enrolment', 'reg',
        'id no', 'idno', 'sr no', 'srno', 'uid',
        'account', 'ifsc', 'bank',
    ]

    def export_cards(
        self,
        table,
        cards: QuerySet,
        status: str = '',
        template_id: int = None
    ) -> PdfExportResult:
        """
        Export cards to PDF format.

        Args:
            table: IDCardTable instance
            cards: QuerySet of IDCard instances

        Returns:
            PdfExportResult with HttpResponse if successful
        """
        try:
            from xhtml2pdf import pisa
        except ImportError:
            return PdfExportResult(
                success=False,
                message='xhtml2pdf library not installed. Run: pip install xhtml2pdf'
            )

        if not cards.exists():
            return PdfExportResult(
                success=False,
                message='No cards to export!'
            )

        # Hard cap to prevent OOM — xhtml2pdf is very memory-hungry with images
        MAX_PDF_CARDS = 5000
        card_count = cards.count()
        if card_count > MAX_PDF_CARDS:
            return PdfExportResult(
                success=False,
                message=f'PDF export limited to {MAX_PDF_CARDS} cards (requested {card_count}). Use Excel or reduce your selection.'
            )

        try:
            # Get all fields (text + image)
            all_fields = table.fields or []
            field_info = separate_fields_by_type(all_fields)
            text_fields = field_info['text']
            image_fields = field_info['image']
            ordered_fields = text_fields + image_fields

            if not ordered_fields:
                return PdfExportResult(
                    success=False,
                    message='No fields found in table configuration!'
                )

            # Sort cards for export (Class → Section → Name)
            cards_list = sort_cards_for_export(list(cards[:MAX_PDF_CARDS]), table.fields)
            column_configs = self._build_column_configs(ordered_fields, cards_list)

            # Compute dynamic row height from tallest image column
            max_img_h = 0
            for cfg in column_configs:
                if cfg.get('is_image') and 'image_height_cm' in cfg:
                    max_img_h = max(max_img_h, cfg['image_height_cm'])
            row_height_cm = round(max_img_h + 0.15, 2) if max_img_h > 0 else 0.8
            data_row_height_cm = row_height_cm

            # Build row data (with placeholder images for missing photos)
            rows = self._build_rows(ordered_fields, cards_list, column_configs)

            # Get institution name
            institution_name = "Institution"
            if table.group and table.group.client:
                institution_name = table.group.client.name

            # Get dynamic export settings
            from core.models import SystemSettings, ExportTemplate
            export_settings = SystemSettings.get_export_settings()

            # Fetch template instructions if template_id provided
            template_instructions = ''
            if template_id:
                try:
                    tpl = ExportTemplate.objects.get(id=template_id)
                    template_instructions = tpl.instructions
                except ExportTemplate.DoesNotExist:
                    pass

            # Group rows into pages (dynamic RPP, class-break aware)
            class_field_name = get_class_field_name(table.fields)
            rpp = self._compute_records_per_page(
                column_configs, has_instructions=bool(template_instructions),
                data_row_height_cm=data_row_height_cm
            )
            pages = self._group_rows_into_pages(
                rows, cards_list, class_field_name, records_per_page=rpp
            )

            # Render HTML
            context = {
                'columns': column_configs,
                'pages': pages,
                'total_pages': len(pages),
                'institution_name': institution_name,
                'table_name': table.name,
                'current_date': django_tz.localtime(django_tz.now()).strftime('%d-%m-%Y'),
                'generated_at': django_tz.localtime(django_tz.now()).strftime('%d-%b-%Y %H:%M'),
                'export_note_line': export_settings.get('export_note_line', 'Note: This document is computer generated. Please verify all details before printing ID cards.'),
                'export_copyright_line': export_settings.get('export_copyright_line', '© Adarsh ID Cards Management System'),
                'template_instructions': template_instructions,
                'row_height_cm': row_height_cm,
            }

            html = render_to_string('exports/pdf_report.html', context)

            # Generate PDF into a buffer, then stream for large files
            pdf_buffer = io.BytesIO()
            filename = generate_export_filename(table.name, 'pdf', client_name=institution_name, status=status)

            pisa_status = pisa.CreatePDF(
                io.BytesIO(html.encode('UTF-8')),
                dest=pdf_buffer,
                link_callback=_link_callback
            )

            if pisa_status.err:
                logger.error("PDF generation error: %s", pisa_status.err)
                return PdfExportResult(
                    success=False,
                    message='Error generating PDF. Check server logs.'
                )

            pdf_bytes = pdf_buffer.getvalue()
            pdf_buffer.close()
            response = stream_file_response(pdf_bytes, filename, 'application/pdf')

            return PdfExportResult(
                success=True,
                response=response,
                filename=filename,
                card_count=len(cards_list)
            )

        except Exception as e:
            logger.error("PDF export failed: %s", e, exc_info=True)
            return PdfExportResult(
                success=False,
                message='PDF export failed. Please try again or contact support.'
            )

    def _get_image_render_width_cm(self, cards_list, field_name):
        """Compute rendered image width at 2.5cm height from first valid image.
        
        Used to size image columns to: rendered_width + 0.1 cm.
        Falls back to 3:4 portrait ratio (standard ID photo) if no image found.
        """
        IMAGE_HEIGHT = 2.5
        DEFAULT_RATIO = 0.75  # 3:4 portrait
        try:
            from PIL import Image as PILImage
            for card in cards_list[:10]:
                # Phase 4: Use thumbnail if available for consistent sizing
                img_path = ImageService.get_image_path_for_export(
                    card=card, field_name=field_name, 
                    prefer_thumbnail=True, fallback_to_field_data=True
                )
                if img_path and is_valid_image_path(img_path):
                    abs_path = os.path.join(settings.MEDIA_ROOT, img_path)
                    if os.path.isfile(abs_path):
                        with open(abs_path, 'rb') as f:
                            with PILImage.open(f) as img:
                                w, h = img.size
                                if h > 0:
                                    return IMAGE_HEIGHT * (w / h)
        except Exception:
            pass
        return IMAGE_HEIGHT * DEFAULT_RATIO

    @classmethod
    def _is_nowrap_field(cls, field_name: str) -> bool:
        """Check if a field contains non-wrappable data (phone, DOB, ID numbers, etc.)."""
        name_lower = field_name.lower().replace(' ', '').replace('_', '').replace('.', '')
        return any(kw.replace(' ', '') in name_lower for kw in cls.NOWRAP_KEYWORDS)

    def _estimate_header_lines(self, column_configs):
        """Estimate max number of text lines the tallest column header needs.

        Uses column width (%) to compute available characters per line,
        then simulates word-boundary wrapping on each label.
        """
        max_lines = 1
        for cfg in column_configs:
            label = cfg.get('label', '')
            col_width_cm = (cfg['width'] / 100) * self.PAGE_CONTENT_WIDTH_CM
            # Usable text width = column width - left/right padding (~1px each) - borders
            usable_cm = col_width_cm - 0.15
            if usable_cm <= 0:
                usable_cm = 0.4
            # At 7pt Helvetica, ~1 uppercase char ≈ 0.13cm
            chars_per_line = max(2, int(usable_cm / 0.13))
            # Simulate word-wrap
            words = label.split()
            lines = 1
            current_len = 0
            for word in words:
                word_len = len(word)
                if current_len > 0 and current_len + 1 + word_len > chars_per_line:
                    lines += 1
                    current_len = word_len
                else:
                    current_len += (1 if current_len > 0 else 0) + word_len
            # A single very long word that exceeds the line width also wraps
            if len(label.replace(' ', '')) > chars_per_line and lines == 1:
                lines = max(1, -(-len(label) // chars_per_line))  # ceil div
            max_lines = max(max_lines, lines)
        return max_lines

    def _compute_records_per_page(self, column_configs, has_instructions=False, data_row_height_cm=None):
        """Compute how many data rows safely fit on one page.

        Takes into account:
          - Dynamic header height (based on column label wrapping)
          - Inline footer height
          - Instructions block on last page (optional)
          - Safety margin for xhtml2pdf rendering quirks
          - Dynamic row height based on tallest image column
        """
        if data_row_height_cm is None:
            data_row_height_cm = 2.7  # fallback

        header_lines = self._estimate_header_lines(column_configs)
        header_height = self.HEADER_BASE_CM + header_lines * self.HEADER_LINE_CM

        budget = (self.PAGE_CONTENT_HEIGHT_CM
                  - self.FOOTER_HEIGHT_CM
                  - self.PAGE_SAFETY_MARGIN_CM
                  - header_height)

        rpp = int(budget / data_row_height_cm)
        return max(3, min(rpp, 10))

    @classmethod
    def _looks_numeric_or_date(cls, value: str) -> bool:
        """Check if a value is primarily numeric/date-like (shouldn't be wrapped)."""
        if not value:
            return False
        # Count digits + separators vs letters
        digits_seps = sum(1 for c in value if c.isdigit() or c in '/-.:+ ')
        return digits_seps >= len(value) * 0.6

    def _build_column_configs(
        self,
        ordered_fields: List[Dict[str, Any]],
        cards: list
    ) -> List[Dict[str, Any]]:
        """
        Calculate dynamic column widths based on data content.

        Algorithm:
        - Image columns: fixed percentage from subtype dimensions.
        - Text columns: share remaining width proportionally based on
          content character lengths.
        - Uses 90th-percentile length (not max) to avoid outlier skew.
        - Name/address fields get a 1.4× boost, nowrap fields (phone,
          DOB, Aadhar) get a 1.35× boost to keep content away from borders.
        - All text columns respect MIN_COL_WIDTH / MAX_COL_WIDTH bounds.
        """
        # Build column metadata
        configs = [{
            'label': 'SR NO',
            'width': 0,
            'align': 'center',
            'is_image': False,
            'nowrap': False,
        }]

        for field in ordered_fields:
            name = field['name']
            is_image = field.get('is_image', False)
            align = 'left' if any(w in name.lower() for w in ['name', 'address']) else 'center'
            nowrap = (not is_image) and self._is_nowrap_field(name)
            configs.append({
                'label': name.upper(),
                'width': 0,
                'align': align,
                'is_image': is_image,
                'nowrap': nowrap,
            })

        # Auto-detect nowrap from data: if >70% of values look numeric/date,
        # flag the column as nowrap even if the name didn't match keywords
        for i, cfg in enumerate(configs):
            if cfg['is_image'] or cfg['nowrap'] or i == 0:
                continue
            field = ordered_fields[i - 1]
            name = field['name']
            sample_count = min(len(cards), 20)
            if sample_count == 0:
                continue
            numeric_count = 0
            for card in cards[:sample_count]:
                fd = card.field_data or {}
                val = str(fd.get(name, '') or '').strip()
                if val and self._looks_numeric_or_date(val):
                    numeric_count += 1
            if numeric_count >= sample_count * 0.7:
                cfg['nowrap'] = True

        # Step 1: Fix image column percentages from subtype dimensions
        IMAGE_CELL_PADDING_CM = 0.1
        image_indices = set()
        for i, cfg in enumerate(configs):
            if cfg['is_image']:
                image_indices.add(i)
                field = ordered_fields[i - 1]
                render_w = field.get('image_width_cm', 1.95)
                render_h = field.get('image_height_cm', 2.5)
                cfg['width'] = ((render_w + IMAGE_CELL_PADDING_CM) / self.PAGE_CONTENT_WIDTH_CM) * 100
                cfg['image_width_cm'] = render_w
                cfg['image_height_cm'] = render_h

        # Step 2: Remaining percentage for text columns
        image_pct = sum(configs[i]['width'] for i in image_indices)
        remaining_pct = max(100.0 - image_pct, 20.0)

        # Step 3: Collect value lengths per text column, compute P90 weight
        text_indices = [i for i in range(len(configs)) if i not in image_indices]
        text_weights = []
        for i in text_indices:
            if i == 0:
                # Sr No column — fixed small weight
                text_weights.append(max(len('SR NO'), 4))
                continue

            field = ordered_fields[i - 1]
            name = field['name']
            is_nowrap = configs[i]['nowrap']
            is_name_addr = any(w in name.lower() for w in ['name', 'address', 'email'])

            # Collect all value lengths
            lengths = [len(name.upper())]  # header length as baseline
            for card in cards:
                fd = card.field_data or {}
                val = fd.get(name, '')
                raw_len = len(str(val)) if val else 0
                if raw_len > 0:
                    lengths.append(raw_len)

            # Use 90th percentile to avoid outlier skew
            lengths.sort()
            p90_idx = max(0, int(len(lengths) * 0.9) - 1)
            representative_len = lengths[p90_idx] if lengths else len(name)

            # Apply field-type boosts
            if is_name_addr:
                representative_len = int(representative_len * self.NAME_ADDRESS_BOOST)
            elif is_nowrap:
                representative_len = int(representative_len * self.NOWRAP_BOOST)

            text_weights.append(max(representative_len, 3))

        total_tw = sum(text_weights) or 1
        for idx, i in enumerate(text_indices):
            pct = (text_weights[idx] / total_tw) * remaining_pct
            min_w = self.MIN_NOWRAP_COL_WIDTH if configs[i].get('nowrap') else self.MIN_COL_WIDTH
            configs[i]['width'] = max(min_w, min(pct, self.MAX_COL_WIDTH))

        # Normalize text columns so text + image = 100%
        text_actual = sum(configs[i]['width'] for i in text_indices) or 1
        for i in text_indices:
            configs[i]['width'] = round((configs[i]['width'] / text_actual) * remaining_pct, 2)

        return configs

    @classmethod
    def _wrap_text_for_pdf(cls, text: str, nowrap: bool = False) -> 'mark_safe':
        """Insert word-break opportunities in text for PDF column wrapping.

        Wrapping rules:
        1. Words ≤ 6 chars: NEVER wrap (kept intact).
        2. Words 7+ chars: insert a zero-width space (&#8203;) near the middle
           so the word can break roughly half-above / half-below.
        3. Phone-like tokens (≥60% digits): insert &#8203; every 5 chars
           so a 10-digit number can split 5-above / 5-below.
        4. Natural break opportunities after commas, slashes, colons.
        5. Spaces themselves are break opportunities (replaced with
           space + &#8203;).

        Returns a mark_safe string so Django templates render the HTML.
        """
        import re as _re
        if not text:
            return mark_safe('')
        # Escape HTML entities first to avoid XSS
        safe_text = html_escape(text)
        # Very short values don't need break hints
        if len(text) <= 6:
            return mark_safe(safe_text)

        def _is_phone_like(token):
            """Check if a token is primarily digits (phone, Aadhar, etc.)."""
            if not token:
                return False
            digits = sum(1 for c in token if c.isdigit())
            return digits >= len(token) * 0.6 and digits >= 4

        def _insert_breaks_in_word(word):
            """Insert break opportunities in a single long word.
            Word is already HTML-escaped at this point.
            """
            if len(word) <= 6:
                return word
            if _is_phone_like(word):
                # Phone/numeric: insert break every 5 chars
                parts = []
                for i in range(0, len(word), 5):
                    parts.append(word[i:i+5])
                return '&#8203;'.join(parts)
            # Long word: insert break near the middle
            mid = len(word) // 2
            return word[:mid] + '&#8203;' + word[mid:]

        # Split by spaces first, then process each token
        tokens = safe_text.split(' ')
        processed = []
        for token in tokens:
            if not token:
                processed.append('')
                continue
            # Handle tokens with natural break chars (commas, slashes, etc.)
            # Split on natural boundaries and process sub-parts
            sub_parts = _re.split(r'([,/;:\-])', token)
            result_parts = []
            for sp in sub_parts:
                if sp in (',', '/', ';', ':', '-'):
                    result_parts.append(sp + '&#8203;')
                elif len(sp) > 6:
                    result_parts.append(_insert_breaks_in_word(sp))
                else:
                    result_parts.append(sp)
            processed.append(''.join(result_parts))

        # Join words with space + zero-width space (break opportunity after space)
        return mark_safe(' &#8203;'.join(processed))

    def _build_rows(
        self,
        ordered_fields: List[Dict[str, Any]],
        cards: list,
        column_configs: List[Dict[str, Any]] = None,
    ) -> List[List[Dict[str, Any]]]:
        """
        Build row data for the template.
        Each cell: { align, is_image, content, image_width_cm (for images) }

        PDF-only rule: missing images get a placeholder image.
        """
        # Build a map: field_index → image_width_cm and image_height_cm from column_configs
        # column_configs[0] = Sr No, column_configs[1..] = fields
        image_width_map = {}
        image_height_map = {}
        if column_configs:
            for i, cfg in enumerate(column_configs):
                if cfg.get('is_image'):
                    if 'image_width_cm' in cfg:
                        image_width_map[i - 1] = cfg['image_width_cm']
                    if 'image_height_cm' in cfg:
                        image_height_map[i - 1] = cfg['image_height_cm']

        rows = []

        for sr_no, card in enumerate(cards, start=1):
            fd = card.field_data or {}
            row_cells = []

            # Sr No cell
            row_cells.append({
                'align': 'center',
                'is_image': False,
                'content': str(sr_no),
            })

            for field_idx, field in enumerate(ordered_fields):
                name = field['name']
                is_image = field.get('is_image', False)
                val = fd.get(name, '')

                cell = {
                    'align': 'left' if any(w in name.lower() for w in ['name', 'address']) else 'center',
                    'is_image': is_image,
                    'is_placeholder': False,
                    'content': '',
                }

                if is_image:
                    # Fixed image dimensions from column config
                    cell['image_width_cm'] = image_width_map.get(field_idx, 1.95)
                    cell['image_height_cm'] = image_height_map.get(field_idx, 2.5)

                    # Phase 4: Use thumbnail if available for smaller PDF file size
                    img_path = ImageService.get_image_path_for_export(
                        card=card,
                        field_name=name,
                        prefer_thumbnail=True,
                        fallback_to_field_data=True
                    )
                    if img_path and is_valid_image_path(img_path):
                        abs_path = os.path.join(settings.MEDIA_ROOT, img_path)
                        if os.path.isfile(abs_path):
                            cell['content'] = abs_path
                        else:
                            cell['content'] = _PLACEHOLDER_IMAGE_PATH
                            cell['is_placeholder'] = True
                    else:
                        cell['content'] = _PLACEHOLDER_IMAGE_PATH
                        cell['is_placeholder'] = True
                else:
                    formatted = format_field_value(val, uppercase=True)
                    cell['content'] = self._wrap_text_for_pdf(formatted)

                row_cells.append(cell)

            rows.append(row_cells)

        return rows

    def _group_rows_into_pages(
        self,
        rows: List[List[Dict[str, Any]]],
        cards_list: list,
        class_field_name: Optional[str],
        records_per_page: int = 6,
    ) -> List[List[List[Dict[str, Any]]]]:
        """
        Group rows into pages (sublists).

        Rules:
          1. Max *records_per_page* rows per page.
          2. When the CLASS value changes → force new page.

        Args:
            rows:             Flat list of row data (one per card)
            cards_list:       Matching list of card instances
            class_field_name: Name of the CLASS field, or None
            records_per_page: Fixed rows per page

        Returns:
            List of pages, where each page is a list of rows.
        """
        if not rows:
            return []

        pages: List[List[List[Dict[str, Any]]]] = []
        current_page: List[List[Dict[str, Any]]] = []
        prev_class_val = None

        for idx, row in enumerate(rows):
            card = cards_list[idx]
            fd = card.field_data or {}
            cur_class_val = (
                str(fd.get(class_field_name, '') or '').strip().upper()
                if class_field_name else None
            )

            # Check if we need a new page
            need_new_page = False
            if not current_page:
                need_new_page = False  # first row always goes to first page
            elif len(current_page) >= records_per_page:
                need_new_page = True
            elif class_field_name and prev_class_val is not None and cur_class_val != prev_class_val:
                need_new_page = True

            if need_new_page and current_page:
                pages.append(current_page)
                current_page = []

            current_page.append(row)
            prev_class_val = cur_class_val

        # Don't forget the last page
        if current_page:
            pages.append(current_page)

        return pages


# =============================================================================
# CONVENIENCE FUNCTION (matches pattern of excel.py / word.py)
# =============================================================================

def export_cards_to_pdf(table, cards: QuerySet) -> PdfExportResult:
    """Convenience wrapper for PDF export."""
    exporter = PdfExporter()
    return exporter.export_cards(table, cards)
