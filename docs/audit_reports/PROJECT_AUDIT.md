# Django Production Audit Report

**Project Name:** Adarsh Admin New  
**Audit Date:** 2026-07-23  
**Django Version:** 5.2.12  
**Python Version:** 3.11.9  
**Auditor:** Senior Django Architect & Security Auditor  

---

## 1. Project Overview

* **Project Name:** Adarsh Admin New (`adarsh-id-cards/Adarsh-Deploye`)
* **Django Version:** 5.2.12
* **Python Version:** 3.11.9
* **Environment:** Production / Staging (Configurable via `DATABASE_URL` and `DEBUG`)
* **Debug Status (`DEBUG`):** `False` (Defaults to `False` in production; set via `DEBUG` environment variable)
* **App Version:** `v1.0.56` (Configured in `VERSION.txt` / `settings.APP_VERSION`)
* **Number of Installed Apps:** 22 (5 Django Contrib, 1 Third-Party Channels, 16 Local Apps)
* **Core Settings Modules:**
  - `config.settings`: Main settings configuration module
  - `config.urls`: Primary URL routing module
  - `config.urls_panel`: Subdomain / Panel specific URL routing module
  - `config.urls_website`: Landing website URL routing module
  - `config.asgi`: ASGI application entry point (Django Channels / WebSockets)
  - `config.wsgi`: WSGI application entry point (Gunicorn production web server)
  - `config.celery`: Celery task queue configuration
  - `config.gunicorn.conf`: Production Gunicorn web server process configuration

### Workspace Folder Structure Tree

```
Adarsh Admin New/
├── .env.example
├── README.md
├── VERSION.txt
├── VERSION_LOG.md
├── manage.py
├── requirements.txt
├── requirements-dev.txt
├── accounts/          # User authentication, device sessions, profiles
├── android_app/       # Android app assets and build specs
├── assistants/        # Assistant role management and services
├── client/            # Client portal, dashboards, and card services
├── config/            # Django settings, WSGI, ASGI, URLs, Celery, Gunicorn config
├── core/              # Core business logic, models, middleware, context processors, services
├── desktop_app/       # Desktop application PWA token API & WebSocket consumers
├── exports/           # PDF, Excel, and ZIP export engines and views
├── guest_sandboxes/   # Isolated SQLite guest sandbox environments
├── idcards/           # ID Card core processing workflows
├── media/             # Media upload directory
├── mobile_api/        # REST API for Android/iOS mobile applications
├── operators/         # Operator role management and views
├── panel/             # Administrative control panel and backup services
├── reprintcard/       # Card reprint workflows and services
├── staff/             # Staff member role management
├── static/            # Static assets (CSS, JS, images)
├── staticfiles/       # Collected production static assets (WhiteNoise)
├── stats/             # System health, load alerts, and telemetry snapshots
└── web_app/           # Public landing website integration & API keys
```

---

## 2. Installed Apps

Total Installed Apps: **22**

### Django Contrib Apps
1. `django.contrib.auth` - Django Authentication Framework
2. `django.contrib.contenttypes` - Generic Content Type System
3. `django.contrib.sessions` - Session Management Framework
4. `django.contrib.messages` - Cookie & Session Flash Messaging
5. `django.contrib.staticfiles` - Static Files Management

### Third-Party Apps
1. `channels` - Async WebSocket & Real-Time Event Layer
2. `debug_toolbar` - Debug Toolbar (Optional; enabled only when `DEBUG=True`)

### Local Application Modules
1. `core` - Central Business Logic, Models, DB Router, and Middleware
2. `accounts` - User Accounts, Profiles, and Device Session Tracking
3. `client` - Client Portal, Dashboard, and Card Data Management
4. `exports` - PDF, Excel, and ZIP Export Engines
5. `mediafiles` - Card Media Attachments and File Metadata
6. `staff` - Staff Member Management & Scope Control
7. `operators` - Operator Portal and Assigned Client Operations
8. `assistants` - Assistant Portal and Group Permissions
9. `stats` - Server Metrics, Telemetry Snapshots, and Load Alerts
10. `idcards` - ID Card Workflow and Distinct Value Caches
11. `reprintcard` - Card Reprint Verification and Processing
12. `panel` - Administrative Control Panel and Backup Operations
13. `mobile_api` - Mobile REST API Endpoints for Android/iOS Apps
14. `desktop_app` - Desktop PWA API, Bootstrap Tokens, and WebSockets
15. `web_app` - Public Landing Website API and Key Integration

---

## 3. Middleware

Execution Order of Middleware (16 total active middleware classes):

| Order | Middleware Class | Purpose | Type | DB Access | Cost Level |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `core.middleware.MobileAppCSRFBypassMiddleware` | Bypasses CSRF for valid PWA/Mobile API tokens | Local | No | Low |
| 2 | `django.middleware.security.SecurityMiddleware` | Enforces HTTPS redirect, HSTS, and X-Content-Type | Django | No | Low |
| 3 | `whitenoise.middleware.WhiteNoiseMiddleware` | Serves compressed, manifest static files | Third-party | No | Low |
| 4 | `django.contrib.sessions.middleware.SessionMiddleware` | Manages session cookies and session cache/DB store | Django | Yes (Cache/DB) | Medium |
| 5 | `django.middleware.common.CommonMiddleware` | Appends slashes, manages headers and URL normalization | Django | No | Low |
| 6 | `django.middleware.csrf.CsrfViewMiddleware` | Validates CSRF tokens on state-changing HTTP requests | Django | No | Low |
| 7 | `django.contrib.auth.middleware.AuthenticationMiddleware` | Associates current user object with request | Django | Yes (Session/DB)| Medium |
| 8 | `core.middleware.GuestSandboxMiddleware` | Routes guest requests to isolated SQLite DB databases | Local | Yes (SQLite DB) | Medium |
| 9 | `accounts.middleware.DeviceSessionMiddleware` | Tracks last_active timestamp per user device session | Local | Yes (Cache/DB) | Medium |
| 10 | `django.contrib.messages.middleware.MessageMiddleware` | Enables flash messages across HTTP requests | Django | No | Low |
| 11 | `core.middleware.RequestTimingMiddleware` | Logs request duration and warns if execution >1.5s | Local | No | Low |
| 12 | `core.middleware.PermissionValidationMiddleware` | Re-validates user/profile permissions on interval | Local | Yes (Throttled DB)| Medium-High |
| 13 | `core.middleware.SessionIdleTimeoutMiddleware` | Logs out inactive users after `SESSION_IDLE_TIMEOUT` | Local | No | Low |
| 14 | `core.middleware.SecurityHeadersMiddleware` | Sets `Permissions-Policy` and `Cache-Control` headers | Local | No | Low |
| 15 | `core.middleware.MaintenanceModeMiddleware` | Blocks non-superadmin access when maintenance mode is ON | Local | Yes (Cache/DB) | Low |
| 16 | `django.middleware.clickjacking.XFrameOptionsMiddleware` | Sets `X-Frame-Options: SAMEORIGIN` header | Django | No | Low |

---

## 4. Database Configuration

* **DATABASES:** Evaluated dynamically via `dj_database_url.config` reading `DATABASE_URL`.
* **Database Backend (Production):** PostgreSQL (`django.db.backends.postgresql`).
* **Database Backend (Local Dev Fallback):** SQLite (`django.db.backends.sqlite3` with 60s timeout).
* **CONN_MAX_AGE:** `600` seconds (10 minutes connection re-use in production).
* **CONN_HEALTH_CHECKS:** `True` (Validates connection health before query execution).
* **OPTIONS:** Configured via `DATABASE_URL` connection strings in production.
* **ATOMIC_REQUESTS:** `False` (Global auto-commit enabled; transactions scoped explicitly using `@transaction.atomic`).
* **Database Routers:** `core.db_router.GuestSandboxRouter` (Routes guest sandbox requests to temporary SQLite instances).
* **Total Migration Count:** 87+ migration files across installed local applications.
* **Total Models Count:** 18 models.

---

## 5. PostgreSQL Usage

* **Custom Indexes:** 30+ custom database indexes defined across models (e.g. `CardMedia`, `UserDeviceSession`, `DesktopAppDevice`).
* **Unique Constraints:** Configured on `User.username`, `Client.client_id`, `MobileDeviceToken.device_id`, etc.
* **Foreign Keys:** 20+ FK relations connecting users, clients, cards, media files, and device sessions.
* **Composite Indexes:** Defined on multi-column filter queries in `CardMedia` (`idcard`, `category`) and `UserDeviceSession` (`user`, `session_key`).
* **GIN Indexes:** JSONB GIN indexing supported on PostgreSQL for `field_data` and `system_info` columns.
* **Partial Indexes:** Used for filtering active non-deleted records.
* **Raw SQL Usage:** **977** explicit raw SQL / `.raw()` queries across search, pagination, bulk operations, and export services (`core/services/idcard_table_service.py`, `exports/zip.py`).
* **Database Functions:** Uses `COUNT()`, `COALESCE()`, `NOW()`, and string concatenation functions.
* **Custom Managers:** Custom managers configured on `User`, `IDCard`, `CardMedia`, and `Client` models.
* **Large Tables:** `idcards_idcard` (card data records), `mediafiles_cardmedia` (media files), `activitylog` (audit trail entries).

---

## 6. Redis

* **Cache Backend:** `django.core.cache.backends.redis.RedisCache` (when `REDIS_URL` or `REDIS_HOST` is set).
* **Local Fallback Cache:** `django.core.cache.backends.locmem.LocMemCache` or `FileBasedCache`.
* **Cache Timeout (`CACHE_DEFAULT_TIMEOUT`):** `300` seconds (5 minutes).
* **Cache Key Prefix (`CACHE_KEY_PREFIX`):** `adarsh` (Version: `1`).
* **Session Backend:** `django.contrib.sessions.backends.cached_db` (Reduces DB load by caching sessions in Redis).
* **Rate Limiting:** Redis cache key counters used for API rate limiting, OTP limits, and login lockout checks.
* **Celery Broker:** Configured via `CELERY_BROKER_URL` environment variable.
* **Celery Backend:** Configured via `CELERY_RESULT_BACKEND` environment variable.
* **Redis Connection URL:** Parsed via `REDIS_URL` or `REDIS_HOST` / `REDIS_PORT` (masked `********`).
* **Redis Usages:**
  1. Primary Application Cache (`CACHES['default']`)
  2. Cached Database Sessions (`cached_db`)
  3. Django Channels Real-time Layer (`channels_redis.core.RedisChannelLayer` with prefix `adarsh:realtime`)
  4. Live Client Presence Tracking (`core.services.live_presence_service`)
  5. Permission Invalidation Event Bus (`core.services.session_revalidation`)
  6. Export & Bulk Operation Concurrency Locks

---

## 7. Django REST Framework & API Architecture

* **API Architecture:** Custom lightweight REST API architecture in `mobile_api`, `desktop_app`, and `web_app`.
* **Authentication:** Custom Bearer/Header Token Authentication (`X-App-Token`, `Authorization: Bearer ********`), PWA Bootstrap Tokens, and Session Authentication.
* **Permissions:** Programmatic permission evaluation via `core.services.permission_service` and custom view decorators/mixins.
* **Pagination:** Custom limit-offset and page-number pagination for bulk card data APIs.
* **Renderers:** `JsonResponse` for API endpoints; WhiteNoise for static assets; WeasyPrint/ReportLab streaming renderers for PDF documents.
* **Parsers:** Standard JSON Parser, Multipart Form Parser for image uploads, and URL-encoded parsers.
* **Throttling:** Request rate throttling in middleware (`PermissionValidationMiddleware`, `RequestTimingMiddleware`) and API view handlers.
* **Serializers:** Lightweight dict-based serializers and model transformation functions located in `mobile_api/views.py` and `core/services/idcard_card_service.py`.
* **ViewSets / APIViews:** APIViews in `mobile_api/views.py` and `desktop_app/views.py`. Total API endpoints: **526**.

---

## 8. URLs

* **Root URLConf:** `config.urls`
* **Total Endpoint Count:** **662** registered URL endpoints
* **Admin URLs:** 1 (`/admin/`)
* **API URLs:** **526** endpoints across `mobile_api/urls.py`, `desktop_app/urls.py`, `web_app/urls.py`, and `core/views/idcard_card_api.py`
* **Public URLs:**
  - `/` (Landing Page)
  - `/login/` (Login Page)
  - `/guest/` (Guest Sandbox Entry)
  - `/static/*` & `/media/*` (Static and Media resources)
* **Authenticated URLs:**
  - `/dashboard/` (Main User Dashboard)
  - `/panel/*` (Administrative Panel & System Config)
  - `/client/*` (Client Portal & ID Card Management)
  - `/operators/*` (Operator Portal & Assignments)
  - `/assistants/*` (Assistant Portal)
  - `/exports/*` (PDF, Excel, ZIP Exports)

---

## 9. Models Breakdown

Total Models: **18**

1. `core.User` (Table: `core_user`)
   - **Fields (15):** `id`, `username`, `password`, `first_name`, `last_name`, `email`, `is_staff`, `is_active`, `is_superuser`, `last_login`, `date_joined`, `role`, `phone`, `force_password_change`, `created_at`
   - **Foreign Keys (0):** None
   - **Many-To-Many (2):** `groups`, `user_permissions`
   - **Managers:** `objects`

2. `core.Client` (Table: `core_client`)
   - **Fields (38):** `id`, `client_id`, `name`, `status`, `phone`, `email`, `address`, `school_name`, `logo`, `created_at`, `updated_at`, etc.
   - **Foreign Keys (1):** `user` -> `User`
   - **Managers:** `objects`

3. `core.IDCard` (Table: `core_idcard`)
   - **Fields (28):** `id`, `card_id`, `client`, `full_name`, `father_name`, `mother_name`, `dob`, `class_name`, `section`, `roll_number`, `admission_no`, `mobile_number`, `blood_group`, `address`, `photo`, `status`, `field_data`, `created_at`, `updated_at`, etc.
   - **Foreign Keys (1):** `client` -> `Client`
   - **Managers:** `objects`

4. `accounts.UserDeviceSession` (Table: `accounts_userdevicesession`)
   - **Fields (7):** `id`, `user`, `session_key`, `device_name`, `ip_address`, `last_active`, `created_at`
   - **Foreign Keys (1):** `user` -> `User`
   - **Indexes (2):** `session_key`, `last_active`

5. `mediafiles.CardMedia` (Table: `mediafiles_cardmedia`)
   - **Fields (9):** `id`, `idcard`, `file`, `file_type`, `category`, `file_size`, `thumbnail`, `created_at`, `updated_at`
   - **Foreign Keys (4):** `idcard` -> `IDCard`, `client` -> `Client`, `uploaded_by` -> `User`, `operator` -> `Operator`
   - **Indexes (6):** Indexes on `idcard`, `category`, `created_at`

6. `operators.Operator` (Table: `operators_operator`)
   - **Fields (44):** Profile configuration, status, assigned client settings, permissions
   - **One-to-One (1):** `user` -> `User`
   - **Many-to-Many (1):** `assigned_clients` -> `Client`

7. `assistants.Assistant` (Table: `assistants_assistant`)
   - **Fields (48):** Assistant details, assigned groups, scope limits
   - **One-to-One (1):** `user` -> `User`
   - **Foreign Keys (1):** `client` -> `Client`
   - **Many-to-Many (1):** `assigned_groups`

8. `stats.StatsSnapshot` (Table: `stats_statssnapshot`)
   - **Fields (10):** `id`, `timestamp`, `cpu_percent`, `memory_percent`, `active_sessions`, `db_connections`, etc.

9. `stats.ServerLoadAlert` (Table: `stats_serverloadalert`)
   - **Fields (4):** `id`, `timestamp`, `alert_type`, `message`

10. `mobile_api.MobileDeviceToken` (Table: `mobile_device_tokens`)
    - **Fields (4):** `id`, `user`, `device_id`, `token`
    - **Foreign Keys (1):** `user` -> `User`

11. `desktop_app.DesktopAppDevice` (Table: `desktop_app_desktopappdevice`)
    - **Fields (12):** Device UUID, connection status, auth token, last sync timestamp
    - **Indexes (3):** `device_uuid`, `auth_token`, `last_seen`

---

## 10. ORM Analysis

Codebase Search Results for Django ORM Operations:

| ORM Operation | Occurrences | Purpose / Locations |
| :--- | :--- | :--- |
| `select_related()` | **244** | Optimization of foreign key queries (`IDCard.client`, `CardMedia.idcard`) |
| `prefetch_related()` | **31** | Optimization of M2M queries (`User.groups`, `Operator.assigned_clients`) |
| `only()` | **548** | Restricting fetched database columns for high-throughput card list views |
| `defer()` | **4** | Deferring heavy text/binary fields |
| `bulk_create()` | **17** | High-performance batch insertion during bulk Excel/CSV card uploads |
| `bulk_update()` | **21** | Batch status updates, card approval/rejection workflows |
| `annotate()` | **165** | Aggregating card counts per client, total photos per operator |
| `aggregate()` | **24** | Computing totals, max timestamps, server metrics summary |
| `exists()` | **308** | Fast boolean existence checks for duplicate roll numbers / phone numbers |
| `count()` | **2083** | Counting cards, users, logs, and total pagination records |
| `values()` | **603** | Fetching lightweight dictionary subsets for JSON APIs |
| `values_list()` | **157** | Extracting flat lists of primary keys / identifiers |
| `iterator()` | **58** | Memory-efficient streaming of large querysets during ZIP/PDF exports |
| Raw SQL (`raw()`) | **977** | Complex search, dynamic column queries, and high-performance reporting |
| `Subquery()` | **4** | Correlated subqueries for latest card media items |
| `OuterRef()` | **15** | References to outer query fields within subqueries |
| `F()` Expressions | **18** | Atomic database field increments and comparisons |
| `Window()` Functions| **1** | Analytical windowing functions for row numbering in card exports |

---

## 11. Views Breakdown

* **Function-Based Views (FBVs):** ~250 views across `client/views.py`, `exports/views.py`, `reprintcard/views.py`, `operators/views.py`, `assistants/views.py`.
* **Class-Based Views (CBVs):** ~80 views in `core/views/`, `accounts/views.py`, `mobile_api/views.py`.
* **APIViews / GenericAPIViews:** API view classes in `mobile_api/views.py` and `desktop_app/views.py`.
* **Async Views / Channels Consumers:** WebSocket event handlers in `core/consumers.py` and `desktop_app/consumers.py`.
* **Streaming Responses:** Streaming file export views (`FileResponse`, `StreamingHttpResponse`) in `exports/views.py` and `exports/zip.py`.
* **File Download Handlers:** ZIP archives, PDF card bundles, and Excel templates export handlers.
* **Large Loops & Complex View Operations:** Bulk photo cropper batch processing, Excel folder ingest parsers, and ZIP generation iterators.

---

## 12. Serializers

* **Serializer Architecture:** Custom dict-based JSON serializers and model transformation functions (DRF standard serializers optional; lightweight native serializers used for maximum speed).
* **Nested Serializers:** Nested client-card-media dict structures in `mobile_api/views.py`.
* **Computed Fields (`SerializerMethodField` equivalent):** Dynamic photo thumbnail URL construction, absolute media path resolution, and permission flag computations.
* **Depth Usage:** Flat and 2-level nested dict responses for mobile endpoints.

---

## 13. Celery & Background Processing

* **In-Process Task Worker:** Native multi-threaded background worker engine (`core/services/background_worker.py`, `core/services/task_queue.py`).
* **Concurrency Settings:** `BACKGROUND_WORKER_MAX_WORKERS` (Default: `2`, configurable 1 to 4).
* **Heavy Concurrency Cap:** `BACKGROUND_HEAVY_TASK_CONCURRENCY` (Default: `1` to prevent memory exhaustion during PDF/ZIP generation).
* **Celery Configuration (Optional Broker):** Scaffolded in `config/celery.py` with environment toggles (`CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `CELERY_TASK_ALWAYS_EAGER`).
* **Background Tasks:**
  1. Threaded Email Dispatch (`core/utils/threaded_email.py`)
  2. Card Export ZIP Generator (`core/services/export_processor.py`)
  3. Bulk Card Ingest & Photo Normalization (`core/services/bulk_upload_processor.py`)
  4. Automatic Session & Temp File Cleanup (`core/services/task_cleanup.py`)
  5. Live Telemetry & Server Load Alert Monitoring (`stats/services.py`)

---

## 14. Storage Engine

* **Media File Storage (`default`):** `django.core.files.storage.FileSystemStorage`
* **Media Directory (`MEDIA_ROOT`):** `BASE_DIR / 'media'`
* **Media URL (`MEDIA_URL`):** `/media/`
* **Nginx X-Accel-Redirect (`MEDIA_USE_XACCEL`):** Configured (`False` by default; toggled via `MEDIA_USE_XACCEL` env var when Nginx serves internal media).
* **Static File Storage (`staticfiles`):** `whitenoise.storage.CompressedManifestStaticFilesStorage`
* **Static Directory (`STATIC_ROOT`):** `BASE_DIR / 'staticfiles'`
* **Static URL (`STATIC_URL`):** `/static/`
* **Cloud Storage (S3 / Cloudflare R2 / MinIO):** Not currently active; local disk storage used with WhiteNoise and optional Nginx pass-through.
* **File Upload Limits:**
  - `DATA_UPLOAD_MAX_MEMORY_SIZE`: **512 MB** (`536,870,912` bytes)
  - `FILE_UPLOAD_MAX_MEMORY_SIZE`: **25 MB** (`26,214,400` bytes)
  - `DATA_UPLOAD_MAX_NUMBER_FILES`: **6,000** files per upload request

---

## 15. Authentication & User Management

* **User Model (`AUTH_USER_MODEL`):** `core.User`
* **Session Engine:** `django.contrib.sessions.backends.cached_db`
* **Session Expiry (`SESSION_COOKIE_AGE`):** `2,592,000` seconds (30 Days)
* **Session Idle Timeout (`SESSION_IDLE_TIMEOUT`):** 30 Days (Configurable via env)
* **Session Fingerprinting (`SESSION_FINGERPRINT_ENABLED`):** Enabled in production (`SESSION_FINGERPRINT_INCLUDE_IP = False`)
* **Device Session Management:** Custom `UserDeviceSession` model tracking active sessions per device.
* **Mobile / Desktop API Auth:** Bearer Token and PWA Bootstrap Token verification (`DESKTOP_APP_BOOTSTRAP_TOKEN`).
* **Password Validation Baseline:** `MinimumLengthValidator` (min length: 6 characters).
* **Role Hierarchy:**
  - `SuperAdmin`: Full system control & administrative access
  - `Client`: School / Institute Administrator
  - `Operator`: Data Entry & Card Verification Operator
  - `Assistant`: Assistant Operator with delegated client scopes
  - `Staff`: Staff Member with read/write access to assigned clients

---

## 16. Security Infrastructure

* **CORS / CSRF Trusted Origins:** Configured via `CSRF_TRUSTED_ORIGINS` environment variable (Auto-detects Render hostnames).
* **HTTPS Redirect (`SECURE_SSL_REDIRECT`):** Enabled in production when `DEBUG=False`.
* **HSTS Configuration:**
  - `SECURE_HSTS_SECONDS`: `31,536,000` (1 Year)
  - `SECURE_HSTS_INCLUDE_SUBDOMAINS`: `True`
  - `SECURE_HSTS_PRELOAD`: `True`
* **Secure Cookie Flags:**
  - `SESSION_COOKIE_HTTPONLY`: `True`
  - `SESSION_COOKIE_SECURE`: `True` (when `DEBUG=False`)
  - `SESSION_COOKIE_SAMESITE`: `Lax`
  - `CSRF_COOKIE_SECURE`: `True` (when `DEBUG=False`)
  - `CSRF_COOKIE_SAMESITE`: `Lax`
* **Allowed Hosts (`ALLOWED_HOSTS`):** Enforced via environment variable in production.
* **HTTP Security Headers:**
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=(), usb=()`
* **CSRF Failure Handler:** `core.views.errors.csrf_failure`

---

## 17. Logging & Error Monitoring

* **Logging Configuration:** Configured in `settings.LOGGING`
* **Log Handlers:**
  - `console`: Standard output stream handler
  - `file_app`: Rotating file handler (`logs/app.log`, 10MB max, 5 backups; enabled when `LOG_TO_FILE=True`)
  - `file_error`: Rotating file handler (`logs/error.log`, 10MB max, 10 backups)
  - `file_security`: Security log handler (`logs/security.log`, 10MB max, 10 backups)
  - `file_queries`: Slow query log handler (`logs/queries.log`, 10MB max, 3 backups)
* **Log Formatters:** `verbose` (`[{asctime}] {levelname} {name} {module}.{funcName}:{lineno} — {message}`) and `simple`
* **Error Monitoring (Sentry SDK):**
  - Optional lazy initialization controlled by `SENTRY_DSN` env variable
  - Integrations: `DjangoIntegration()`, `LoggingIntegration(level=INFO, event_level=ERROR)`
  - Traces Sample Rate: Configurable (`SENTRY_TRACES_SAMPLE_RATE`)
  - Release Version: Read from `VERSION.txt`

---

## 18. Signals Inventory

Total Registered Signals: **17** active signal bindings

| Signal Name | Sender | Receiver Function |
| :--- | :--- | :--- |
| `post_save` | `IDCard` | `clear_idcard_distinct_values_cache` |
| `post_save` | `User` | `core.services.session_revalidation._on_user_saved` |
| `post_save` | `Client` | `core.services.session_revalidation._on_client_saved` |
| `post_save` | `Operator` | `core.services.session_revalidation._on_profile_saved` |
| `post_save` | `Assistant` | `core.services.session_revalidation._on_profile_saved` |
| `pre_delete` | `CardMedia` | `mediafiles.models.cleanup_cardmedia_file` |
| `post_delete` | `IDCard` | `clear_idcard_distinct_values_cache` |
| `m2m_changed` | `User.groups` | `core.services.session_revalidation._on_user_m2m_changed` |
| `m2m_changed` | `User.user_permissions` | `core.services.session_revalidation._on_user_m2m_changed` |
| `m2m_changed` | `Operator.assigned_clients` | `core.services.session_revalidation._on_profile_m2m_changed` |
| `m2m_changed` | `Assistant.assigned_groups` | `core.services.session_revalidation._on_profile_m2m_changed` |
| `request_started` | Django Request Handler | `django.db.reset_queries` |
| `request_started` | Django Request Handler | `django.db.close_old_connections` |
| `request_finished` | Django Request Handler | `django.db.close_old_connections` |
| `request_finished` | Django Request Handler | `django.core.cache.close_caches` |
| `request_finished` | Django Request Handler | `django.urls.resolvers.reset_urlconf` |
| `got_request_exception` | Django Request Handler | `sentry_sdk.integrations.django._got_request_exception` |

---

## 19. Custom Management Commands

Total Custom Management Commands: **27** local commands (36 total commands including Django built-ins)

1. `audit_phone_passwords` - Audits accounts with phone-number-based default passwords
2. `audit_user_auth` - Checks user auth states and password hashes
3. `backfill_assistant_welcome_emails` - Dispatches welcome emails to assistant users
4. `backfill_client_staff_scope_assignments` - Scopes legacy client staff assignments
5. `backfill_legacy_photo_to_field_data` - Migrates legacy photos into `field_data` JSONB
6. `bump_app_version` - Increments `VERSION.txt` semantic versioning tag
7. `check_auth_lockout` - Audits locked out accounts and IP failure counts
8. `cleanup_apostrophes` - Sanitizes rogue apostrophes in text fields
9. `clear_auth_lockout` - Resets lockout counters for specific IP/user
10. `clear_client_pending_image_refs` - Cleans up missing photo references
11. `convert_thumbs_to_webp` - Batch converts JPEG thumbnails to compressed WebP format
12. `create_pro_user` - Bootstraps new pro user account with elevated scopes
13. `delete_client` - Safely cascades client removal and associated card media
14. `enable_assistant_permissions` - Grant default permissions to assistant profiles
15. `ensure_missing_card_thumbnails` - Regenerates missing card photo thumbnails
16. `fix_bare_filenames` - Normalizes media path file names
17. `fix_dob_format` - Normalizes Date-of-Birth values to ISO format (`YYYY-MM-DD`)
18. `list_users_without_passwords` - Audits unusable / blank password accounts
19. `normalize_image_fields` - Batch resizes and fixes EXIF orientation on card photos
20. `rename_uuid_images_to_timestamp` - Renames media items to timestamped filenames
21. `report_custom_password_users` - Reports accounts using custom passwords
22. `reset_client_staff_passwords` - Batch resets client staff passwords
23. `restore_photo_from_cardmedia` - Restores missing card main photos from `CardMedia`
24. `restore_renamed_relation_photo_fields` - Restores relation photo field references
25. `restore_reprint_rejected_cards` - Reinstates rejected cards back to reprint queue
26. `revert_kg_dash_for_client` - Restores class section naming conventions
27. `sanitize_field_data` - Cleans up invalid keys in JSON `field_data`

---

## 20. Services Architecture

Total Service Modules: **46**

* **Accounts Services:** `services.py`, `services_impersonate.py`, `services_profile.py`
* **Assistant Services:** `assistants/services.py`
* **Client Portal Services:** `client/services.py`, `services_access.py`, `services_card.py`, `services_client_core.py`, `services_dashboard.py`, `services_image.py`, `services_sandbox.py`, `services_staff.py`
* **Core Business Services:**
  - `core/services/activity_service.py` (System activity logging & audit trail)
  - `core/services/background_worker.py` (In-process ThreadPool execution engine)
  - `core/services/backup_service.py` (Database & media backup management)
  - `core/services/bulk_upload_processor.py` (Excel/CSV card import pipeline)
  - `core/services/cache_version_service.py` (Cache invalidation control)
  - `core/services/crop_service.py` (OpenCV/PIL auto photo cropper)
  - `core/services/export_processor.py` (PDF & ZIP batch export processor)
  - `core/services/idcard_card_service.py` (Card CRUD & state transitions)
  - `core/services/idcard_table_service.py` (High-performance SQL card querying)
  - `core/services/live_presence_service.py` (Redis-backed live presence)
  - `core/services/maintenance_service.py` (Maintenance mode toggle service)
  - `core/services/permission_service.py` (Role & scope permission checker)
  - `core/services/realtime_service.py` (WebSocket notification dispatcher)
  - `core/services/reupload_processor.py` (Bulk photo re-upload processor)
  - `core/services/session_revalidation.py` (Real-time session permission invalidation)

---

## 21. Utilities Suite

Total Utility Modules: **11**

1. `core/utils/email_utils.py` - Standard email template rendering and delivery
2. `core/utils/field_utils.py` - Dynamic model field manipulation and parsing
3. `core/utils/folder_image_ingest.py` - ZIP/Folder image upload ingester
4. `core/utils/htmx.py` - HTMX request detection and partial render response helpers
5. `core/utils/secure_credentials.py` - Safe environment credential retrieval
6. `core/utils/template_rich_text.py` - Rich text rendering for dynamic templates
7. `core/utils/threaded_email.py` - Asynchronous background email delivery
8. `core/utils/upload_security.py` - File extension, mime-type, and magic bytes validation
9. `core/views/base_helpers.py` - Common view responses and pagination wrappers
10. `core/views/idcard_helpers.py` - ID Card status badge formatting and helpers
11. `exports/utils.py` - PDF page calculation and ZIP stream formatting utilities

---

## 22. Background Processing Systems

All background tasks executed outside the standard HTTP request-response cycle:

1. **In-Process Background ThreadPool Worker:** `core.services.background_worker` manages asynchronous task queues with worker pool concurrency limits (`BACKGROUND_WORKER_MAX_WORKERS`).
2. **Threaded Email Dispatcher:** `core.utils.threaded_email` spawns background daemon threads for non-blocking SMTP email delivery.
3. **Django Channels Consumer Engine:** `channels_redis` handles real-time WebSocket channel layers (`adarsh:realtime`) for client presence and live card updates.
4. **Celery Task Worker Scaffold:** `config/celery.py` provides off-process task execution when external Redis broker is attached.
5. **Periodic Task Cleanup:** `core.services.task_cleanup` automatically cleans expired temporary export files, orphaned thumbnails, and stale guest sandboxes.

---

## 23. External API Integrations

* **Email Service (SMTP):** Configured via `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, and `EMAIL_HOST_PASSWORD` (masked `********`).
* **YouTube Video Embed API:** Configured via `CLIENT_TUTORIAL_VIDEO_URL` for client training materials.
* **Landing Website Web App Integration:** Secured via `WEB_APP_API_KEY` API header authentication (masked `********`).
* **Desktop App API Integration:** Authenticated via `DESKTOP_APP_BOOTSTRAP_TOKEN` for native desktop sync.
* **Mobile REST API:** Token-authenticated REST endpoints for Android and iOS mobile apps (`LATEST_MOBILE_VERSION`).

---

## 24. Performance & Heavy Operation Analysis

Codebase Keyword Search Breakdown:

| Search Keyword | Findings Count | Description / Locations |
| :--- | :--- | :--- |
| `time.sleep` | **4** | Used in retry loops & background worker polling |
| `requests.` | **12** | Sentry envelope posting & external web app sync |
| `subprocess.` | **3** | Git describe version fetching (`settings._get_app_version`) |
| `PIL` (Pillow) | **38** | Image processing, thumbnail generation, rotation |
| `cv2` (OpenCV) | **14** | Face detection & passport photo cropping (`crop_service.py`) |
| `ThreadPoolExecutor` | **6** | Background worker pool & async email dispatch |
| `ProcessPoolExecutor` | **0** | Not used |
| `multiprocessing` | **0** | Not used |
| `openpyxl` | **22** | Parsing uploaded Excel spreadsheets & generating reports |
| `WeasyPrint` | **8** | HTML-to-PDF rendering engine for high-resolution print cards |
| `zipfile` | **15** | In-memory ZIP archive generation for card photos |

---

## 25. File Processing Stack

* **PDF Documents:** WeasyPrint (`weasyprint` 68.1), PyPDF (`pypdf` 6.9.2), ReportLab (`reportlab` 4.4.9), xhtml2pdf (`xhtml2pdf` 0.2.17), rlPyCairo (`rlPyCairo` 0.4.0).
* **Images:** Pillow (`pillow` 12.1.1), OpenCV (`opencv-python-headless` 4.8.0), PyCairo (`pycairo` 1.29.0), svglib (`svglib` 1.6.0), pillow-heif (`pillow-heif` 1.3.0).
* **Videos:** imageio-ffmpeg (`imageio-ffmpeg` 0.6.0) for video thumbnail generation and media preview processing.
* **ZIP Archives:** Standard Python `zipfile` module used in `exports/zip.py` for streaming photo downloads.
* **Excel Spreadsheets:** OpenPyXL (`openpyxl` 3.1.5) for `.xlsx` import/export; xlrd (`xlrd` 2.0.2) for legacy `.xls` format.
* **CSV Files:** Native Python `csv` module for fast card data exports.
* **Word Documents:** Python-Docx (`python-docx` 1.2.0) for Word document template exports.

---

## 26. Settings Summary (Secrets Masked)

Non-sensitive production settings extracted from `config/settings.py`:

```python
# Core Settings
DEBUG = False
ALLOWED_HOSTS = ['********']  # Configured via environment
SECRET_KEY = '********'

# Subdomain / Domain URLs
PANEL_URL = '********'
SITE_URL = '********'
WEB_APP_API_KEY = '********'

# Installed Applications
INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'channels',
    'core',
    'accounts',
    'client',
    'exports',
    'mediafiles',
    'staff',
    'operators',
    'assistants',
    'stats',
    'idcards',
    'reprintcard',
    'panel',
    'mobile_api',
    'desktop_app',
    'web_app',
]

# User & Database Routing
AUTH_USER_MODEL = 'core.User'
DATABASE_ROUTERS = ['core.db_router.GuestSandboxRouter']

# Database Configuration
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': '********',
        'USER': '********',
        'PASSWORD': '********',
        'HOST': '********',
        'PORT': '5432',
        'CONN_MAX_AGE': 600,
        'CONN_HEALTH_CHECKS': True,
    }
}

# Cookie & Session Security
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_AGE = 2592000  # 30 Days
SESSION_ENGINE = 'django.contrib.sessions.backends.cached_db'

# Static & Media Storage
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
MEDIA_USE_XACCEL = False
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# Upload Limits
DATA_UPLOAD_MAX_MEMORY_SIZE = 536870912  # 512 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 26214400   # 25 MB
DATA_UPLOAD_MAX_NUMBER_FILES = 6000

# Cache & Redis Configuration
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': 'redis://********:6379/1',
        'TIMEOUT': 300,
        'KEY_PREFIX': 'adarsh',
        'VERSION': 1,
    }
}

# Real-Time Channel Layer
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': ['redis://********:6379/1'],
            'capacity': 1500,
            'expiry': 30,
            'prefix': 'adarsh:realtime',
        },
    }
}

# Email Backend Configuration
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = '********'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = '********'
EMAIL_HOST_PASSWORD = '********'
DEFAULT_FROM_EMAIL = '********'

# App Version & Thresholds
APP_VERSION = 'v1.0.56'
SLOW_REQUEST_THRESHOLD = 1.5
QUERY_COUNT_THRESHOLD = 50
SLOW_QUERY_THRESHOLD = 0.1
```

---

## 27. Dependency List (`requirements.txt`)

Complete list of pinned dependencies from `requirements.txt`:

| Package Name | Version | Purpose |
| :--- | :--- | :--- |
| `Django` | `5.2.12` | Web Framework Core |
| `channels` | `4.2.2` | WebSockets & Async Channel Layer |
| `channels-redis` | `4.2.1` | Redis Backend for Channels |
| `gunicorn` | `25.0.1` | Production WSGI Web Server |
| `uvicorn` | `0.38.0` | ASGI Web Server |
| `psycopg2-binary` | `2.9.11` | PostgreSQL Database Driver |
| `dj-database-url` | `3.1.0` | 12-Factor Database Configuration |
| `redis` | `7.2.0` | Redis Client Library |
| `celery` | `>=5.4,<6.0` | Background Task Queue |
| `pillow` | `12.1.1` | Image Processing Library |
| `pillow-heif` | `1.3.0` | HEIC/HEIF Image Support |
| `opencv-python-headless` | `>=4.8.0.76` | Computer Vision & Passport Cropper |
| `weasyprint` | `68.1` | HTML to PDF Renderer |
| `reportlab` | `4.4.9` | PDF Generation Engine |
| `pypdf` | `6.9.2` | PDF Inspection & Splitter |
| `openpyxl` | `3.1.5` | Excel File Manipulation |
| `python-docx` | `1.2.0` | Word File Generator |
| `whitenoise` | `6.11.0` | Production Static File Serving |
| `sentry-sdk` | `>=1.29.0` | Sentry Error Telemetry & Tracing |
| `cryptography` | `46.0.6` | Security Cryptographic Primitives |
| `python-dotenv` | `1.2.1` | Environment Variable Loader |
| `requests` | `2.33.0` | HTTP Client Library |
| `asgiref` | `3.11.0` | ASGI Interface Utilities |

---

## 28. Production Server Configuration

* **WSGI Server:** Gunicorn (`gunicorn` 25.0.1) configured in `config/gunicorn.conf.py`
  - **Worker Processors:** CPU-bound worker calculation (`workers = multiprocessing.cpu_count() * 2 + 1`)
  - **Worker Class:** `sync` (Gunicorn default)
  - **Timeout:** `120` seconds
  - **Bind Socket:** `0.0.0.0:8000`
* **ASGI Server:** Uvicorn (`uvicorn` 0.38.0) handling WebSocket channel traffic via `config/asgi.py`
* **Static Asset Delivery:** WhiteNoise (`whitenoise.storage.CompressedManifestStaticFilesStorage`) with content-hashing for immutable static caching
* **Reverse Proxy SSL Termination:** Supported via `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')`

---

## 29. TODOs & Code Debt

Audit Scan Results for `TODO`, `FIXME`, `HACK`, and `XXX` tags:

1. `mobile_api/views.py:7329` `[XXX]` -> `'phone': '+91-XXXXXXXXXX',` (Placeholder phone string in mobile API test response)
2. `mobile_api/views.py:7331` `[XXX]` -> `'whatsapp': '91XXXXXXXXXX',` (Placeholder whatsapp string in mobile API test response)
3. `core/tests.py:1791` `[HACK]` -> `data=json.dumps({'field': '__HACK__', 'value': 'x'}),` (Test harness mock input)
4. `core/tests.py:1801` `[HACK]` -> `self.assertNotIn('__HACK__', self.card_a.field_data)` (Test assertion check)

---

## 30. Code Base Statistics

* **Total Python Files:** **387** files
* **Total Lines of Code (LOC):** **95,913** lines of Python code

### Top 15 Largest Files by Lines of Code (LOC)

| File Path | Lines of Code (LOC) | Size in Bytes | Category |
| :--- | :--- | :--- | :--- |
| `mobile_api/views.py` | **7,868** | 350,846 B | View Layer / API |
| `core/tests.py` | **4,369** | 185,140 B | Test Suite |
| `client/tests.py` | **2,853** | 122,669 B | Test Suite |
| `core/views/idcard_card_api.py` | **2,288** | 99,896 B | View Layer / API |
| `exports/tests.py` | **2,109** | 88,498 B | Test Suite |
| `core/services/activity_service.py` | **2,007** | 83,994 B | Service Layer |
| `exports/zip.py` | **1,706** | 71,178 B | Export Engine |
| `core/services/idcard_card_service.py` | **1,687** | 81,472 B | Service Layer |
| `exports/views.py` | **1,680** | 65,461 B | View Layer |
| `accounts/tests.py` | **1,663** | 68,325 B | Test Suite |
| `core/services/idcard_bulk_service.py` | **1,540** | 62,310 B | Service Layer |
| `client/services_card.py` | **1,492** | 60,115 B | Service Layer |
| `core/views/idcard_views.py` | **1,452** | 58,920 B | View Layer |
| `config/settings.py` | **1,053** | 42,021 B | Settings Config |
| `core/middleware.py` | **1,310** | 52,140 B | Middleware |

---

*Report generated automatically for `Adarsh Admin New` project.*
