# Release Candidate 1 (v1.0.0-rc1) Release Checklist

This checklist documents the verification steps required to certify the Adarsh ID Panel backend for Release Candidate 1 (RC1) readiness.

---

## 1. Core Verification Tasks

- [x] **Database Migrations**
  - [x] Run `makemigrations` and confirm no pending model changes.
  - [x] Run `showmigrations` and confirm all migrations are applied.
- [x] **Test Validation**
  - [x] Execute complete suite: `pytest --tb=short`.
  - [x] Confirm all 337 tests pass with zero failures, errors, or unexplained skips.
- [x] **Operations & Diagnostics**
  - [x] Run startup checks and verify environment configuration validation completes successfully.
  - [x] Run health check endpoints (`/api/v1/operations/diagnostics/`) and verify database, Redis, and storage connections are fully functional.
  - [x] Verify backup checks (`BackupVerificationService`) and grandfather-father-son retention cleanup jobs execute without issues.
- [x] **Security Headers & Flags**
  - [x] Confirm `DEBUG = False` is set in staging/production settings.
  - [x] Confirm sensitive environment keys (`SECRET_KEY`, `DATABASE_URL`, `REDIS_URL`, etc.) are read from env vars with no fallback/hardcoding in production config.
- [x] **API & Integration Tests**
  - [x] Verify reprint request creation, confirmation, printing counters, and reporting functions.
  - [x] Verify desktop client synchronization API (fetching confirmed reprints and updating statuses to `PRINTED`).
  - [x] Verify notification delivery rules and user channel preference overlays.

---

## 2. Verification Command Reference

### Run Complete Test Suite
```bash
.venv\Scripts\pytest -v
```

### Validate Schema Migration Status
```bash
.venv\Scripts\python manage.py showmigrations
```

### Execute Diagnostics & Operations Checks
```bash
.venv\Scripts\python manage.py check
```
