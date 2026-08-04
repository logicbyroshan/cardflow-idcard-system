# Bulk Ingestion Engine, Face Cropper & Export Pipelines

This guide provides deep technical details on CardFlow's **high-performance bulk ingestion engine**, **semantic multi-image matcher**, **standalone OpenCV face-cropping engine**, and **PDF / Word export pipelines**.

---

## 1. Bulk Ingestion Engine (`core/services/`)

The bulk ingestion engine processes Excel (`.xlsx`, `.xls`) and CSV files containing thousands of student/staff records in memory-safe bounded chunks.

```text
[ Spreadsheet (XLSX / CSV) ] + [ Multi-Field Image ZIP Archives ]
                                │
                                ▼
               [ Semantic Header & Field Matcher ]
                                │
                                ▼
            ┌───────────────────┴───────────────────┐
            ▼                                       ▼
   [ Text Data Ingestion ]                 [ Image ZIP Indexer ]
   - Validate field rules                  - Isolate field ZIP indexes
   - Preserve text casing                  - Resolve photo/signature/QR
            │                                       │
            └───────────────────┬───────────────────┘
                                │
                                ▼
                    [ Card & Media Persister ]
                    - Batch create IDCard records
                    - Store CardMedia attachments
```

### 1.1 Semantic Image Header Matching
- Recognizes header naming variants without requiring exact string matches:
  - `PHOTO`, `STUDENT_PHOTO`, `IMAGE`, `PICTURE` -> Map to Primary Photo field.
  - `SIGNATURE`, `SIGN`, `STUDENT_SIGN` -> Map to Signature field.
  - `FATHER`, `FATHER_PHOTO` -> Map to Father Photo field.
  - `MOTHER`, `MOTHER_PHOTO` -> Map to Mother Photo field.
  - `QR`, `QR_CODE` -> Map to QR Code field.

### 1.2 ZIP Archive Isolation
- Prevents cross-column filename collisions when multiple ZIP archives contain identically named images (e.g. `1.jpg` in Photo ZIP vs `1.jpg` in Signature ZIP) by creating isolated lookup maps per image column.

---

## 2. Standalone OpenCV Face Cropper Engine (`Face Cropper/`)

CardFlow includes a dedicated Windows service built with **FastAPI**, **OpenCV**, and packaged with **PyInstaller** for fast automated portrait detection and cropping.

- **Local API Gateway**: Listens locally on `http://127.0.0.1:4765`.
- **Face & Eye Detection**: Uses Haar cascades and DNN models to detect human faces, center portraits, apply padding, and crop to exact ID card aspect ratios (3:4 portrait).
- **Background Worker Handoff**: Django communicates with the service via background Celery tasks, preventing HTTP request blocking.

---

## 3. High-Performance Export Pipelines (`exports/`)

```text
                               [ Export Engine ]
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
 [ PDF Grid Exporter ]        [ Excel Exporter ]           [ Word (.docx) Exporter ]
 - ReportLab / WeasyPrint     - openpyxl tabular           - python-docx layout
 - Exact mm card bounds       - Auto-width spec            - Class/Section Page Breaks
 - 8 / 10 cards per sheet     - Data validation            - OOXML row paragraph split
```

### 3.1 PDF Grid Printing Engine
- **Precise Millimeter Layout**: Renders front and back ID card templates onto standard A4 or CR-80 card sheets with crop marks and alignment guides.
- **Dual Engine Strategy**: Uses **ReportLab** for fast native vector rendering and **WeasyPrint** for HTML/CSS-styled complex card layouts.

### 3.2 Word (`.docx`) Exporter with Section Page Breaks
- **Custom Page Break Options**: Supports layout pagination rules:
  - `Class + Section`: Starts a new page when either class or section changes.
  - `Class Only`: Groups all sections of a class continuously before inserting a page break.
- **OOXML Formatting**: Injects row-level paragraph page break properties into generated `.docx` tables.

---

## 4. Background Task Queue Management

Async operations run via `BackgroundTask` records backed by a thread pool / Celery worker system:
- **Rate & Memory Safety**: Limits heavy operations to a bounded worker pool to preserve server memory.
- **Task Polling & Cancellation**: Frontend polls `/api/tasks/<task_id>/` for real-time progress percentages and provides instant task cancellation controls.
