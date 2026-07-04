# Adarsh ID Panel: Document Generation & Export Pipelines

This document details the document rendering engine that compiles dynamic cards into print-ready PDF sheets, Word documents, Excel lists, and bulk ZIP archives.

---

## 1. Supported Export Formats

Under `apps/exports`, the following compilation methods are supported:

- **PDF (Bulk Sheet Layout)**:
  * **Engine**: WeasyPrint.
  * **Layout**: Multi-page grid template formats (e.g. 10 cards per page, double-sided printing, crop marks).
- **Word Document (DOCX)**:
  * **Engine**: `python-docx` template parsing.
  * **Layout**: Ideal for administrative letter structures with embedded ID card details.
- **Excel Spreadsheet (XLSX)**:
  * **Engine**: `openpyxl`.
  * **Layout**: Raw metadata lists including image URL mappings.
- **Bulk ZIP Archive**:
  * **Engine**: `zipfile`.
  * **Layout**: A zip file containing cards organized in folders, including separate directories for student images and metadata JSONs.

---

## 2. Template Parsing & Image Placeholders

Document generation uses HTML/CSS templates to style outputs:
- **Placeholders**: Text variables in templates use brackets: `{{ student_name }}`.
- **Image Mapping**: Headshot path placeholders `{{ photo_url }}` are translated to local system paths or absolute CDN links.
- **DPI Scaling**: CSS rule sets enforce absolute dimensions (e.g. `85.6mm` x `54mm` for CR80 card specifications) at `300 DPI` for print clarity.

---

## 3. Sorting & Filtering Options

Users can filter exports by the following properties:
- **Scope Fields**: Sort or filter by Section, Class, or Graduation Year.
- **Transition States**: Filter to only export `APPROVED` cards.
- **Alphabetical**: Sort cards alphabetically by Name.

---

## 4. Workflow Side Effects

* **Trigger Transition**: If the export compiles successfully, the workflow engine automatically transitions card states to `DOWNLOADED` (or flags them as downloaded in the database).
* **Audit Trail**: Logs a `CARDS_EXPORTED` event inside the audit log, recording the export session parameters and target card list.
* **Storage Artifacts**: Export files are saved to the storage backend (e.g. S3/R2/MinIO/Local) for 7 days before automated lifecycle cleanup rules delete them.
