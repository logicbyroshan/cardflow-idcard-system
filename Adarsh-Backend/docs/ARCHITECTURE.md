# Adarsh ID Panel: System Architecture & Data Flows

This document details the high-level architecture, service boundaries, and data flows within the Adarsh ID Panel backend platform.

---

## 1. System Overview & Boundaries

The platform is designed around **Domain-Driven Design (DDD)**. Communication between bounded contexts is strictly orchestrated using services, selector layers, or task queues to avoid circular dependencies and service leaks.

```mermaid
graph TD
    subgraph Core Bounded Context
        A[Users & Auth] --> B[Organizations]
        B --> C[Permissions]
        B --> D[Tables & Fields]
        D --> E[Cards & Media]
        E --> F[Workflow Transitions]
    end
    
    subgraph Operational & Integration Add-ons
        G[Sandbox Overlay] -.-> |Virtualizes| E
        H[Pro Platform] --> |Impersonates & Flag Overrides| Core Bounded Context
        I[Desktop API] --> |Authenticates & Prints| E
        J[Asynchronous Pipelines] --> |Imports/Exports| E
        K[Operations & DR] --> |Monitors & Backs Up| Core Bounded Context
    end
```

---

## 2. Request & Correlation Flow

Every incoming HTTP request undergoes correlation tracing to trace issues across services, logs, database writes, and background workers:

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Middleware as RequestCorrelationMiddleware
    participant Auth as JWT/API Authentication
    participant View as APIView Controller
    participant Context as thread-safe ContextVars
    participant DB as Postgres Database

    Client->>Middleware: GET /api/v1/cards/ (X-Request-ID Header or None)
    Note over Middleware: If header missing, generate uuid
    Middleware->>Context: Bind request_id to context
    Middleware->>Auth: Authenticate Request
    Auth->>Middleware: Populates request.user
    Middleware->>Context: Bind user_id & organization_id to context
    Middleware->>View: Dispatch request to view
    View->>DB: SQL Query (e.g. Select cards)
    Note over DB: Log queries and append request_id to AuditLog details on save
    View->>Client: Return 200 OK Response (adds X-Request-ID header)
    Middleware->>Context: Clear contextvars
```

---

## 3. Background Job Flow

Asynchronous tasks are isolated into queues (e.g. `default`, `imports`, `exports`) to prevent resource starvation during batch runs:

```mermaid
graph LR
    A[Django Web View] -->|Trigger Job| B[(Redis Message Broker)]
    B -->|Task Dispatch| C[Celery Workers]
    C -->|Update Progress & State| D[(Postgres DB)]
    C -->|Read/Write File Assets| E[(Storage Provider R2/Local)]
```

---

## 4. Import & Processing Flow

The import pipeline handles bulk uploads by combining Excel parsing with image zip extraction:

```mermaid
sequenceDiagram
    autonumber
    actor Operator
    participant API as Imports API
    participant Worker as Celery Worker
    participant Storage as Storage Factory
    participant Parse as Excel/Zip Reader
    participant DB as Postgres Database

    Operator->>API: Upload Excel + ZIP file
    API->>Storage: Save raw files to storage
    API->>DB: Create ImportSession (PENDING)
    API->>Worker: Dispatch Import Task (session_id)
    API->>Operator: Return session_id
    Note over Worker: Read Excel rows & extract ZIP images
    Worker->>Parse: Map XLSX headers to Table Fields
    Worker->>Storage: Save extracted card images
    Worker->>DB: Bulk insert Card records (jsonb data & media paths)
    Worker->>DB: Mark ImportSession (COMPLETED)
```

---

## 5. Export Flow

Bulk document exports are processed in background tasks using document templates:

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as Exports API
    participant Worker as Celery Worker
    participant DB as Postgres Database
    participant Template as PDF/Docx Render
    participant Storage as Storage Factory

    Client->>API: Trigger PDF/DOCX Bulk Export (card_ids)
    API->>DB: Create ExportSession (PROCESSING)
    API->>Worker: Dispatch Export Task
    API->>Client: Return export_id
    Worker->>DB: Fetch Cards and related images
    Worker->>Template: Bind card fields to HTML/Word templates
    Worker->>Template: Compile PDF (WeasyPrint) / DOCX (python-docx)
    Worker->>Storage: Save compiled output (ZIP package)
    Worker->>DB: Update ExportSession (COMPLETED, stored_path, file_size)
```

---

## 6. Sandbox (Overlay Architecture) Flow

The Sandbox allows clients to view a virtual state of card mutations. No production card records are duplicated or updated:

```mermaid
graph TD
    A[Production Table / Card Data] --> B{Sandbox Active?}
    B -->|No| C[Return Production Data]
    B -->|Yes| D[Fetch SandboxSession Diffs]
    D --> E[Overlay Diffs on top of Real Data]
    E --> F[Render Sandbox View to Client]
```

---

## 7. Desktop API & Sync Flow

The Desktop API facilitates printing cards on physical printer networks through decentralized API keys:

```mermaid
sequenceDiagram
    autonumber
    actor Printing PC
    participant Auth as API Key Auth Middleware
    participant API as Dataset/Image API
    participant DB as Postgres Database

    Printing PC->>Auth: GET /api/v1/desktop/sync/ (Authorization: ApiKey header)
    Note over Auth: Verify SHA-256 hash in desktop_api_key table
    Auth->>API: Authorized Client request
    API->>DB: Fetch cards marked as APPROVED / NOT PRINTED
    API->>Printing PC: Return JSON list of card details and media URLs
    Printing PC->>API: POST /api/v1/desktop/confirm/ (card_ids printed)
    API->>DB: Update card workflow state to DOWNLOADED / PRINTED
```

---

## 8. Operations Telemetry & Fail-Safe Flow

Health check diagnostics are executed continuously via Celery Beat, updating status caches and recording disk/memory logs:

```mermaid
graph TD
    A[Celery Beat Scheduler] -->|Every 1 Minute| B[Environment Diagnostics Task]
    B -->|Probe DB, Redis, Storage, CPU| C[Diagnostic Report]
    C -->|Refresh Heartbeat Key| D[Redis Cache]
    C -->|Log Metrics| E[Disk & Memory Snapshot Tables]
    
    F[Operations Dashboard View] -->|GET Request| G{Is User PRO_USER?}
    G -->|No| H[Return 403 Forbidden]
    G -->|Yes| I[Read Snapshots & Diagnostics Report]
    I --> J[Return Complete Telemetry Data]
```
