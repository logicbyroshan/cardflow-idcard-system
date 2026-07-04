# Adarsh ID Panel: Operations & Disaster Recovery Guide

This document details day-to-day operations, backups verification, automated data retention rules, restore simulation procedures, and recovery workflows.

---

## 1. System Health Checks

Observe system availability and latency metrics using the telemetry endpoints:
- **Liveness Route**: `/api/v1/health/live/` (static check, fast, zero DB access).
- **Readiness Route**: `/api/v1/health/` (probing PostgreSQL, Redis cache, Celery workers, and storage providers).
- **Service Specific Routes**:
  - `/api/v1/health/db/`
  - `/api/v1/health/redis/`
  - `/api/v1/health/celery/`
  - `/api/v1/health/storage/`

---

## 2. Backup Verification Engine

Validated backups are critical to surviving database corruptions.
- **Service**: `BackupVerificationService`
- **Execution**: Runs automatically every 24 hours via Celery Beat or triggered manually by a `PRO_USER` via the Operations Dashboard.
- **Steps**:
  1. Checks if the backup ZIP exists on the storage provider.
  2. Compares the file size against registered file-metadata records.
  3. Downloads the archive and computes the SHA-256 hash, comparing it with the checksum generated at backup time.
  4. Tests the integrity of the ZIP format.
  5. Records the result in the `ops_backup_verification` table and logs a `BACKUP_VERIFIED` or `BACKUP_FAILED` audit trail.

---

## 3. Grandfather-Father-Son Retention Policy

To manage storage costs, the `BackupRetentionPolicy` runs daily to clean up older backup archives:
- **Daily Backups**: Keep all backups created in the last 7 days.
- **Weekly Backups**: Keep backups created on Sundays in the last 28 days (4 weeks).
- **Monthly Backups**: Keep backups created on the 1st of each month in the last 365 days (12 months).
- **Cleanup Action**: Archives outside these scopes are permanently deleted from the storage bucket, and their metadata rows are cascade-purged from the database.

---

## 4. Restore Simulation Dry-Run

Verify the restore process without mutating active production datasets:
- **Service**: `RestoreSimulationService`
- **Execution**: Can be triggered manually on any Backup Artifact by a `PRO_USER`.
- **Validation Rules**:
  1. Verifies the SHA-256 hash matches.
  2. Decodes the zip package.
  3. Validates the existence of all necessary database tables files (`organizations.json`, `tables.json`, `fields.json`, `cards.json`, `imports.json`, `exports.json`).
  4. Validates that the JSON lists are well-formed.
  5. Outputs a detailed validation report and logs a `RESTORE_SIMULATION` audit log.

---

## 5. Environment Diagnostics & Metrics Snapshots

- **Environment Diagnostics**: The `EnvironmentDiagnosticService` probes DB, Redis, Celery nodes, static folders, and env variables to compile a health overview.
- **Disk Space snapshots**: `DiskHealthService` tracks free space, used space, and growth rates. Logs a `DISK_WARNING` audit event if free space drops below $15\%$ (Warning) or $5\%$ (Critical/under 2GB).
- **Memory usage snapshots**: `MemoryHealthService` saves RAM usage records. Emits a `MEMORY_WARNING` audit log if usage exceeds $90\%$.

---

## 6. Recovery Procedures

When system alerts are triggered, follow these steps:

### A. Database Connection Drops
* **Symptom**: `health/db/` returns `error: connection refused`.
* **Action**:
  1. SSH to database node and verify PostgreSQL daemon status: `sudo systemctl status postgresql`.
  2. If down, restart the service: `sudo systemctl restart postgresql`.
  3. Verify connection pool state and logs for `max_connections` exhaustions.

### B. Redis Broker Failures
* **Symptom**: `/health/redis/` returns `error: timeout`.
* **Action**:
  1. Restart Redis process: `sudo systemctl restart redis-server`.
  2. In case of memory exhaustion, flush transient keys: `redis-cli flushall`.

### C. Celery Worker Hangs
* **Symptom**: Jobs are stuck in `PROCESSING` state indefinitely.
* **Action**:
  1. Inspect active workers: `celery -A config status`.
  2. Restart worker pool: `sudo systemctl restart celery_worker`.
  3. To clear corrupt tasks blocking queues: `celery -A config purge`.
