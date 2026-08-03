# Adarsh ID Panel: Project Modules & Structure

The codebase is partitioned into distinct Django applications inside the `apps/` directory, maintaining clear domain boundaries.

---

## 1. Directory Structure

```
c:\Users\iamro\Desktop\Adarsh-ID Panel\
├── api/                  # Main URL router configs
│   └── v1/               # Version 1 API routing paths
├── apps/                 # Bounded Django Applications
│   ├── users/            # User Auth & Hierarchies
│   ├── organizations/    # Tenant organization profiles
│   ├── permissions/      # Group & object permissions checks
│   ├── tables/           # Dynamic card schemas
│   ├── fields/           # Schema attributes & validations
│   ├── cards/            # Dynamic card records
│   ├── workflow/         # Card state engine
│   ├── mediafiles/       # File upload & storage management
│   ├── jobs/             # Task progress state tracking
│   ├── imports/          # Excel & ZIP processing pipelines
│   ├── exports/          # PDF & Docx rendering pipelines
│   ├── sandbox/          # Virtual overlay system
│   ├── pro/              # Platform admin controls
│   ├── desktop_sync/     # Sync integrations for print stations
│   ├── hardening/        # Logging, correlation, and caching guards
│   └── operations/       # Health metrics, backups, and DR controls
├── config/               # Project configuration files (settings, wsgi)
└── shared/               # Reusable constants, utils, base classes
```

---

## 2. Django Applications Reference

### 1. `users`
* **Purpose**: Manages user registration, profiles, and credentials. Handles role configurations (PRO_USER, ADMIN, OPERATOR, CLIENT, ASSISTANT).
* **Models**: `User` (subclasses `AbstractUser`)
* **Services**: `UserService` (CRUD operations and activation states)
* **Views**: JWT token endpoints, User registration/detail APIViews
* **Dependencies**: `django.contrib.auth`, `rest_framework_simplejwt`

### 2. `organizations`
* **Purpose**: Represents multi-tenant business entities. Enforces organizational isolation.
* **Models**: `Organization` (supports logical soft deletes)
* **Services**: `OrganizationService` (creation, deactivation checks)
* **Views**: Organization detail and registration hooks
* **Dependencies**: None (core core dependency)

### 3. `permissions`
* **Purpose**: Implements custom permission policies and checks object permissions.
* **Models**: Custom group policies (no database tables; policy classes)
* **Services**: Policy checks (e.g. `HasOrganizationPermission`)
* **Views**: None (applied as decorators/permission classes in views)
* **Dependencies**: `users`, `organizations`

### 4. `tables` & `fields`
* **Purpose**: Implements dynamic card metadata schemas. Permits organizations to configure arbitrary fields (e.g. Student ID, DOB, department) with variable types (string, image, choice).
* **Models**: `Table`, `Field`
* **Services**: `TableService` (creating dynamic tables), `FieldService` (schema updates)
* **Views**: Dynamic schema definition endpoints
* **Dependencies**: `organizations`

### 5. `cards`
* **Purpose**: Holds card data. Uses PostgreSQL `JSONB` for the schema-less payload data, mapped back to the field configurations in `fields`.
* **Models**: `Card`
* **Services**: `CardService` (data mapping, validations, creation)
* **Views**: Card listing, retrieval, mutation views
* **Dependencies**: `tables`, `fields`, `organizations`

### 6. `workflow`
* **Purpose**: Custom lifecycle engine for cards. Manages transitions between `PENDING`, `VERIFIED`, `APPROVED`, and `DOWNLOADED`.
* **Models**: None (state transitions managed on the `Card` table)
* **Services**: `WorkflowService` (state validation rules, state triggers, status hooks)
* **Views**: Transitions dispatch endpoints
* **Dependencies**: `cards`, `auditlogs`

### 7. `mediafiles`
* **Purpose**: Handles media assets (student headshots, logos). Resolves storage provider backends.
* **Models**: `MediaFile`
* **Services**: Storage abstraction factory, image resizing and mapping operations
* **Views**: Direct upload, pre-signed URL views
* **Dependencies**: `organizations`, `boto3` (for R2/MinIO endpoints)

### 8. `jobs`
* **Purpose**: Tracks asynchronous task progress, errors, and output logs for Celery runs.
* **Models**: `Job`, `JobLog`
* **Services**: `JobService` (starting, updating, and marking task completions)
* **Views**: Job progress tracker endpoints
* **Dependencies**: None (standalone logging utility)

### 9. `imports`
* **Purpose**: Batch Excel & ZIP parsing pipelines. Combines XLSX parser with zipped images.
* **Models**: `ImportSession`
* **Services**: `ImportService` (asynchronous parsing, matching file hashes, bulk DB insertions)
* **Views**: Import file uploader views
* **Dependencies**: `jobs`, `cards`, `mediafiles`, `openpyxl`

### 10. `exports`
* **Purpose**: Asynchronous bulk export builder. Renders cards to PDF, DOCX, XLSX, and packages them in ZIP files.
* **Models**: `ExportSession`
* **Services**: `ExportService` (async document compilations, HTML bindings)
* **Views**: Bulk export triggering view
* **Dependencies**: `jobs`, `cards`, `weasyprint`, `python-docx`

### 11. `sandbox`
* **Purpose**: Interactive playground sandbox overlay. Allows clients to dry-run batch edits and workflows without affecting production.
* **Models**: `SandboxSession`, `SandboxDiff`
* **Services**: `SandboxService` (copy-on-write simulation, diff overlay calculations)
* **Views**: Sandbox trigger hooks
* **Dependencies**: `cards`, `tables`

### 12. `pro`
* **Purpose**: Command deck reserved for `PRO_USER`. Implements platform maintenance screens, statistics, and user impersonation logs.
* **Models**: `ImpersonationSession`, `ImpersonationAudit`, `MaintenanceMode`, `Announcement`, `FeatureFlag`, `StatisticsSnapshot`, `BackupSession`, `BackupArtifact`
* **Services**: `ImpersonationService`, `MaintenanceModeService`, `FeatureFlagService`, `BackupService`
* **Views**: Impersonation, announcement, feature flag, and backup views
* **Dependencies**: `users`, `organizations`, `mediafiles`

### 13. `desktop_sync`
* **Purpose**: Integrations and API keys for offline local print stations.
* **Models**: `DesktopApiKey`, `DesktopAccessLog`
* **Services**: `DesktopSyncService` (authenticating printing clients, marking print completions)
* **Views**: Sync endpoints for datasets and images
* **Dependencies**: `organizations`

### 14. `hardening`
* **Purpose**: Implements correlation headers, pooled connections, JSON logging, and throttle classes.
* **Models**: None
* **Services**: `FeatureFlagCacheLayer`
* **Views**: Health probes (liveness, database, redis, celery, storage)
* **Dependencies**: `pro` (for feature flag checks)

### 15. `operations`
* **Purpose**: Diagnostics, grandfather-father-son backup rotation retention, and restore simulation testing.
* **Models**: `BackupVerificationResult`, `DiskHealthSnapshot`, `MemoryHealthSnapshot`
* **Services**: `BackupVerificationService`, `BackupRetentionPolicy`, `RestoreSimulationService`, `EnvironmentDiagnosticService`, `StartupDiagnosticService`, `DiskHealthService`
* **Views**: OperationsDashboard view
* **Dependencies**: `pro` (checks backup sessions)
