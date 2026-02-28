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

from .column_spec import get_column_spec, classify_column, is_nowrap_column

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


def _register_arial_font():
    """Register bundled Arial TTF with reportlab so xhtml2pdf can use it.

    Called once before the first PDF render.  Uses arial.ttf and
    arialbd.ttf from static/fonts/ so it works on both Windows and Linux.
    """
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.fonts import addMapping

    font_dir = os.path.join(settings.BASE_DIR, 'static', 'fonts')
    regular = os.path.join(font_dir, 'arial.ttf')
    bold = os.path.join(font_dir, 'arialbd.ttf')
    if not os.path.isfile(regular):
        logger.warning('Arial font not found at %s — PDF will fall back to Helvetica', regular)
        return
    try:
        pdfmetrics.registerFont(TTFont('Arial', regular))
        if os.path.isfile(bold):
            pdfmetrics.registerFont(TTFont('Arial-Bold', bold))
            addMapping('Arial', 0, 0, 'Arial')
            addMapping('Arial', 1, 0, 'Arial-Bold')
        else:
            addMapping('Arial', 0, 0, 'Arial')
            addMapping('Arial', 1, 0, 'Arial')
    except Exception as exc:
        logger.warning('Could not register Arial font: %s', exc)


# Register Arial once at module load
_register_arial_font()


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
    - Uses bundled Arial TTF font for better Unicode support

    Usage:
        exporter = PdfExporter()
        result = exporter.export_cards(table, cards)
        if result.success:
            return result.response
    """

    # Width boost multiplier for name/address fields
    NAME_ADDRESS_BOOST = 1.5
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
    HEADER_BASE_CM = 0.10  # ~1px top + 1px bottom padding
    HEADER_LINE_CM = 0.22  # ~6.5pt text + leading per line

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
        """Check if a field contains non-wrappable data (phone, DOB, ID numbers, etc.).

        Delegates to column_spec intelligence for semantic detection.
        """
        return is_nowrap_column(field_name)

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
            # At 6.5pt Arial, ~1 uppercase char ≈ 0.145cm
            chars_per_line = max(2, int(usable_cm / 0.145))
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

    @staticmethod
    def _humanize_label(name: str) -> str:
        """Insert spaces into concatenated field names for readable PDF headers.

        Examples:
            PERMANENTADDRESS → PERMANENT ADDRESS
            FATHERNAME       → FATHER NAME
            MOTHERMOBILENO   → MOTHER MOBILE NO
            STUDENTNAME      → STUDENT NAME
            DOB              → DOB  (short words unchanged)
        """
        import re as _re
        # Common word fragments found in Indian school/ID card field names
        # Order matters: longer fragments first to avoid partial matches
        _KNOWN_WORDS = [
            'ADMISSION', 'PERMANENT', 'TEMPORARY', 'PRESENT', 'RESIDENTIAL',
            'STUDENT', 'FATHER', 'MOTHER', 'GUARDIAN', 'HUSBAND',
            'ADDRESS', 'VILLAGE', 'DISTRICT', 'MOBILE', 'CONTACT', 'PHONE',
            'NUMBER', 'SECTION', 'CLASS', 'NAME', 'EMAIL', 'BIRTH',
            'AADHAR', 'AADHAAR', 'PINCODE', 'STATE', 'CITY', 'COUNTRY',
            'BLOOD', 'GROUP', 'GENDER', 'PHOTO', 'IMAGE', 'DATE',
            'JOINING', 'ENROL', 'ROLL', 'CATEGORY', 'CASTE',
            'OCCUPATION', 'QUALIFICATION', 'DESIGNATION', 'RELIGION',
            'NATIONALITY', 'HOUSE', 'WARD', 'BLOCK', 'POST', 'OFFICE',
            'TEHSIL', 'TALUK', 'MANDAL',
            'NEW', 'OLD', 'SR', 'NO', 'ID', 'OF', 'THE',
        ]
        # If the label already has spaces, return as-is
        if ' ' in name.strip():
            return name
        upper = name.upper().strip()
        if len(upper) <= 4:
            return upper
        # Greedy match: repeatedly pull the longest known word from the front
        result_words = []
        remaining = upper
        while remaining:
            matched = False
            for word in _KNOWN_WORDS:
                if remaining.startswith(word):
                    result_words.append(word)
                    remaining = remaining[len(word):]
                    matched = True
                    break
            if not matched:
                # No known word matched — take one character and keep going
                result_words.append(remaining[0])
                remaining = remaining[1:]
        # Merge single leftover characters back into adjacent words
        merged = []
        for w in result_words:
            if len(w) == 1 and merged:
                merged[-1] += w
            else:
                merged.append(w)
        return ' '.join(merged)

    def _build_column_configs(
        self,
        ordered_fields: List[Dict[str, Any]],
        cards: list
    ) -> List[Dict[str, Any]]:
        """
        Calculate dynamic column widths based on field semantics + data content.

        Uses ``column_spec`` intelligence to determine min/max bounds, nowrap
        behaviour, and alignment for every field category.  Then distributes
        remaining page width proportionally (P90 content length).

        Algorithm:
        - Image columns: fixed percentage from subtype dimensions.
        - Text columns: share remaining width proportionally, clamped by
          semantic min/max from ``column_spec``.
        """
        from .column_spec import get_column_spec, classify_column

        # ── Sr No column ────────────────────────────────────────
        sr_spec = get_column_spec('SR NO')
        configs = [{
            'label': 'SR NO',
            'width': 0,
            'align': sr_spec.align,
            'is_image': False,
            'nowrap': not sr_spec.wrap,
        }]

        for field in ordered_fields:
            name = field['name']
            ftype = field.get('type', 'text')
            is_image = field.get('is_image', False)
            spec = get_column_spec(name, ftype)
            configs.append({
                'label': self._humanize_label(name.upper()),
                'width': 0,
                'align': spec.align,
                'is_image': is_image,
                'nowrap': not spec.wrap,
                '_spec': spec,  # carry spec for clamping later
            })

        # ── Auto-detect nowrap from data (safety net) ───────────
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

        # ── Step 1: Fix image column percentages ────────────────
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

        # ── Step 2: Remaining percentage for text columns ───────
        image_pct = sum(configs[i]['width'] for i in image_indices)
        remaining_pct = max(100.0 - image_pct, 20.0)

        # ── Step 3: Compute proportional weights (P90) ──────────
        text_indices = [i for i in range(len(configs)) if i not in image_indices]
        text_weights = []
        for i in text_indices:
            if i == 0:
                # Sr No — use spec pref_chars
                text_weights.append(max(sr_spec.pref_chars, 4))
                continue

            field = ordered_fields[i - 1]
            name = field['name']
            spec = configs[i].get('_spec', get_column_spec(name))

            # Collect value lengths
            lengths = [len(name.upper())]
            for card in cards:
                fd = card.field_data or {}
                val = fd.get(name, '')
                raw_len = len(str(val)) if val else 0
                if raw_len > 0:
                    lengths.append(raw_len)

            # 90th percentile
            lengths.sort()
            p90_idx = max(0, int(len(lengths) * 0.9) - 1)
            representative = lengths[p90_idx] if lengths else spec.pref_chars

            # Clamp to spec's preferred range (semantic intelligence)
            representative = max(representative, spec.min_chars)
            representative = min(representative, spec.max_chars) if spec.max_chars > 0 else representative

            text_weights.append(max(representative, 3))

        total_tw = sum(text_weights) or 1

        # ── Step 4: Distribute width, clamp by spec bounds ──────
        for idx, i in enumerate(text_indices):
            raw_pct = (text_weights[idx] / total_tw) * remaining_pct
            spec = configs[i].get('_spec', sr_spec if i == 0 else get_column_spec(''))
            # Clamp to semantic min/max from column_spec
            clamped = max(spec.pdf_min_pct, min(raw_pct, spec.pdf_max_pct))
            configs[i]['width'] = clamped

        # ── Step 5: Normalise so text + image = 100% ────────────
        text_actual = sum(configs[i]['width'] for i in text_indices) or 1
        for i in text_indices:
            configs[i]['width'] = round((configs[i]['width'] / text_actual) * remaining_pct, 2)

        # Clean up internal helper key
        for cfg in configs:
            cfg.pop('_spec', None)

        return configs

    @classmethod
    def _wrap_text_for_pdf(cls, text: str, nowrap: bool = False, col_width_pct: float = 0) -> 'mark_safe':
        """Context-aware text wrapping for PDF columns.

        xhtml2pdf has very limited CSS word-wrap support, so we:
        1. Strip characters outside the Latin-1 range (0x20-0xFF).
        2. Insert <wbr> inside long unbreakable runs
           so the PDF renderer can break them at column boundaries.
        3. Insert <wbr> at natural boundaries (commas, spaces, slashes).

        The column width percentage is used to estimate how many characters
        fit on one line, so we know when to force-break long words.

        Returns a mark_safe string so Django templates render the HTML.
        """
        import re as _re
        if not text:
            return mark_safe('')

        # ── Step 1: Strip characters outside the safe Latin-1 range.
        # With bundled Arial TTF we get better coverage than Helvetica,
        # but we still restrict to 0x20-0xFF to be safe across all PDF
        # viewers.  Replace unsupported characters with a space so the
        # stored data is never modified — cleaning happens only at
        # PDF render time.
        cleaned_chars = []
        for ch in text:
            cp = ord(ch)
            # Tab / newline / carriage-return → space
            if ch in ('\t', '\n', '\r', '\x0b', '\x0c'):
                cleaned_chars.append(' ')
            # Drop C0 control characters (0x00-0x1F)
            elif cp <= 0x1F:
                continue
            # Printable Basic Latin — always safe
            elif 0x20 <= cp <= 0x7E:
                cleaned_chars.append(ch)
            # Drop C1 control characters (0x80-0x9F) — Windows-1252
            # copy-paste artefacts
            elif 0x80 <= cp <= 0x9F:
                cleaned_chars.append(' ')
            # Latin-1 Supplement printable (0xA0-0xFF) — all in Helvetica
            elif 0xA0 <= cp <= 0xFF:
                cleaned_chars.append(ch)
            else:
                # Everything above U+00FF (Latin Extended, Devanagari,
                # Arabic, CJK, Geometric Shapes ■, zero-width chars,
                # etc.) → replace with space.  This prevents black
                # boxes without altering the database.
                cleaned_chars.append(' ')
        cleaned = ''.join(cleaned_chars)
        # Collapse multiple spaces into one
        cleaned = _re.sub(r' {2,}', ' ', cleaned).strip()

        if not cleaned:
            return mark_safe('')

        # ── Step 2: Escape HTML entities (XSS prevention)
        safe_text = html_escape(cleaned)

        # ── nowrap columns (phone, DOB, Aadhaar, etc.): skip break injection
        if nowrap:
            return mark_safe(safe_text)

        # ── Step 3: Estimate chars-per-line from column width.
        # Landscape A4 content width ≈ 28.7cm.  At 7pt bold Arial,
        # one uppercase char ≈ 0.155cm (slightly wider than Helvetica).
        if col_width_pct > 0:
            col_cm = (col_width_pct / 100) * 28.7
            usable_cm = col_cm - 0.12  # subtract padding + border
            chars_per_line = max(3, int(usable_cm / 0.155))
        else:
            chars_per_line = 16  # conservative default

        # ── Step 4: Force-break long unbreakable runs.
        # Split on whitespace tokens, inject <wbr> inside any "word"
        # longer than chars_per_line so the PDF engine can wrap it.
        # NOTE: Do NOT use &#8203; (zero-width space U+200B) — xhtml2pdf
        # renders it as ■.  Use <wbr> instead.
        WBR = '<wbr>'
        parts = safe_text.split(' ')
        wrapped_parts = []
        for part in parts:
            # Strip any stale <wbr> tags from the part
            raw = part.replace('<wbr>', '').replace('&amp;', '&')
            visible_len = len(html_escape(raw)) if '&' in part else len(part)
            if visible_len > chars_per_line:
                # Force-break: insert <wbr> every chars_per_line characters
                out = []
                count = 0
                i = 0
                while i < len(part):
                    # Skip over HTML entities (e.g. &amp;)
                    if part[i] == '&':
                        end = part.find(';', i)
                        if end != -1:
                            out.append(part[i:end+1])
                            count += 1
                            i = end + 1
                            if count >= chars_per_line:
                                out.append(WBR)
                                count = 0
                            continue
                    out.append(part[i])
                    count += 1
                    if count >= chars_per_line:
                        out.append(WBR)
                        count = 0
                    i += 1
                wrapped_parts.append(''.join(out))
            else:
                wrapped_parts.append(part)

        safe_text = ' '.join(wrapped_parts)

        # ── Step 5: Insert <wbr> at natural break characters: , / ; :
        safe_text = _re.sub(r'([,/;:])', r'\1<wbr>', safe_text)

        return mark_safe(safe_text)

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
                ftype = field.get('type', 'text')

                # Use column_spec for semantic alignment
                spec = get_column_spec(name, ftype)

                cell = {
                    'align': spec.align,
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
                    # Pass column width so wrapping can estimate chars-per-line
                    col_cfg_idx = field_idx + 1  # +1 because configs[0] = Sr No
                    col_w = column_configs[col_cfg_idx]['width'] if column_configs and col_cfg_idx < len(column_configs) else 0
                    is_nowrap = column_configs[col_cfg_idx].get('nowrap', False) if column_configs and col_cfg_idx < len(column_configs) else False
                    cell['content'] = self._wrap_text_for_pdf(formatted, nowrap=is_nowrap, col_width_pct=col_w)

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
