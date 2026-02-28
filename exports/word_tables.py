"""
Word Export — Tables Mixin

Data table creation, column width calculation, header/data row rendering,
and text preparation for Word document generation.
"""
from django.core.files.storage import default_storage

from mediafiles.services import ImageService

from .utils import is_valid_image_path, format_field_value
from .column_spec import get_column_spec, is_nowrap_column


class WordTablesMixin:
    """Mixin providing data table construction and row rendering methods."""

    def _get_image_render_width_cm(self, cards_list, field_name):
        """Compute rendered image width at IMAGE_HEIGHT_CM from first valid image.
        
        Used to size image columns to: rendered_width + 0.1 cm.
        Falls back to 3:4 portrait ratio (standard ID photo) if no image found.
        """
        DEFAULT_RATIO = 0.75  # 3:4 portrait
        try:
            from PIL import Image as PILImage
            for card in cards_list[:10]:
                # Phase 3: DOCX uses original images for sizing reference
                img_path = ImageService.get_image_path_for_export(
                    card=card, field_name=field_name, 
                    prefer_thumbnail=False, fallback_to_field_data=True
                )
                if img_path and is_valid_image_path(img_path):
                    if default_storage.exists(img_path):
                        with default_storage.open(img_path, 'rb') as f:
                            with PILImage.open(f) as img:
                                w, h = img.size
                                if h > 0:
                                    return self.IMAGE_HEIGHT_CM * (w / h)
        except Exception:
            pass
        return self.IMAGE_HEIGHT_CM * DEFAULT_RATIO
    
    def _calculate_column_widths(self, ordered_fields, cards, num_cols):
        """Calculate optimal column widths based on column_spec intelligence + data.

        Uses ``column_spec`` semantic min/max bounds per field category,
        combined with P90 content length for proportional distribution.

        Algorithm:
        - Image columns: fixed width from subtype dimensions + 0.1 cm.
        - Text columns: share remaining page width proportionally,
          clamped by word_min_cm / word_max_cm from column_spec.
        """
        # Step 1: Compute fixed widths for image columns
        image_widths = {}
        for idx, field in enumerate(ordered_fields):
            if field['is_image']:
                render_w = field.get('image_width_cm', self.IMAGE_DEFAULT_WIDTH_CM)
                image_widths[1 + idx] = render_w + 0.1

        # Step 2: Remaining page width for text + Sr No columns
        used_by_images = sum(image_widths.values())
        remaining = max(self.PAGE_WIDTH_CM - used_by_images, 5.0)

        # Step 3: Collect P90 value lengths per text column and compute weights
        text_weights = {}
        text_specs = {}

        # Sr No column
        sr_spec = get_column_spec('SR NO')
        text_weights[0] = max(sr_spec.pref_chars, 4)
        text_specs[0] = sr_spec

        for idx, field in enumerate(ordered_fields):
            if not field['is_image']:
                name = field['name']
                ftype = field.get('type', 'text')
                spec = get_column_spec(name, ftype)
                text_specs[1 + idx] = spec

                lengths = [len(name)]  # header length as baseline
                for card in cards:
                    fd = card.field_data or {}
                    val = str(fd.get(name, '') or '')
                    if val:
                        lengths.append(len(val))

                # 90th percentile
                lengths.sort()
                p90_idx = max(0, int(len(lengths) * 0.9) - 1)
                representative = lengths[p90_idx] if lengths else spec.pref_chars

                # Clamp to spec char range
                representative = max(representative, spec.min_chars)
                if spec.max_chars > 0:
                    representative = min(representative, spec.max_chars)

                text_weights[1 + idx] = max(representative, 3)

        total_text_w = sum(text_weights.values()) or 1

        # Step 4: Build final widths — proportional, then clamp by spec
        column_widths = {}
        for col_idx in range(num_cols):
            if col_idx in image_widths:
                column_widths[col_idx] = image_widths[col_idx]
            elif col_idx in text_weights:
                raw_cm = (text_weights[col_idx] / total_text_w) * remaining
                spec = text_specs.get(col_idx, sr_spec)
                clamped = max(spec.word_min_cm, min(raw_cm, spec.word_max_cm))
                column_widths[col_idx] = clamped
            else:
                column_widths[col_idx] = 1.5

        # Normalize text column widths so they exactly fill remaining space
        text_total = sum(column_widths[k] for k in text_weights)
        if text_total > 0:
            scale = remaining / text_total
            for k in text_weights:
                column_widths[k] = round(column_widths[k] * scale, 2)

        return column_widths

    @classmethod
    def _is_nowrap_field_word(cls, field_name: str) -> bool:
        """Check if a field contains non-wrappable data (phone, DOB, etc.).

        Delegates to column_spec intelligence.
        """
        return is_nowrap_column(field_name)
    
    def _create_data_tables(self, doc, cards_list, ordered_fields, column_widths,
                            num_cols, Cm, Pt, RGBColor, WD_TABLE_ALIGNMENT,
                            WD_ALIGN_PARAGRAPH, parse_xml, nsdecls, OxmlElement,
                            qn, Image, ImageOps, class_field_name=None):
        """Create ONE continuous table with all card data.

        The table is never split into separate tables, so selecting a
        row in Word lets you extend the selection to the very last row.

        Page-break rules (inserted inside the table via pageBreakBefore):
          1. Every ENTRIES_PER_PAGE rows → page break before next row
          2. When class value changes → force page break even if current
             page has room

        The column-heading row appears on the first page ONLY.
        """
        sr_no = 1
        rows_on_current_page = 0
        prev_class_val = None

        # Pre-compute fixed image dimensions per image field (from subtype)
        image_fixed_widths = {}
        image_fixed_heights = {}
        max_image_height = 0
        for field in ordered_fields:
            if field['is_image']:
                w = field.get('image_width_cm', self.IMAGE_DEFAULT_WIDTH_CM)
                h = field.get('image_height_cm', self.IMAGE_HEIGHT_CM)
                image_fixed_widths[field['name']] = w
                image_fixed_heights[field['name']] = h
                max_image_height = max(max_image_height, h)
        # Dynamic row height: tallest image + minimal padding, or default 0.8cm
        row_height_cm = round(max_image_height + 0.15, 2) if max_image_height > 0 else 0.8

        # Create ONE table with a header row
        table_obj = doc.add_table(rows=1, cols=num_cols)
        table_obj.style = 'Table Grid'
        table_obj.alignment = WD_TABLE_ALIGNMENT.CENTER
        self._set_table_borders(table_obj, parse_xml, nsdecls)

        # Style the single header row (first page only — NOT set to repeat)
        self._style_header_row(
            table_obj.rows[0].cells, ordered_fields, column_widths,
            Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls
        )

        for card_idx, card in enumerate(cards_list):
            fd = card.field_data or {}
            cur_class_val = (
                str(fd.get(class_field_name, '') or '').strip().upper()
                if class_field_name else None
            )

            # Decide whether to insert a page break before this row
            # Note: class-based page breaks are PDF-only; Word uses
            # continuous layout so all data flows without class gaps.
            need_page_break = False
            if rows_on_current_page >= self.ENTRIES_PER_PAGE:
                need_page_break = True

            # Add the data row
            self._add_data_row(
                table_obj, card, ordered_fields, column_widths, sr_no,
                Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls,
                Image, ImageOps, image_fixed_widths=image_fixed_widths,
                image_fixed_heights=image_fixed_heights, row_height_cm=row_height_cm
            )

            # If a page break is needed, set it on the FIRST paragraph
            # of the first cell of the row we just added.
            if need_page_break:
                new_row = table_obj.rows[-1]
                first_para = new_row.cells[0].paragraphs[0]
                pPr = first_para._p.get_or_add_pPr()
                pPr.append(parse_xml(
                    r'<w:pageBreakBefore {} />'.format(nsdecls('w'))
                ))
                rows_on_current_page = 0

            sr_no += 1
            rows_on_current_page += 1
            prev_class_val = cur_class_val
    
    def _style_header_row(self, cells, ordered_fields, column_widths,
                          Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls):
        """Style the header row of a table."""
        col_idx = 0
        
        # Sr No header
        cells[col_idx].text = 'Sr No.'
        self._style_header_cell(cells[col_idx], column_widths[col_idx],
                                Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls)
        col_idx += 1
        
        # Field headers
        for field in ordered_fields:
            cells[col_idx].text = field['name']
            self._style_header_cell(cells[col_idx], column_widths[col_idx],
                                    Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls)
            col_idx += 1
    
    def _style_header_cell(self, cell, width, Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH,
                           parse_xml, nsdecls):
        """Apply styling to a header cell with wrapping and padding."""
        para = cell.paragraphs[0]
        if para.runs:
            run = para.runs[0]
            run.bold = True
            run.font.name = 'Arial'
            run.font.size = Pt(9)
            run.font.color.rgb = RGBColor(0, 0, 0)
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        # Adequate padding so header text never touches cell borders
        self._set_cell_margins(cell, parse_xml, nsdecls, 28, 28, 42, 42)
        self._set_cell_vertical_align(cell, parse_xml, nsdecls)
        self._set_para_spacing(para, parse_xml, nsdecls)
        cell.width = Cm(width)
        # Ensure cell allows text wrapping (no nowrap)
        tcPr = cell._tc.get_or_add_tcPr()
        # Remove any noWrap flags
        from lxml import etree
        from docx.oxml.ns import qn as _qn
        for nw in tcPr.findall(_qn('w:noWrap')):
            tcPr.remove(nw)
    
    def _add_data_row(self, table, card, ordered_fields, column_widths, sr_no,
                      Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls,
                      Image, ImageOps, image_fixed_widths=None,
                      image_fixed_heights=None, row_height_cm=None):
        """Add a data row to the table."""
        new_row = table.add_row()
        cells = new_row.cells
        
        # Set row height — "atLeast" so text can wrap and expand if needed
        tr = new_row._tr
        trPr = tr.get_or_add_trPr()
        effective_row_h = row_height_cm if row_height_cm else self.ROW_HEIGHT_CM
        row_height_twips = int(Cm(effective_row_h).twips)
        trHeight = parse_xml(
            r'<w:trHeight {} w:val="{}" w:hRule="atLeast"/>'.format(nsdecls('w'), row_height_twips)
        )
        trPr.append(trHeight)
        
        col_idx = 0
        field_data = card.field_data or {}
        if image_fixed_widths is None:
            image_fixed_widths = {}
        if image_fixed_heights is None:
            image_fixed_heights = {}
        
        # Sr No
        cells[col_idx].text = str(sr_no)
        self._style_data_cell(cells[col_idx], column_widths[col_idx], False,
                              Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls)
        cells[col_idx].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        col_idx += 1
        
        # Field values
        for field in ordered_fields:
            cell = cells[col_idx]
            cell.width = Cm(column_widths[col_idx])
            
            if field['is_image']:
                # Phase 3: DOCX always uses ORIGINAL images for print quality
                image_path = ImageService.get_image_path_for_export(
                    card=card,
                    field_name=field['name'],
                    prefer_thumbnail=False,
                    fallback_to_field_data=True
                )
                img_fixed_w = image_fixed_widths.get(field['name'], self.IMAGE_DEFAULT_WIDTH_CM)
                img_fixed_h = image_fixed_heights.get(field['name'], self.IMAGE_HEIGHT_CM)
                self._add_image_to_cell(
                    cell, image_path or '',
                    Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls,
                    Image, ImageOps, fixed_width_cm=img_fixed_w,
                    fixed_height_cm=img_fixed_h
                )
            else:
                value = format_field_value(field_data.get(field['name'], ''), uppercase=True)
                value = self._prepare_text_for_word(value)
                cell.text = value
                self._style_data_cell(cell, column_widths[col_idx], False,
                                      Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls)
            
            col_idx += 1
    
    @staticmethod
    def _prepare_text_for_word(text: str) -> str:
        """Insert soft hyphens in long words so Word can break them gracefully.

        Rules:
        1. Words ≤ 6 chars: NEVER break.
        2. Words 7+ chars: insert soft hyphen (U+00AD) near the middle
           so Word breaks half-above / half-below when the column is narrow.
        3. Phone-like tokens (≥60% digits, ≥4 digits): insert soft hyphen
           every 5 chars (5 above / 5 below in rare cases).
        4. Natural separators (,  /  ;  :) already act as break opportunities.
        """
        import re as _re
        if not text or len(text) <= 6:
            return text

        SOFT_HYPHEN = '\u00AD'

        def _is_phone_like(token):
            if not token:
                return False
            digits = sum(1 for c in token if c.isdigit())
            return digits >= len(token) * 0.6 and digits >= 4

        def _break_word(word):
            if len(word) <= 6:
                return word
            if _is_phone_like(word):
                parts = []
                for i in range(0, len(word), 5):
                    parts.append(word[i:i+5])
                return SOFT_HYPHEN.join(parts)
            mid = len(word) // 2
            return word[:mid] + SOFT_HYPHEN + word[mid:]

        tokens = text.split(' ')
        processed = []
        for token in tokens:
            if not token or len(token) <= 6:
                processed.append(token)
                continue
            # Split on natural separators, process sub-parts
            sub_parts = _re.split(r'([,/;:\-])', token)
            result = []
            for sp in sub_parts:
                if sp in (',', '/', ';', ':', '-'):
                    result.append(sp)
                elif len(sp) > 6:
                    result.append(_break_word(sp))
                else:
                    result.append(sp)
            processed.append(''.join(result))
        return ' '.join(processed)
