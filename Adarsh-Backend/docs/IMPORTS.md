# Adarsh ID Panel: Excel & Image ZIP Import Pipelines

This document details the high-throughput asynchronous import system designed for batch card registration and media file uploads.

---

## 1. Import Modes

The backend supports three primary modes for importing datasets under `apps/imports`:

### A. Create Table & Fields From Excel
* **Workflow**: The user uploads an XLSX file without predefined database structures.
* **Mechanism**:
  1. The backend inspects the first row (header columns).
  2. Dynamically generates a `Table` object.
  3. Creates `Field` records matching each column name (defaults to `STRING` fields).
  4. Parses subsequent rows to populate `Card` records in the new table.

### B. Standard XLSX Dataset Import
* **Workflow**: Imports card details into an existing `Table`.
* **Mechanism**:
  1. Maps columns to the table's field names.
  2. Runs type checks (e.g. validates date formats, integer boundaries).
  3. Inserts card details directly to cards data JSONB field.

### C. XLSX + Media ZIP Archive Import
* **Workflow**: Simultaneously uploads dataset metadata and photos.
* **Mechanism**:
  1. The user uploads an Excel spreadsheet and a zipped file containing image folders.
  2. The parser maps image columns in the Excel file (e.g. `headshot.jpg`) to files inside the ZIP.
  3. The ZIP files are extracted, processed, uploaded to the storage provider, and registered as `MediaFile` links.

---

## 2. Chunking & Async Task Pipeline

To process files with thousands of rows without timing out or exhausting worker memory:
1. **Queue Isolation**: All import jobs are routed to the `imports` Celery task queue.
2. **Chunking**: The Excel sheet rows are partitioned into chunks of 500 rows.
3. **Database Insertion**: Card creations use Django's `bulk_create` to insert records efficiently, minimizing database roundtrips.

---

## 3. Duplicate Handling Rules

During imports, duplicate cards must not crash the task process.
- **Rules**:
  - The operator selects a **Unique Identity Field** (e.g., Roll Number, Employee Code).
  - For each row, the parser queries: `Card.objects.filter(table=table, data__identity_field=value)`
  - **Match Found**: Overwrites the card record (UPSERT), updating its fields and resetting its workflow status to `PENDING`.
  - **No Match**: Appends a new `Card` record.

---

## 4. Progress Tracking & Error Reporting

The state of every import is logged inside a `Job` record:
- **States**: `PENDING` ➔ `PROCESSING` ➔ `COMPLETED` / `FAILED`.
- **Progress Counter**: Tracks percentage completion (e.g. `15%`, `80%`) based on completed row chunks.
- **Fail-Safe Logging**: If individual rows fail verification:
  - The import continues rather than failing the entire file.
  - Verification failures are logged as `JobLog` entries with exact row numbers and error messages, returning an error spreadsheet summary to the user at the end of the run.
