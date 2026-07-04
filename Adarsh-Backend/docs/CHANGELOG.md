# Adarsh ID Panel: Changelog

This document tracks all version iterations, key feature updates, and production hardening changes implemented throughout the project lifecycle.

---

## [1.3.0-rc1] - 2026-06-08
### Added
- **Phase 19 Notification Platform**:
  - Centralized model tracking `Notification`, `NotificationEvent`, `NotificationDelivery`, and `NotificationPreference`.
  - Level-based severity routing (INFO, SUCCESS, WARNING, ERROR, CRITICAL).
  - Target scoping for Global, Organization, Client, Role, and User notifications.
  - Channels integration (Web, Mobile, Desktop, webhook ready) and visbility windows support.
- **Phase 20 Reprint Management System**:
  - Out-of-workflow reprint requests (`ReprintRequest`, `ReprintHistory`, `ReprintExportSession`) keeping printed cards in `DOWNLOADED` status.
  - Instant application of draft changes (data and media file replacements) upon confirmation.
  - Printing counters tracking (`reprint_count`, `total_print_count`) and automated audit logging.
  - Desktop sync API integration for bulk reprint retrieval, asset fetching, and completion updates.

## [1.2.0] - 2026-06-06
### Added
- **Phase 17 Operations & DR**:
  - `BackupVerificationService` for verifying zip hashes and sizes.
  - Grandfather-Father-Son (GFS) backup retention rotation policy.
  - `RestoreSimulationService` for dry-run validation of data dumps.
  - Disk and Memory snapshot logging with automated alert thresholds.
  - Boot-time `StartupDiagnosticService` and post-deploy `DeploymentValidationService`.
  - Sensitive operations metrics dashboard available to `PRO_USER` role.
- **Phase 16 Production Hardening**:
  - Connection pooling with `CONN_MAX_AGE` parameters.
  - Thread-safe correlation tracking middleware injecting `X-Request-ID` across web threads, Celery tasks, and log files.
  - Structured JSON logging.
  - Rate-limit throttling decorators.
  - Redis cache layers for dynamic feature flags and Pro dashboards.

## [1.1.0] - 2026-06-05
### Added
- **Phase 15 Desktop Sync integration**:
  - API Key hashing for printing PCs.
  - `/desktop/sync/` and `/desktop/print-complete/` routes.
  - Print access logs.
- **Phase 13 Pro Platform module**:
  - Administrative maintenance screens.
  - Silent user impersonation sessions with detailed audit trails.
  - Global feature flags control panel.
- **Phase 12 Overlay Sandbox architecture**:
  - Copy-on-write virtual sandboxes.
  - Virtual card mutation diff overlays.
  - Session timers and automatic cleanups.

## [1.0.0] - 2026-06-04
### Added
- **Phase 1 - 11 Core Identity Management**:
  - Multi-tenant Organization boundaries.
  - Dynamic schemas (Tables & Fields) with PostgreSQL `JSONB` cards.
  - Headshot uploads and crop tools (MediaFile).
  - Excel and image zip asynchronous import tasks.
  - Docx and PDF sheets compilation export engines.
  - Linear state transitions (Pending, Verified, Approved, Downloaded).
  - Role-based permissions checks.
