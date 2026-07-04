# Import & Export Pipeline

## Import Architecture
```mermaid
sequenceDiagram
    participant User
    participant API
    participant ImportService
    participant Redis
    participant CeleryQueue
    participant Worker
    
    User->>API: Upload ZIP + XLSX
    API->>ImportService: initialize_import()
    ImportService->>Redis: Set Job Status (Pending)
    ImportService->>CeleryQueue: Dispatch(job_id)
    API-->>User: 202 Accepted (job_id)
    
    CeleryQueue->>Worker: Consume
    Worker->>Worker: Parse XLSX, Extract ZIP
    Worker->>Redis: Update Progress (50%)
    Worker->>Worker: Insert Cards via Repositories
    Worker->>Redis: Set Job Status (Completed)
```

## Export Architecture (PDF/DOCX)
- Uses `WeasyPrint` for high-fidelity PDFs.
- Flow: `API Request` -> `Job Created` -> `Worker fetches Cards` -> `Renders Template` -> `Uploads to Storage` -> `Notifies User`.\n