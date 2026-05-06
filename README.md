# Adarsh ID Cards - Management Platform

A production-grade Django platform for end-to-end ID card operations at school/college/organization scale.

This system covers the full lifecycle:

- client/staff onboarding
- dynamic ID card schema design
- card data entry and bulk ingestion
- image upload, reupload, and media normalization
- print and reprint workflows
- export pipelines (PDF/XLSX/DOCX/ZIP)
- mobile PWA access
- public marketing website and content pipeline

Live domains:

- Website: https://adarshbhopal.in
- Panel: https://panel.adarshbhopal.in

Current version source of truth:

- VERSION.txt: v3.19.0
Last deep README refresh: 2026-04-16

### Trusted Clients — Persistent Logo Cover Colors (2026-05-02)

- Purpose: Prevent the trusted-client card cover from re-deriving the logo color on every page load. The platform now computes a representative theme color once when a client `website_logo` is uploaded and persists that value on the `Client` record. The public trusted-clients pages read and render the stored gradient rather than computing it in the browser each request.

- Files changed:
  - `client/models.py` — added `website_logo_cover_color` and `website_logo_cover_color_dark` fields to store the primary and darker hex colors.
  - `website/services.py` — added `_extract_logo_theme_colors()` and now computes and saves the two-color theme pair when a logo is uploaded or replaced.
  - `website/views.py` — the trusted-clients view now includes the persisted color values in the template context.
  - `templates/website/trusted-clients.html` — removed the client-side canvas color extraction and now renders a stable `linear-gradient(...)` when persisted colors exist.
  - `core/migrations/0073_client_website_logo_cover_colors.py` — adds the new fields and backfills existing logos with computed colors as part of the migration.

- Why this change: Runtime canvas-based color extraction caused visual flicker and recomputation on every page load, making the card cover shift from a default blue to logo-derived colors repeatedly. Persisting the computed value keeps UI stable and reduces client-side processing.

- Developer notes / deployment steps:
  1. Run migrations on your target environment to add the new fields and backfill existing logos:

     ```bash
     python manage.py migrate
     ```

  2. Verify the instance checks:

     ```bash
     python manage.py check
     ```

  3. If you need to revert the schema change (not recommended for production), migrate the `core` app back to the previous migration (0072):

     ```bash
     python manage.py migrate core 0072
     ```

  4. The migration runs a light image pixel sampling of each `website_logo` to compute a representative color. On very large numbers of logos, allow the migration to run with sufficient time and disk I/O; it is safe to run during low-traffic windows.

- Rollout consideration: Because the trusted-clients page now reads colors from the database, newly-uploaded logos will show the correct gradient immediately after upload. Existing cached pages may need their cache invalidated (clear site cache or wait for the cache TTL) to see backfilled colors.


---

## Table of Contents

1. [Latest Highlights](#latest-highlights)
2. [Tech Stack](#tech-stack)
3. [Architecture Overview](#architecture-overview)
4. [Repository Structure](#repository-structure)
5. [Django Apps and Responsibilities](#django-apps-and-responsibilities)
6. [Core Data Model and Workflows](#core-data-model-and-workflows)
7. [Permissions and Role Model](#permissions-and-role-model)
8. [Bulk Upload and Reupload Engine](#bulk-upload-and-reupload-engine)
9. [Background Task System](#background-task-system)
10. [Export System](#export-system)
11. [Media, Watermark, and Video Processing](#media-watermark-and-video-processing)
12. [Routing and URL Topology](#routing-and-url-topology)
13. [PWA Mobile App](#pwa-mobile-app)
14. [Face Cropper Engine](#face-cropper-engine)
15. [Security and Middleware](#security-and-middleware)
16. [Build and Frontend Asset Pipeline](#build-and-frontend-asset-pipeline)
17. [Setup and Local Development](#setup-and-local-development)
18. [Testing and Quality Checks](#testing-and-quality-checks)
19. [Management Commands](#management-commands)
20. [Environment Variables](#environment-variables)
21. [Deployment Guide](#deployment-guide)
22. [Operations Runbook](#operations-runbook)
23. [Recent Change Log](#recent-change-log)
24. [License](#license)

---

## Latest Highlights

This section summarizes important recent platform-level updates now live on main.

### 1) Multi-image bulk upload/reupload reliability improvements

- Semantic image header matching now supports cases where uploads use labels like SIGNATURE, FATHER, MOTHER, QR without explicit PHOTO suffix.
- Bulk upload matching now isolates field ZIP indexes by column and uses unified ZIPs only as fallback.
- This prevents cross-column collisions when multiple ZIPs contain same names (for example 1.jpg in both Photo ZIP and Signature ZIP).
- Reupload task APIs and processors now support all-image-fields default behavior when target_field is omitted.
- Reupload still supports targeted single/multi-field mode when explicitly provided.
- Mobile edit/add multi-photo submissions now avoid unintended primary-photo replacement by ignoring legacy photo fallback when explicit image_field uploads are present.

### 2) Reprint modal load stability fix

- Reprint list API relation-photo media fallback path has been hardened.
- Backend runtime error path that could surface as Failed to load reprint list has been fixed.
- Regression coverage has been added for relation-photo media_type fallback behavior.

### 3) Migration hardening for production divergence

- Added compatibility merge migrations in core to absorb historical branch graph drift on mixed environments.
- CardTemplate production migration was updated for PostgreSQL trigger-event safety (non-atomic migration path).
- This reduces risk of InconsistentMigrationHistory and pending trigger event failures during deploy.

### 4) Mobile and runtime hardening updates

- Mobile upload timeout and action overlay UX hardening.
- Legacy mobile/PWA photo crop flow removed where applicable.
- Dashboard/runtime caching and production tuning improvements.

### 5) Build and deploy safety improvements

- Windows-safe CSS build flow with rollback protection in build-css.bat.
- Bundled JS/CSS dist build integrated into the same build flow.
- Better guardrails around missing static marker tokens during CSS builds.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Backend | Django 5.2.12, Python 3.11+ | Main application framework |
| Database | SQLite (dev), PostgreSQL (prod) | Persistent storage |
| Cache/Locks | Redis (prod), LocMem (dev fallback) | Rate limit, OTP, task locks, cache |
| Frontend | Tailwind CSS CLI 4.2, Alpine.js, HTMX, vanilla JS | Responsive interactive UI |
| Static Serving | WhiteNoise | Compressed hashed static assets |
| Image Processing | Pillow, pillow-heif | Image validation, conversion, optimization |
| Video Processing | ffmpeg (via subprocess), imageio-ffmpeg | Reel compression and compatibility |
| PDF | ReportLab, xhtml2pdf, WeasyPrint | Export rendering (with fallback strategy) |
| Excel | openpyxl, xlrd | Import/export sheet support |
| Word | python-docx | DOCX exports |
| Digital Sign | pyHanko | PDF signing workflows |
| Deployment | Gunicorn + Nginx + systemd | Production runtime stack |
| Config | python-dotenv | Environment-based settings |
| External Engine | FastAPI + PyInstaller | Windows face-crop service |

---

## Architecture Overview

High-level request path:

1. Nginx accepts request and handles TLS.
2. Gunicorn serves Django.
3. SubdomainRoutingMiddleware chooses panel or website URLConf.
4. Permission and security middleware enforce scope and policies.
5. Thin views delegate to services.
6. Services perform business logic and database writes.
7. Optional background task worker handles heavy operations.

Design principles:

- Thin views, heavy services.
- Permission-first enforcement.
- Memory-conscious processing for low-RAM hosts.
- Audit logging for sensitive operations.
- Shared service layer used by desktop and mobile APIs.

---

## Repository Structure

Top-level highlights:

- accounts: authentication, OTP, profile helpers, rate limiting
- cardprint: print queue workflows
- reprintcard: reprint workflows and APIs
- client: client management and scoped dashboards
- core: central services, middleware, APIs, monitoring, task APIs
- exports: PDF/XLSX/DOCX/ZIP export engine
- idcards: ID card models (group/table/card)
- mediafiles: protected card media storage and processing
- mobile_app: PWA pages and APIs
- panel: panel-related routes and helpers
- website: public site models, admin content workflows, media pipeline
- config: settings and URL split configs
- Face Cropper: standalone engine and installer artifacts
- deployment: Nginx/Gunicorn/swap templates and notes

Key infra files:

- manage.py
- requirements.txt
- requirements-dev.txt
- package.json
- tailwind-input.css
- build-css.bat
- build_bundles.py
- VERSION.txt

---

## Django Apps and Responsibilities

| App | Responsibility | Models |
|---|---|---|
| core | User/system models, middleware, main services, panel APIs | Yes |
| accounts | Login, OTP, reset, profile-auth helpers | Uses core user |
| client | Client and client staff operations | Yes |
| staff | Staff profile and permissions | Yes |
| idcards | ID card group/table/card data models | Yes |
| cardprint | Shared card rendering helpers used by reprint surfaces | Uses shared models |
| reprintcard | Requested/confirmed/downloaded/pool reprint workflow | Uses shared models |
| exports | Export orchestration and output generation | Uses shared models |
| mediafiles | CardMedia storage and logs | Yes |
| mobile_app | PWA view/API surface over service layer | Uses shared models |
| panel | Panel support views/routes | Uses shared models |
| website | Public site content and media pipeline | Yes |

---

## Core Data Model and Workflows

### Core entities

- User: super_admin, admin_staff, client, client_staff, pro_user workflows.
- Client: organization-level scope and permission flags.
- Staff: staff profile, assignment, feature toggles.
- IDCardGroup: group per client.
- IDCardTable: dynamic schema definition via fields JSON.
- IDCard: per-card field_data and status.
- CardMedia: normalized image references per card/field.
- BackgroundTask: async operation state and output metadata.
- ActivityLog/Notification and related operational models.

### ID card status flow

pending -> verified -> pool -> approved -> download

Reprint runs as a dedicated path under reprint workflows.

### Reprint workflow

1. Requested
2. Confirmed
3. Downloaded
4. Pool

---

## Permissions and Role Model

Role hierarchy:

1. super_admin: full bypass authority.
2. pro_user: owner-grade guarded workflows.
3. admin_staff: assigned-client scoped control.
4. client: own tenant scope.
5. client_staff: delegated scope, double-gated.

Permission behavior:

- super_admin: always allowed.
- admin_staff: staff permission plus assignment constraints.
- client: client permission flags and active status.
- client_staff: both staff permission and parent client permission must be true.

Hard-denied examples for client/client_staff at service level:

- delete-all ID card destructive ops
- certain staff-side print/reprint queues
- staff-side website management capabilities

---

## Bulk Upload and Reupload Engine

This is one of the most critical subsystems and has received major recent upgrades.

### Bulk upload inputs

- Spreadsheet: XLSX, XLS, CSV
- Optional per-field ZIP archives
- Optional unified ZIP archives

### Bulk upload behavior

1. Reads spreadsheet headers and maps to dynamic table fields.
2. Splits text vs image fields using BaseService rules.
3. Applies semantic image field matching for robust header inference.
4. Builds image indexes from ZIP files.
5. Uses field-specific ZIP index first, unified index as fallback.
6. Processes rows in bounded batches.
7. Stores image references in field_data and creates CardMedia records.

### Recent matching improvements

- Better semantic matching for signature/father/mother/qr naming variants.
- Prevented cross-field ZIP key collisions by isolated field indexes.
- Preserved unified ZIP fallback for compatibility.

### Reupload engine behavior

1. Validates ZIP and builds one-time name index.
2. Resolves target scope:
   - target_field (single)
   - target_fields (multi)
   - omitted target defaults to all image fields
3. Iterates cards with memory-safe chunking.
4. Replaces/saves media and updates CardMedia in batched mode.
5. Tracks progress and preflight metadata.

### Safety controls

- upload size validation
- zip traversal checks
- duplicate zip key detection
- DB retry logic for transient lock/connection errors
- bounded batch flushing to reduce lock pressure

---

## Background Task System

BackgroundTask supports async heavy operations:

- bulk_upload
- reupload_images
- export_pdf
- export_excel
- export_docx
- export_zip

Worker strategy:

- ThreadPoolExecutor singleton
- default worker count 2 (bounded 1..4)
- heavy-task semaphore cap

Task lifecycle:

pending -> processing -> completed|failed|cancelled

Notable controls:

- one active heavy operation per user policy
- queue limits for global protection
- task status polling APIs
- result download API with path guards
- cancellation API
- stale task/file cleanup flows

---

## Export System

Export module supports:

- PDF: text + image oriented tables
- XLSX: tabular export
- DOCX: formatted document export
- ZIP: image bundle export

Features:

- column sizing intelligence via column_spec
- status/scope permission guards
- template footer instructions support
- sync and async export paths

---

## Media, Watermark, and Video Processing

### Card media

- CardMedia stores per-card field mapping for uploaded/replaced images.
- Protected media paths are authorization-checked before serving.

### Website image pipeline

- applies tiled text watermark
- converts to WebP
- progressively reduces quality to target file size
- fallback scaling path if still oversized

### Website reel pipeline

- optional ffmpeg compression to H.264/AAC mp4
- size and dimension controls
- smart fallback when ffmpeg unavailable
- thumbnail logo watermark support

---

## Routing and URL Topology

The system supports domain split routing via middleware.

### Domain mapping

- WEBSITE_DOMAIN -> config.urls_website
- PANEL_DOMAIN -> config.urls_panel
- Local dev fallback -> config.urls

### Main prefixes in panel context

- /auth/
- /client/
- /staff/
- /work/
- /print/
- /reprint/
- /exports/
- /website/
- /app/ (PWA)
- /api/... (panel APIs)

### Media serving model

- Protected prefixes are auth-gated and scope checked.
- Optional Nginx X-Accel handoff is supported with MEDIA_USE_XACCEL=true.

---

## PWA Mobile App

Mobile app is served from /app/ and is permission-gated by perm_mobile_app.

Capabilities include:

- role-aware dashboard
- group/table/card navigation
- card actions and status transitions
- camera-based upload flows
- profile and notification pages
- staff/client operations per role permissions
- website media management for eligible staff roles

Operational details:

- uses shared backend services (no duplicate business logic)
- cache generation and rollback controls exist in settings
- Android shell min/latest/force update policy is environment-driven

---

## Face Cropper Engine

Standalone Windows service architecture:

- engine source in Face Cropper
- packaged by PyInstaller
- local API exposed on 127.0.0.1:4765
- Django panel talks through proxy APIs

Typical engine routes:

- /status
- /health
- /process-zip
- /process-folder

Panel integration includes engine status checks, processing triggers, previews, and save/delete helpers.

---

## Security and Middleware

Custom and built-in middleware stack provides:

- subdomain URLConf routing
- permission revalidation
- session idle and absolute lifetime controls
- session fingerprint checks
- maintenance mode gating
- website offline mode for public domain
- request timing and query threshold monitoring
- security headers and CSP policy controls

Additional security patterns:

- protected media authorization checks
- export/result path traversal guards
- CSRF trusted origin auto-augmentation
- strong production secrets and host validation requirements

---

## Build and Frontend Asset Pipeline

### Node dependencies

package.json currently includes:

- @tailwindcss/cli ^4.2.0

### CSS build script

build-css.bat performs:

1. Tailwind compile to temporary output
2. token validation against required CSS markers
3. rollback to last known good CSS if validation fails
4. production bundle build trigger via build_bundles.py

Watch mode:

- build-css.bat --watch

### JS/CSS bundle pipeline

build_bundles.py:

- concatenates module-based JS/CSS into dist bundles
- minifies via rjsmin/rcssmin when available
- outputs to static/dist/js and static/dist/css
- supports --dev and --clean modes

### Recommended Windows command

If direct batch invocation fails in your shell context:

cmd /c build-css.bat

---

## Setup and Local Development

### Prerequisites

- Python 3.11+
- Node.js 18+
- SQLite for local dev (default)
- ffmpeg optional (for reel compression)

### 1) Clone and venv

Windows PowerShell:

```powershell
git clone <repository-url>
Set-Location "Adarsh FInal Deploye"
python -m venv venv
& "venv/Scripts/Activate.ps1"
```

Linux/macOS:

```bash
git clone <repository-url>
cd "Adarsh FInal Deploye"
python3 -m venv venv
source venv/bin/activate
```

### 2) Install dependencies

```bash
pip install -r requirements.txt
npm install
```

Optional dev tools:

```bash
pip install -r requirements-dev.txt
```

### 3) Configure environment

```bash
cp .env.example .env
```

Then set at least:

- SECRET_KEY
- DEBUG (True for local)
- ALLOWED_HOSTS
- DATABASE_URL (optional for local if DEBUG=True)

### 4) Migrate and run

```bash
python manage.py migrate
python manage.py createsuperuser
```

Build assets:

```bash
cmd /c build-css.bat
```

Run server:

```bash
python manage.py runserver
```

Panel URL (single-domain local mode):

- http://127.0.0.1:8000/panel/

---

## Testing and Quality Checks

Core checks:

```bash
python manage.py check
python manage.py test
```

Pytest lanes (recommended for daily workflow):

```bash
# Fast local loop
python -m pytest -m "not slow and not very_slow" --reuse-db -q

# PR/business-critical lane
python -m pytest -m "important and not very_slow" --reuse-db -q

# Slow integration lane
python -m pytest -m "slow and not very_slow" --reuse-db -q

# Very slow/nightly lane
python -m pytest -m "very_slow" --reuse-db -q

# Full release lane
python -m pytest --reuse-db --durations=80 --durations-min=0.5 -q
```

Detailed lane guide:

- docs/testing-lanes.md

Focused regression examples:

```bash
python manage.py test reprintcard.tests.ReprintApiIntegrationTests
python manage.py test core.tests
```

Lint/type tools from requirements-dev.txt:

- ruff
- mypy + django-stubs
- pytest + pytest-django + pytest-cov

---

## Management Commands

Custom commands under core/management/commands:

| Command | Purpose |
|---|---|
| create_pro_user | Create the guarded pro_user account |
| backfill_legacy_photo_to_field_data | Backfill legacy image references into field_data |
| clear_client_pending_image_refs | Clear stale pending image references for a client scope |
| ensure_missing_card_thumbnails | Generate missing card thumbnails |
| convert_thumbs_to_webp | Convert thumbnail formats to WebP |
| fix_dob_format | Normalize date-of-birth formatting |
| rename_uuid_images_to_timestamp | Normalize media filenames from UUID style |
| restore_renamed_relation_photo_fields | Restore relation-photo renamed field aliases |
| restore_reprint_rejected_cards | Restore reprint rejected card paths/workflow records |
| revert_kg_dash_for_client | Revert KG class notation for client-specific data cleanup |
| sanitize_field_data | Sanitize unsupported characters in field_data |
| bump_app_version | Auto-bump app version using small/major/feature rules |

Tip:

- run each command with --help before applying on production data.
- version bump examples:

```bash
python manage.py bump_app_version --level small
python manage.py bump_app_version --level major
python manage.py bump_app_version --level feature
python manage.py bump_app_version --set 2.19.00
```

---

## Environment Variables

Use .env.example as the canonical base.

### Required for production

- SECRET_KEY
- ALLOWED_HOSTS
- DATABASE_URL
- REDIS_URL (or REDIS_HOST + REDIS_PORT + REDIS_DB)

### Core routing and URL variables

- WEBSITE_DOMAIN
- PANEL_DOMAIN
- WEBSITE_URL
- PANEL_URL
- SITE_URL

### Session/security controls

- CSRF_TRUSTED_ORIGINS
- SESSION_COOKIE_DOMAIN
- CSRF_COOKIE_DOMAIN
- SESSION_IDLE_TIMEOUT
- SESSION_ABSOLUTE_MAX_AGE
- SESSION_FINGERPRINT_ENABLED
- SESSION_FINGERPRINT_INCLUDE_IP
- SECURE_SSL_REDIRECT
- MEDIA_USE_XACCEL

### Background and performance controls

- BACKGROUND_WORKER_MAX_WORKERS
- BACKGROUND_HEAVY_TASK_CONCURRENCY
- SLOW_REQUEST_THRESHOLD
- QUERY_COUNT_THRESHOLD
- SLOW_QUERY_THRESHOLD
- ENABLE_REQUEST_QUERY_TRACKING

### Cache/Redis tuning

- CACHE_DEFAULT_TIMEOUT
- CACHE_KEY_PREFIX
- CACHE_VERSION
- REDIS_SOCKET_TIMEOUT
- REDIS_SOCKET_CONNECT_TIMEOUT
- REDIS_HEALTH_CHECK_INTERVAL
- REDIS_MAX_CONNECTIONS
- REDIS_CLIENT_NAME

### Email and contact

- EMAIL_HOST
- EMAIL_PORT
- EMAIL_USE_TLS
- EMAIL_HOST_USER
- EMAIL_HOST_PASSWORD
- DEFAULT_FROM_EMAIL
- CONTACT_FORM_RECIPIENT

### Website media pipeline tuning

- WEBSITE_VIDEO_MAX_WIDTH
- WEBSITE_VIDEO_MAX_HEIGHT
- WEBSITE_VIDEO_CRF
- WEBSITE_FFMPEG_BINARY

### App/runtime versioning

- APP_VERSION (fallback if VERSION.txt unavailable)
- TIME_ZONE

### Mobile shell policy

- MOBILE_SHELL_ANDROID_MIN_BUILD
- MOBILE_SHELL_ANDROID_LATEST_BUILD
- MOBILE_SHELL_ANDROID_LATEST_VERSION
- MOBILE_SHELL_ANDROID_FORCE_UPDATE
- MOBILE_SHELL_ANDROID_UPDATE_URL
- MOBILE_SHELL_PUSH_ENABLED
- MOBILE_SHELL_PRIVACY_URL
- MOBILE_SHELL_SUPPORT_URL

---

## Deployment Guide

Deployment helpers are in deployment/:

- nginx_example.conf
- nginx_subdomain_example.conf
- gunicorn_example.service
- gunicorn.conf_example.py
- setup_swap_example.sh
- cron_cleanup_example.txt

### Production baseline (1 GB RAM VPS)

1. Install required system packages including ffmpeg and WeasyPrint native dependencies.
2. Configure swap (2 GB recommended).
3. Clone repo and create virtualenv.
4. Install Python and Node dependencies.
5. Configure .env with production values.
6. Run migrations.
7. Build CSS/bundles and collectstatic.
8. Configure Nginx and Gunicorn systemd services.
9. Enable and start services.
10. Run post-deploy checks.

### Post-deploy verification

```bash
python manage.py check
python manage.py migrate --plan
python manage.py showmigrations
```

Then verify:

- panel login
- card list/search
- reprint list modal load
- export task creation and download
- public website routes

---

## Operations Runbook

### Fast sync on server (when redeploying main)

```bash
git fetch origin
git reset --hard origin/main
python manage.py migrate
python manage.py check
```

### If migration graph divergence appears

1. Ensure repo is fully synced with remote main.
2. Remove stale untracked migration files if they are leftovers.
3. Re-run migrate and showmigrations.
4. Prefer converge migrations already committed on main over creating ad-hoc prod migrations.

### If static manifest errors appear in tests or runtime

```bash
python manage.py collectstatic --noinput
```

### If frontend changes are not reflected

```bash
cmd /c build-css.bat
```

This rebuilds Tailwind output and dist bundles.

### If background heavy tasks stall under memory pressure

- reduce BACKGROUND_WORKER_MAX_WORKERS
- keep BACKGROUND_HEAVY_TASK_CONCURRENCY lower
- verify Redis health and DB lock contention

---

## Recent Change Log

Recent commits on main include:

- Fix reprint list modal API crash for relation-photo fallback.
- Fix cardprint migration 0013 PostgreSQL trigger conflict.
- Add core migration compatibility merge chain.
- Fix multi-column upload/reupload image field mapping.
- Add pending schema sync migration updates.
- Mobile upload timeout hardening for 3-image updates.
- Dashboard caching/runtime optimization improvements.
- Mobile action overlay and image upload regression fixes.
- Removal of deprecated mobile/PWA photo crop flow.

For full history:

```bash
git log --oneline
```

---

## License

Proprietary. All rights reserved.

Unauthorized copying, distribution, or modification is prohibited.
