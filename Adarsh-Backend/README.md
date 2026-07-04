# Adarsh ID Panel Backend

Adarsh ID Panel is an enterprise-scale, multi-tenant backend platform for managing, verifying, and generating identification cards. Designed using a Domain-Driven Design (DDD) layout with Django, it features strict tenant separation, role-based workflows, high-performance background pipelines (Excel & ZIP processing), multiple export formats (PDF, DOCX, XLSX, ZIP), and robust infrastructure monitoring.

---

## 1. Key Features

- **Multi-Tenant Isolation**: Cryptographic and logical isolation of organization data.
- **Dynamic Data Structures**: Dynamic card schema definitions utilizing PostgreSQL `JSONB` for schema-less attributes.
- **Role-Based Workflows**: Custom multi-stage state transitions (Pending ➔ Verified ➔ Approved ➔ Downloaded) with strict role authorization.
- **High-Throughput Imports**: Async processing of massive Excel files and ZIP archives containing thousands of student/employee images.
- **Template-Driven Exports**: PDF (via WeasyPrint), Word (DOCX), Excel (XLSX), and bulk ZIP exports with automated image-placeholder mapping.
- **Overlay Sandbox Architecture**: Zero-copy copy-on-write Sandbox system allowing clients to test workflow mutations and batch operations without modifying production data.
- **Pro User Platform**: Administrative control deck providing organization-wide dashboards, platform maintenance settings, feature flags, and silent user impersonation logs.
- **Desktop Sync Integration**: Seamless backend APIs and secure API-key authentication for offline desktop printing clients.
- **Production Hardening**: Thread-safe correlation tracing (`X-Request-ID`), structured JSON logging, connection pooling, rate-limiting, and cached statistical lookups.
- **Operations & Disaster Recovery**: Boot-time startup validators, automated health checks, grandfather-father-son backup retention rotation, restore simulations, and diagnostics.

---

## 2. Technology Stack

- **Core Web Framework**: Django 5.2 & Django REST Framework (DRF)
- **Database**: PostgreSQL (JSONB fields for dynamic cards schema, indexes, transaction controls)
- **Cache & Message Broker**: Redis
- **Distributed Tasks**: Celery & Celery Beat (scheduled operations)
- **Document Rendering**: WeasyPrint (PDF), python-docx (DOCX), openpyxl (XLSX)
- **Authentication**: JWT (JSON Web Tokens) & API Key hashing
- **Testing**: Pytest & Django Test Suite

---

## 3. Architecture Summary

The codebase employs **Domain-Driven Design (DDD)** concepts to separate concerns and ensure maintainability:
- **Models**: Defines database schemas and relations. No business logic in save overrides.
- **Services**: Orchestrates business logic and mutates state.
- **Selectors**: Reusable queries and data fetches (read-only views).
- **Throttles & Policies**: Enforces access boundaries and permission limits.
- **Middleware**: Injects request tracing metadata and manages lifecycle contexts.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Client (Web / Mobile / Desktop)              │
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTP (JSON / API Key)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Django REST Framework Views                  │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Action Dispatch
                                 ▼
┌───────────────────────┬───────────────────────┬─────────────────┐
│     API Selectors     │     Core Services     │  Custom Policies│
│      (Read-Only)      │     (Write/Mutate)    │  (Authorization)│
└───────────────────────┴───────────┬───────────┴─────────────────┘
                                    │ Broker Queue
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Celery Workers (Async Tasks)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Getting Started (Development Setup)

### Prerequisites
- Python 3.11+
- PostgreSQL
- Redis
- WeasyPrint System Dependencies (Pango, cairo, GDK-PixBuf)

### Setup Steps
1. **Clone the repository**:
   ```bash
   git clone <repo-url>
   cd Adarsh-ID-Panel
   ```
2. **Create and activate virtual environment**:
   ```bash
   python -m venv .venv
   .venv\Scripts\activate      # Windows
   source .venv/bin/activate    # Linux/macOS
   ```
3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
4. **Environment variables configuration**:
   Copy the example file and modify as needed:
   ```bash
   cp .env.example .env
   ```
5. **Run Database Migrations**:
   ```bash
   python manage.py migrate
   ```
6. **Start Local Servers**:
   Run Django development server:
   ```bash
   python manage.py runserver
   ```
   Start Celery worker in a separate terminal:
   ```bash
   celery -A config worker --loglevel=info
   ```
   Start Celery Beat scheduler:
   ```bash
   celery -A config beat --loglevel=info
   ```

---

## 5. Running Tests

The test suite consists of **317 unit and integration tests** verifying startup validation, database transaction integrity, workflow transitions, imports, exports, and sandboxing.

Run the entire suite with coverage report:
```bash
pytest --tb=short
```

Run specific test modules:
```bash
pytest apps/operations/tests.py -v
pytest apps/hardening/tests.py -v
```

---

## 6. Documentation Index

Complete project architectural and operational references are stored inside the `docs/` folder:

1. **System & Flow Architecture**: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
2. **Applications & Module Directory**: [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)
3. **Database Schema & Constraints**: [`docs/DATABASE.md`](docs/DATABASE.md)
4. **API Reference Guide**: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)
5. **Role & Permission Matrix**: [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md)
6. **Card Lifecycle & Workflow Engine**: [`docs/WORKFLOW.md`](docs/WORKFLOW.md)
7. **Excel & Archive Import Pipeline**: [`docs/IMPORTS.md`](docs/IMPORTS.md)
8. **Document Generation & Exports**: [`docs/EXPORTS.md`](docs/EXPORTS.md)
9. **Desktop Synchronisation APIs**: [`docs/DESKTOP_API.md`](docs/DESKTOP_API.md)
10. **Production Deployment Manual**: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
11. **Operations & Disaster Recovery Runbooks**: [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
12. **Release Artifacts**:
    - [`docs/CHANGELOG.md`](docs/CHANGELOG.md)
    - [`docs/RELEASE_NOTES.md`](docs/RELEASE_NOTES.md)
    - [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)
    - [`docs/UPGRADE_GUIDE.md`](docs/UPGRADE_GUIDE.md)