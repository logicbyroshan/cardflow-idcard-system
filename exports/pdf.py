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
- Phase 4: Uses original images (never thumbnails)
"""
import os
import io
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from datetime import datetime

from django.conf import settings
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.db.models import QuerySet

from mediafiles.services import ImageService

from .utils import (
    separate_fields_by_type,
    generate_export_filename,
    format_field_value,
    is_valid_image_path,
    sort_cards_for_export,
    get_class_field_name,
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
        else:
            # Fallback for dev: use STATICFILES_DIRS
            for sdir in getattr(settings, 'STATICFILES_DIRS', []):
                candidate = os.path.join(sdir, uri.replace(settings.STATIC_URL, ''))
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
    # Image column weight (fixed)
    IMAGE_COLUMN_WEIGHT = 25
    # Column width bounds (percentage)
    MIN_COL_WIDTH = 3.5
    MAX_COL_WIDTH = 25.0
    # Landscape A4 content width (29.7cm page - 1cm left - 1cm right margins)
    PAGE_CONTENT_WIDTH_CM = 27.7

    def export_cards(
        self,
        table,
        cards: QuerySet,
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

            # Sort cards for export (Class → Name, or Name only)
            cards_list = sort_cards_for_export(list(cards), table.fields)
            column_configs = self._build_column_configs(ordered_fields, cards_list)

            # Build row data (with placeholder images for missing photos)
            rows = self._build_rows(ordered_fields, cards_list)

            # Group rows into pages (6 per page, class-break aware)
            class_field_name = get_class_field_name(table.fields)
            pages = self._group_rows_into_pages(
                rows, cards_list, class_field_name, records_per_page=6
            )

            # Get institution name
            institution_name = "Institution"
            if table.group and table.group.client:
                institution_name = table.group.client.name

            # Get dynamic export settings
            from core.models import SystemSettings
            export_settings = SystemSettings.get_export_settings()

            # Render HTML
            context = {
                'columns': column_configs,
                'pages': pages,
                'institution_name': institution_name,
                'table_name': table.name,
                'current_date': datetime.now().strftime('%d-%m-%Y'),
                'generated_at': datetime.now().strftime('%d-%b-%Y %I:%M %p'),
                'export_note_line': export_settings.get('export_note_line', 'Note: This document is computer generated. Please verify all details before printing ID cards.'),
                'export_copyright_line': export_settings.get('export_copyright_line', '© Adarsh ID Cards Management System'),
            }

            html = render_to_string('exports/pdf_report.html', context)

            # Generate PDF
            response = HttpResponse(content_type='application/pdf')
            filename = generate_export_filename(table.name, 'pdf', client_name=institution_name)
            response['Content-Disposition'] = f'attachment; filename="{filename}"'

            pisa_status = pisa.CreatePDF(
                io.BytesIO(html.encode('UTF-8')),
                dest=response,
                link_callback=_link_callback
            )

            if pisa_status.err:
                logger.error("PDF generation error: %s", pisa_status.err)
                return PdfExportResult(
                    success=False,
                    message='Error generating PDF. Check server logs.'
                )

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
                img_path = ImageService.get_image_path_for_card(
                    card=card, field_name=field_name, fallback_to_field_data=True
                )
                if img_path and is_valid_image_path(img_path):
                    abs_path = os.path.join(settings.MEDIA_ROOT, img_path)
                    if os.path.isfile(abs_path):
                        with open(abs_path, 'rb') as f:
                            img = PILImage.open(f)
                            w, h = img.size
                            img.close()
                            if h > 0:
                                return IMAGE_HEIGHT * (w / h)
        except Exception:
            pass
        return IMAGE_HEIGHT * DEFAULT_RATIO

    def _build_column_configs(
        self,
        ordered_fields: List[Dict[str, Any]],
        cards: list
    ) -> List[Dict[str, Any]]:
        """
        Calculate dynamic column widths based on data content.
        
        Image columns: fixed percentage = (rendered_width + 0.1cm) / page_width
        Text columns: share remaining percentage proportionally
        """
        # Build column metadata
        configs = [{
            'label': 'SR NO',
            'width': 0,
            'align': 'center',
            'is_image': False,
        }]

        for field in ordered_fields:
            name = field['name']
            is_image = field.get('is_image', False)
            align = 'left' if any(w in name.lower() for w in ['name', 'address']) else 'center'
            configs.append({
                'label': name.upper(),
                'width': 0,
                'align': align,
                'is_image': is_image,
            })

        # Step 1: Fix image column percentages from actual image dimensions
        # 1mm padding on left + right = 0.2cm extra
        IMAGE_CELL_PADDING_CM = 0.2
        image_indices = set()
        for i, cfg in enumerate(configs):
            if cfg['is_image']:
                image_indices.add(i)
                field = ordered_fields[i - 1]  # offset for Sr No at index 0
                render_w = self._get_image_render_width_cm(cards, field['name'])
                cfg['width'] = ((render_w + IMAGE_CELL_PADDING_CM) / self.PAGE_CONTENT_WIDTH_CM) * 100

        # Step 2: Remaining percentage for text columns
        image_pct = sum(configs[i]['width'] for i in image_indices)
        remaining_pct = max(100.0 - image_pct, 20.0)

        # Step 3: Proportional text column weights
        text_indices = [i for i in range(len(configs)) if i not in image_indices]
        text_weights = []
        for i in text_indices:
            if i == 0:
                text_weights.append(len('SR NO'))
            else:
                field = ordered_fields[i - 1]
                name = field['name']
                max_len = len(name.upper())
                for card in cards:
                    fd = card.field_data or {}
                    val = fd.get(name, '')
                    length = len(str(val)) if val else 0
                    if any(w in name.lower() for w in ['name', 'address', 'email']):
                        length = int(length * self.NAME_ADDRESS_BOOST)
                    max_len = max(max_len, length)
                text_weights.append(max_len)

        total_tw = sum(text_weights) or 1
        for idx, i in enumerate(text_indices):
            pct = (text_weights[idx] / total_tw) * remaining_pct
            configs[i]['width'] = max(self.MIN_COL_WIDTH, min(pct, self.MAX_COL_WIDTH))

        # Normalize text columns so text + image = 100%
        text_actual = sum(configs[i]['width'] for i in text_indices) or 1
        for i in text_indices:
            configs[i]['width'] = (configs[i]['width'] / text_actual) * remaining_pct

        return configs

    def _build_rows(
        self,
        ordered_fields: List[Dict[str, Any]],
        cards: list
    ) -> List[List[Dict[str, Any]]]:
        """
        Build row data for the template.
        Each cell: { align, is_image, content }

        PDF-only rule: missing images get a placeholder image.
        """
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

            for field in ordered_fields:
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
                    # Get original image path (Phase 4: never thumbnail)
                    img_path = ImageService.get_image_path_for_card(
                        card=card,
                        field_name=name,
                        fallback_to_field_data=True
                    )
                    if img_path and is_valid_image_path(img_path):
                        # Resolve to absolute filesystem path for xhtml2pdf
                        abs_path = os.path.join(settings.MEDIA_ROOT, img_path)
                        if os.path.isfile(abs_path):
                            cell['content'] = abs_path
                        else:
                            # File missing on disk → placeholder
                            cell['content'] = _PLACEHOLDER_IMAGE_PATH
                            cell['is_placeholder'] = True
                    else:
                        # No image data at all → placeholder
                        cell['content'] = _PLACEHOLDER_IMAGE_PATH
                        cell['is_placeholder'] = True
                else:
                    cell['content'] = format_field_value(val, uppercase=True)

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
