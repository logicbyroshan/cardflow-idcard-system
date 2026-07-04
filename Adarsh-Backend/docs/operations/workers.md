# Worker Documentation (Celery)

## Queues
1. `default`: General lightweight tasks.
2. `imports`: Heavy CPU/IO for XLSX/ZIP parsing.
3. `exports`: Heavy CPU for PDF rendering.
4. `images`: Thumbnail generation and EXIF stripping.
5. `notifications`: Fast email/sms dispatch.
6. `beat`: Scheduled maintenance.

## Failure Handling
- **Retries**: Tasks automatically retry up to 5 times.
- **Backoff**: Exponential backoff (interval_step=0.5, max=2.0).
- **Dead Letter**: Unresolvable tasks are routed to the `dead_letter` queue for manual inspection.\n