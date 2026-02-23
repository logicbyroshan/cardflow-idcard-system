"""
Word Export Module

Handles DOCX file generation for ID card data.
This module is READ-ONLY - it never mutates data.

Features:
- Landscape A4 format with 1cm margins
- Header with institution name, table name, date, and branding
- Footer with note, timestamp, and page numbers
- Table with text fields on left, image fields on right
- Auto-sized columns based on content
- 7 entries per page with proper pagination
- Image embedding with borders
- Phase 4: Uses THUMBNAILS for optimized export file size
"""
import logging
from io import BytesIO
from typing import Optional
from dataclasses import dataclass
from datetime import datetime

from django.utils import timezone
from django.http import HttpResponse
from django.db.models import QuerySet
from django.core.files.storage import default_storage

from mediafiles.services import ImageService

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


@dataclass
class WordExportResult:
    """Result of a Word export operation."""
    success: bool
    message: str = ''
    response: Optional[HttpResponse] = None
    filename: str = ''
    card_count: int = 0


class WordExporter:
    """
    Handles Word (DOCX) export operations.
    
    Features:
    - Landscape orientation for data tables
    - Exports both text and image fields
    - Professional formatting with headers/footers
    - 7 entries per page
    
    Usage:
        exporter = WordExporter()
        result = exporter.export_cards(table, cards)
        if result.success:
            return result.response
    """
    
    ENTRIES_PER_PAGE = 7
    IMAGE_HEIGHT_CM = 2.5
    ROW_HEIGHT_CM = 2.5
    PAGE_WIDTH_CM = 27.5  # Landscape A4 with margins
    # Phase 3: DOCX always uses ORIGINAL images for full quality print.
    # PDF uses thumbnails. ZIP uses originals.
    
    def export_cards(
        self,
        table,
        cards: QuerySet,
        doc_format: str = 'docx',
        status: str = '',
        template_id: int = None
    ) -> WordExportResult:
        """
        Export cards to Word format.
        
        Args:
            table: IDCardTable instance
            cards: QuerySet of IDCard instances
            doc_format: Output format ('docx' or 'doc')
            
        Returns:
            WordExportResult with HttpResponse if successful
        """
        try:
            from docx import Document
            from docx.shared import Inches, Cm, Pt, RGBColor
            from docx.enum.table import WD_TABLE_ALIGNMENT
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            from docx.enum.section import WD_ORIENT
            from docx.oxml.ns import nsdecls, qn
            from docx.oxml import parse_xml, OxmlElement
        except ImportError:
            return WordExportResult(
                success=False,
                message='python-docx library not installed. Run: pip install python-docx'
            )
        
        try:
            from PIL import Image, ImageOps
        except ImportError:
            return WordExportResult(
                success=False,
                message='Pillow library not installed. Run: pip install Pillow'
            )
        
        if not cards.exists():
            return WordExportResult(
                success=False,
                message='No cards to export!'
            )

        # Hard cap to prevent OOM — python-docx embeds all images in memory
        MAX_WORD_CARDS = 5000
        card_count = cards.count()
        if card_count > MAX_WORD_CARDS:
            return WordExportResult(
                success=False,
                message=f'Word export limited to {MAX_WORD_CARDS} cards (requested {card_count}). Use Excel or reduce your selection.'
            )
        
        try:
            # Separate fields by type: text fields first, then image fields
            field_info = separate_fields_by_type(table.fields or [])
            text_fields = field_info['text']
            image_fields = field_info['image']
            ordered_fields = text_fields + image_fields
            
            # Get institution name
            institution_name = "Institution"
            if table.group and table.group.client:
                institution_name = table.group.client.name
            
            # Create document
            doc = Document()
            
            # Setup page (landscape A4 with margins)
            self._setup_page(doc, Cm, WD_ORIENT, parse_xml, nsdecls)
            
            # Add header
            self._add_header(
                doc, institution_name, table.name,
                Cm, Pt, RGBColor, WD_TABLE_ALIGNMENT, WD_ALIGN_PARAGRAPH,
                parse_xml, nsdecls
            )
            
            # Add footer
            self._add_footer(
                doc, Pt, RGBColor, WD_ALIGN_PARAGRAPH,
                parse_xml, nsdecls, OxmlElement, qn
            )
            
            # Sort cards for export (Class → Name, or Name only)
            cards_list = sort_cards_for_export(list(cards), table.fields)
            num_cols = 1 + len(ordered_fields)  # Sr No + fields
            column_widths = self._calculate_column_widths(
                ordered_fields, cards_list, num_cols
            )
            
            # Remove default empty paragraph
            if doc.paragraphs:
                p = doc.paragraphs[0]._element
                p.getparent().remove(p)
            
            # Create tables with data (page-break per N rows)
            class_field_name = get_class_field_name(table.fields)
            self._create_data_tables(
                doc, cards_list, ordered_fields, column_widths, num_cols,
                Cm, Pt, RGBColor, WD_TABLE_ALIGNMENT, WD_ALIGN_PARAGRAPH,
                parse_xml, nsdecls, OxmlElement, qn, Image, ImageOps,
                class_field_name=class_field_name
            )
            
            # Add template instructions (if a template was selected)
            if template_id:
                self._add_template_instructions(
                    doc, template_id, Pt, RGBColor, WD_ALIGN_PARAGRAPH,
                    parse_xml, nsdecls
                )
            
            # Set Word 97-2003 compatibility mode
            self._set_compatibility_mode(doc)
            
            # Save document
            doc_buffer = BytesIO()
            doc.save(doc_buffer)
            doc_buffer.seek(0)
            
            # Generate filename and content type
            extension = 'doc' if doc_format == 'doc' else 'docx'
            filename = generate_export_filename(table.name, extension, client_name=institution_name, status=status)
            
            # python-docx always produces DOCX (OOXML) format regardless of extension
            content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            
            # Use chunked streaming for large files
            doc_bytes = doc_buffer.getvalue()
            doc_buffer.close()
            response = stream_file_response(doc_bytes, filename, content_type)
            
            return WordExportResult(
                success=True,
                response=response,
                filename=filename,
                card_count=len(cards_list)
            )
            
        except Exception as e:
            logger.error("Word export failed: %s", e, exc_info=True)
            return WordExportResult(
                success=False,
                message='Word export failed. Please try again or contact support.'
            )
    
    def _setup_page(self, doc, Cm, WD_ORIENT, parse_xml, nsdecls):
        """Configure page to landscape A4 with margins."""
        section = doc.sections[0]
        
        # Swap width and height for landscape
        new_width = section.page_height
        new_height = section.page_width
        section.page_width = new_width
        section.page_height = new_height
        section.orientation = WD_ORIENT.LANDSCAPE
        
        # Set margins
        section.left_margin = Cm(1)
        section.right_margin = Cm(1)
        section.top_margin = Cm(0.8)
        section.bottom_margin = Cm(0.3)
        section.header_distance = Cm(0.3)
        section.footer_distance = Cm(1)
    
    def _add_header(self, doc, institution_name, table_name, Cm, Pt, RGBColor,
                    WD_TABLE_ALIGNMENT, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls):
        """Add document header on FIRST PAGE ONLY."""
        section = doc.sections[0]

        # Enable different first-page header so header shows only on page 1
        section.different_first_page_header_footer = True

        header = section.first_page_header
        header.is_linked_to_previous = False
        
        current_date = timezone.localtime(timezone.now()).strftime('%d-%m-%Y')
        
        # Create header table (2 cm narrower than page, centered)
        header_width = 25.5  # 27.5 - 2 = 25.5 cm
        header_table = header.add_table(rows=1, cols=3, width=Cm(header_width))
        header_table.autofit = False
        header_table.alignment = WD_TABLE_ALIGNMENT.CENTER
        header_cells = header_table.rows[0].cells
        
        # Set column widths (proportionally scaled to 25.5 cm)
        header_cells[0].width = Cm(8.5)
        header_cells[1].width = Cm(10)
        header_cells[2].width = Cm(7)
        
        # Left: Institution name
        left_para = header_cells[0].paragraphs[0]
        left_run = left_para.add_run(f'INSTITUTE NAME: {institution_name}')
        left_run.bold = True
        left_run.font.name = 'Arial'
        left_run.font.size = Pt(10)
        left_run.font.color.rgb = RGBColor(0, 0, 0)
        left_para.alignment = WD_ALIGN_PARAGRAPH.LEFT
        self._set_para_spacing(left_para, parse_xml, nsdecls)
        
        # Center: Table name and date
        center_para = header_cells[1].paragraphs[0]
        center_run = center_para.add_run(f'{table_name} ({current_date})')
        center_run.bold = True
        center_run.font.name = 'Arial'
        center_run.font.size = Pt(11)
        center_run.font.color.rgb = RGBColor(0, 0, 0)
        center_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        self._set_para_spacing(center_para, parse_xml, nsdecls)
        
        # Right: Branding
        right_para = header_cells[2].paragraphs[0]
        right_run = right_para.add_run('ADARSH ID CARDS')
        right_run.bold = True
        right_run.font.name = 'Arial'
        right_run.font.size = Pt(10)
        right_run.font.color.rgb = RGBColor(0, 0, 0)
        right_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        self._set_para_spacing(right_para, parse_xml, nsdecls)
        
        # Remove borders and center vertically
        for cell in header_cells:
            self._remove_cell_borders(cell, parse_xml, nsdecls)
    
    def _add_footer(self, doc, Pt, RGBColor, WD_ALIGN_PARAGRAPH,
                    parse_xml, nsdecls, OxmlElement, qn):
        """Add document footer with note and page numbers."""
        from core.models import SystemSettings
        export_settings = SystemSettings.get_export_settings()
        
        section = doc.sections[0]
        footer = section.footer
        footer.is_linked_to_previous = False
        
        # Line 1: Note (dynamic from settings)
        note_line = export_settings.get('export_note_line', 'Note: This document is computer generated. Please verify all details before printing ID cards.')
        footer_para1 = footer.add_paragraph()
        footer_run1 = footer_para1.add_run(note_line)
        footer_run1.font.name = 'Arial'
        footer_run1.font.size = Pt(7)
        footer_run1.font.color.rgb = RGBColor(0, 0, 0)
        footer_para1.alignment = WD_ALIGN_PARAGRAPH.LEFT
        self._set_para_spacing(footer_para1, parse_xml, nsdecls, line=180)
        
        # Line 2: Generated date and page numbers
        footer_para2 = footer.add_paragraph()
        self._set_para_spacing(footer_para2, parse_xml, nsdecls, line=180)
        
        # Add tab stop
        pPr = footer_para2._p.get_or_add_pPr()
        tabs = parse_xml(
            r'<w:tabs {}><w:tab w:val="right" w:pos="14400"/></w:tabs>'.format(nsdecls('w'))
        )
        pPr.append(tabs)
        
        # Left: Generated timestamp + copyright (dynamic from settings)
        copyright_line = export_settings.get('export_copyright_line', '© Adarsh ID Cards Management System - All Rights Reserved')
        timestamp = timezone.localtime(timezone.now()).strftime('%d-%b-%Y %H:%M')
        left_run = footer_para2.add_run(
            f'Generated on: {timestamp} | {copyright_line}'
        )
        left_run.font.name = 'Arial'
        left_run.font.size = Pt(7)
        left_run.font.color.rgb = RGBColor(0, 0, 0)
        
        # Tab
        footer_para2.add_run('\t')
        
        # Page X of Y
        self._add_page_numbers(footer_para2, Pt, RGBColor, OxmlElement, qn)
    
    def _add_page_numbers(self, para, Pt, RGBColor, OxmlElement, qn):
        """Add Page X of Y fields to paragraph."""
        # "Page " text
        page_run = para.add_run('Page ')
        page_run.font.name = 'Arial'
        page_run.font.size = Pt(9)
        page_run.font.bold = True
        page_run.font.color.rgb = RGBColor(0, 0, 0)
        
        # PAGE field
        self._add_field(para, 'PAGE', Pt, OxmlElement, qn)
        
        # " of " text
        of_run = para.add_run(' of ')
        of_run.font.name = 'Arial'
        of_run.font.size = Pt(9)
        of_run.font.bold = True
        of_run.font.color.rgb = RGBColor(0, 0, 0)
        
        # NUMPAGES field
        self._add_field(para, 'NUMPAGES', Pt, OxmlElement, qn)
    
    def _add_field(self, para, field_name, Pt, OxmlElement, qn):
        """Add a Word field (PAGE, NUMPAGES, etc.) to paragraph."""
        fldChar1 = OxmlElement('w:fldChar')
        fldChar1.set(qn('w:fldCharType'), 'begin')
        
        instrText = OxmlElement('w:instrText')
        instrText.set(qn('xml:space'), 'preserve')
        instrText.text = field_name
        
        fldChar2 = OxmlElement('w:fldChar')
        fldChar2.set(qn('w:fldCharType'), 'separate')
        
        fldChar3 = OxmlElement('w:fldChar')
        fldChar3.set(qn('w:fldCharType'), 'end')
        
        run = para.add_run()
        run.font.size = Pt(9)
        run.font.bold = True
        run._r.append(fldChar1)
        run._r.append(instrText)
        run._r.append(fldChar2)
        run._r.append(fldChar3)
    
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
        """Calculate optimal column widths based on content.
        
        Image columns: fixed width = rendered image width + 0.1 cm
        Text columns: share remaining page width proportionally
        """
        # Step 1: Compute fixed widths for image columns
        image_widths = {}
        for idx, field in enumerate(ordered_fields):
            if field['is_image']:
                render_w = self._get_image_render_width_cm(cards, field['name'])
                image_widths[1 + idx] = render_w + 0.1
        
        # Step 2: Remaining page width for text + Sr No columns
        used_by_images = sum(image_widths.values())
        remaining = max(self.PAGE_WIDTH_CM - used_by_images, 5.0)
        
        # Step 3: Proportional text column weights
        text_weights = {0: 5}  # Sr No column
        for idx, field in enumerate(ordered_fields):
            if not field['is_image']:
                max_len = len(field['name'])
                for card in cards:
                    fd = card.field_data or {}
                    value = str(fd.get(field['name'], ''))
                    max_len = max(max_len, len(value))
                text_weights[1 + idx] = min(max_len, 50)
        
        total_text_w = sum(text_weights.values()) or 1
        
        # Step 4: Build final widths
        column_widths = {}
        for col_idx in range(num_cols):
            if col_idx in image_widths:
                column_widths[col_idx] = image_widths[col_idx]
            elif col_idx in text_weights:
                w = (text_weights[col_idx] / total_text_w) * remaining
                column_widths[col_idx] = max(1.5, min(w, 8.0))
            else:
                column_widths[col_idx] = 1.5
        
        return column_widths
    
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
                Image, ImageOps
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
        """Apply styling to a header cell."""
        para = cell.paragraphs[0]
        if para.runs:
            run = para.runs[0]
            run.bold = True
            run.font.name = 'Arial'
            run.font.size = Pt(9)
            run.font.color.rgb = RGBColor(0, 0, 0)
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        self._set_cell_margins(cell, parse_xml, nsdecls, 0, 0, 14, 14)
        self._set_cell_vertical_align(cell, parse_xml, nsdecls)
        self._set_para_spacing(para, parse_xml, nsdecls)
        cell.width = Cm(width)
    
    def _add_data_row(self, table, card, ordered_fields, column_widths, sr_no,
                      Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls,
                      Image, ImageOps):
        """Add a data row to the table."""
        new_row = table.add_row()
        cells = new_row.cells
        
        # Set row height
        tr = new_row._tr
        trPr = tr.get_or_add_trPr()
        row_height_twips = int(Cm(self.ROW_HEIGHT_CM).twips)
        trHeight = parse_xml(
            r'<w:trHeight {} w:val="{}" w:hRule="exact"/>'.format(nsdecls('w'), row_height_twips)
        )
        trPr.append(trHeight)
        
        col_idx = 0
        field_data = card.field_data or {}
        
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
                self._add_image_to_cell(
                    cell, image_path or '',
                    Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls,
                    Image, ImageOps
                )
            else:
                value = format_field_value(field_data.get(field['name'], ''), uppercase=True)
                cell.text = value
                self._style_data_cell(cell, column_widths[col_idx], False,
                                      Cm, Pt, RGBColor, WD_ALIGN_PARAGRAPH, parse_xml, nsdecls)
            
            col_idx += 1
    
    def _add_image_to_cell(self, cell, img_path, Cm, Pt, RGBColor,
                           WD_ALIGN_PARAGRAPH, parse_xml, nsdecls, Image, ImageOps):
        """Add an image to a cell using VML for Word 97-2003 compatibility.
        
        Uses VML (Vector Markup Language) instead of DrawingML to ensure
        images are visible in Normal/Draft view and compatible with
        Word 97-2003 format.
        """
        self._set_cell_margins(cell, parse_xml, nsdecls, 0, 0, 0, 0)
        self._set_cell_vertical_align(cell, parse_xml, nsdecls)
        
        if is_valid_image_path(img_path):
            try:
                if default_storage.exists(img_path):
                    with default_storage.open(img_path, 'rb') as img_file:
                        img_data = img_file.read()
                        
                        if img_data and len(img_data) >= 100:
                            # Process image
                            with Image.open(BytesIO(img_data)) as verify_img:
                                verify_img.verify()
                            pil_img = Image.open(BytesIO(img_data))
                            try:
                                if pil_img.mode in ('RGBA', 'LA', 'P'):
                                    converted = pil_img.convert('RGB')
                                    pil_img.close()
                                    pil_img = converted
                                
                                # Add 0.5pt border INSIDE the image (no layout shift)
                                from PIL import ImageDraw
                                draw = ImageDraw.Draw(pil_img)
                                iw, ih = pil_img.size
                                draw.rectangle([0, 0, iw - 1, ih - 1], outline='black', width=1)
                                
                                img_stream = BytesIO()
                                pil_img.save(img_stream, format='JPEG', quality=90)
                            finally:
                                pil_img.close()
                            img_stream.seek(0)
                            
                            para = cell.paragraphs[0]
                            run = para.add_run()
                            # Add picture (creates relationship), then convert to VML
                            inline_shape = run.add_picture(img_stream, height=Cm(self.IMAGE_HEIGHT_CM))
                            img_stream.close()
                            self._convert_to_vml(run, inline_shape)
                            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                            self._set_para_spacing(para, parse_xml, nsdecls)
                            return
                        else:
                            logger.warning("Word export: Image too small (%d bytes): %s", len(img_data) if img_data else 0, img_path)
                else:
                    logger.warning("Word export: Image file not found by storage: %s", img_path)
            except Exception as e:
                logger.warning("Word export: Image load error for %s: %s", img_path, e)
        
        # Placeholder for missing/invalid image
        para = cell.paragraphs[0]
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        self._set_para_spacing(para, parse_xml, nsdecls)
    
    def _convert_to_vml(self, run, inline_shape):
        """Convert an inline DrawingML image to VML for backward compatibility.
        
        VML images are visible in Word's Normal/Draft view and compatible
        with Word 97-2003 format (.doc).  This replaces the <w:drawing>
        element with a <w:pict> VML element referencing the same image
        relationship.
        """
        from lxml import etree  # type: ignore[attr-defined]
        from docx.oxml.ns import qn
        
        # Get dimensions from inline shape (EMU → points)
        width_pt = inline_shape.width / 914400.0 * 72.0
        height_pt = inline_shape.height / 914400.0 * 72.0
        
        # Extract relationship ID from DrawingML blip element
        drawing_elem = run._r.find(qn('w:drawing'))
        blip = drawing_elem.find('.//' + qn('a:blip'))
        rId = blip.get(qn('r:embed'))
        
        # Remove the DrawingML element from the run
        run._r.remove(drawing_elem)
        
        # Create VML <w:pict> element (universally compatible)
        vml_xml = (
            '<w:pict '
            'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
            'xmlns:v="urn:schemas-microsoft-com:vml" '
            'xmlns:o="urn:schemas-microsoft-com:office:office" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<v:shape type="#_x0000_t75" '
            f'style="width:{width_pt:.1f}pt;height:{height_pt:.1f}pt">'
            f'<v:imagedata r:id="{rId}" o:title=""/>'
            '</v:shape></w:pict>'
        )
        pict_elem = etree.fromstring(vml_xml)
        run._r.append(pict_elem)
    
    def _set_compatibility_mode(self, doc):
        """Set document to Word 97-2003 compatibility mode.
        
        This tells Word to render the document in compatibility mode,
        which ensures maximum backward compatibility with older Word
        versions and enables VML image rendering.
        """
        try:
            from docx.oxml.ns import qn
            from docx.oxml import OxmlElement
            
            settings_elem = doc.settings.element
            
            # Find or create w:compat element
            compat = settings_elem.find(qn('w:compat'))
            if compat is None:
                compat = OxmlElement('w:compat')
                settings_elem.append(compat)
            
            # Remove existing compatibilityMode setting if any
            for cs in list(compat):
                if cs.get(qn('w:name')) == 'compatibilityMode':
                    compat.remove(cs)
            
            # Add Word 2003 compatibility mode (val=11)
            cs = OxmlElement('w:compatSetting')
            cs.set(qn('w:name'), 'compatibilityMode')
            cs.set(qn('w:uri'), 'http://schemas.microsoft.com/office/word')
            cs.set(qn('w:val'), '11')
            compat.append(cs)
        except Exception:
            pass  # Not critical — VML images alone provide compatibility
    
    def _style_data_cell(self, cell, width, is_image, Cm, Pt, RGBColor,
                         WD_ALIGN_PARAGRAPH, parse_xml, nsdecls):
        """Apply styling to a data cell."""
        if is_image:
            self._set_cell_margins(cell, parse_xml, nsdecls, 0, 0, 0, 0)
        else:
            self._set_cell_margins(cell, parse_xml, nsdecls, 0, 0, 28, 28)
        
        self._set_cell_vertical_align(cell, parse_xml, nsdecls)
        
        para = cell.paragraphs[0]
        if para.runs:
            run = para.runs[0]
            run.font.name = 'Arial'
            run.font.size = Pt(9)
            run.font.color.rgb = RGBColor(0, 0, 0)
        
        self._set_para_spacing(para, parse_xml, nsdecls)
        cell.width = Cm(width)
    
    def _set_table_borders(self, table, parse_xml, nsdecls):
        """Set table borders to 0.5pt."""
        tbl = table._tbl
        tblPr = tbl.tblPr if tbl.tblPr is not None else parse_xml(
            r'<w:tblPr {}/>'.format(nsdecls('w'))
        )
        if tbl.tblPr is None:
            tbl.insert(0, tblPr)
        
        # Remove existing borders
        for child in list(tblPr):
            if 'tblBorders' in child.tag:
                tblPr.remove(child)
        
        tblBorders = parse_xml(
            r'<w:tblBorders {}>'
            r'<w:top w:val="single" w:sz="4" w:color="000000"/>'
            r'<w:left w:val="single" w:sz="4" w:color="000000"/>'
            r'<w:bottom w:val="single" w:sz="4" w:color="000000"/>'
            r'<w:right w:val="single" w:sz="4" w:color="000000"/>'
            r'<w:insideH w:val="single" w:sz="4" w:color="000000"/>'
            r'<w:insideV w:val="single" w:sz="4" w:color="000000"/>'
            r'</w:tblBorders>'.format(nsdecls('w'))
        )
        tblPr.append(tblBorders)
    
    def _add_template_instructions(self, doc, template_id, Pt, RGBColor,
                                    WD_ALIGN_PARAGRAPH, parse_xml, nsdecls):
        """Add template instructions section after the data table."""
        from core.models import ExportTemplate
        try:
            tpl = ExportTemplate.objects.get(id=template_id)
        except ExportTemplate.DoesNotExist:
            return
        
        instructions = tpl.instructions.strip()
        if not instructions:
            return
        
        # Add blank line
        doc.add_paragraph('')
        
        # Instructions heading
        heading_para = doc.add_paragraph()
        heading_run = heading_para.add_run('INSTRUCTIONS:')
        heading_run.bold = True
        heading_run.underline = True
        heading_run.font.name = 'Arial'
        heading_run.font.size = Pt(9)
        heading_run.font.color.rgb = RGBColor(0, 0, 0)
        heading_para.alignment = WD_ALIGN_PARAGRAPH.LEFT
        self._set_para_spacing(heading_para, parse_xml, nsdecls, before=60, after=40)
        
        # Instructions body (preserve line breaks)
        for line in instructions.split('\n'):
            line = line.strip()
            if not line:
                continue
            body_para = doc.add_paragraph()
            body_run = body_para.add_run(line.upper())
            body_run.font.name = 'Arial'
            body_run.font.size = Pt(8)
            body_run.font.color.rgb = RGBColor(0, 0, 0)
            body_para.alignment = WD_ALIGN_PARAGRAPH.LEFT
            self._set_para_spacing(body_para, parse_xml, nsdecls, before=0, after=20, line=220)
    
    def _set_para_spacing(self, para, parse_xml, nsdecls, before=0, after=0, line=240):
        """Set paragraph spacing."""
        pPr = para._p.get_or_add_pPr()
        spacing = parse_xml(
            r'<w:spacing {} w:before="{}" w:after="{}" w:line="{}" w:lineRule="auto"/>'.format(
                nsdecls('w'), before, after, line
            )
        )
        pPr.append(spacing)
    
    def _set_cell_margins(self, cell, parse_xml, nsdecls, top=0, bottom=0, left=28, right=28):
        """Set cell margins in twips."""
        tc = cell._tc
        tcPr = tc.get_or_add_tcPr()
        tcMar = parse_xml(
            r'<w:tcMar {}>'
            r'<w:top w:w="{}" w:type="dxa"/>'
            r'<w:bottom w:w="{}" w:type="dxa"/>'
            r'<w:left w:w="{}" w:type="dxa"/>'
            r'<w:right w:w="{}" w:type="dxa"/>'
            r'</w:tcMar>'.format(nsdecls('w'), top, bottom, left, right)
        )
        tcPr.append(tcMar)
    
    def _set_cell_vertical_align(self, cell, parse_xml, nsdecls, align='center'):
        """Set cell vertical alignment."""
        tc = cell._tc
        tcPr = tc.get_or_add_tcPr()
        vAlign = parse_xml(r'<w:vAlign {} w:val="{}"/>'.format(nsdecls('w'), align))
        tcPr.append(vAlign)
    
    def _remove_cell_borders(self, cell, parse_xml, nsdecls):
        """Remove borders from a cell."""
        tc = cell._tc
        tcPr = tc.get_or_add_tcPr()
        tcBorders = parse_xml(
            r'<w:tcBorders {}>'
            r'<w:top w:val="nil"/>'
            r'<w:left w:val="nil"/>'
            r'<w:bottom w:val="nil"/>'
            r'<w:right w:val="nil"/>'
            r'</w:tcBorders>'.format(nsdecls('w'))
        )
        tcPr.append(tcBorders)
        vAlign = parse_xml(r'<w:vAlign {} w:val="center"/>'.format(nsdecls('w')))
        tcPr.append(vAlign)


# =============================================================================
# MODULE-LEVEL CONVENIENCE FUNCTION
# =============================================================================

def export_cards_to_docx(table, cards: QuerySet, doc_format: str = 'docx') -> WordExportResult:
    """
    Convenience function to export cards to Word format.
    
    Args:
        table: IDCardTable instance
        cards: QuerySet of IDCard instances
        doc_format: 'docx' or 'doc'
        
    Returns:
        WordExportResult
    """
    exporter = WordExporter()
    return exporter.export_cards(table, cards, doc_format=doc_format)
