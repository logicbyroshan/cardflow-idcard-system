# Adarsh ID Panel: Upgrade Guide (v1.2.0 to v1.3.0-rc1)

This guide outlines the steps required to safely upgrade the Adarsh ID Panel backend from v1.2.0 to v1.3.0-rc1, including database schemas, notification settings, and reprint workflow migrations.

---

## 1. Pre-Upgrade Safeguards

> [!WARNING]
> Never perform upgrades directly in production without a verified database snapshot.

1. **Stop Scheduled Jobs**: Ensure there are no active imports or exports currently running.
2. **Perform Full Database Backup**:
   Run the manual backup command:
   ```bash
   python manage.py create_backup --scope=SYSTEM
   ```
3. **Verify Backup Status**: Confirm via the dashboard or storage folder that the ZIP backup file size is greater than 0 and the checksum matches.

---

## 2. Upgrade Steps

### Step 1: Pull Latest Source Code
Fetch the code branch:
```bash
git checkout main
git pull origin main
```

### Step 2: Install New Dependencies
Install updated dependencies (if any packages like `structlog` or `django-cors-headers` were updated):
```bash
.venv/bin/pip install -r requirements.txt
```

### Step 3: Run Database Migrations
Apply the migrations for operations health snapshots and verification tables:
```bash
.venv/bin/python manage.py migrate
```

### Step 4: Flush Cached Schemas
Clear Redis cache values to resolve cached feature flag mappings or analytics statistics:
```bash
redis-cli flushall
```

---

## 3. Service Restarts

Restart system services in the following order:

1. **Gunicorn Web Process**:
   ```bash
   sudo systemctl restart gunicorn
   ```
2. **Celery Worker Pool**:
   ```bash
   sudo systemctl restart celery_worker
   ```
3. **Celery Beat Scheduler**:
   ```bash
   sudo systemctl restart celery_beat
   ```

---

## 4. Post-Upgrade Verification

1. **Verify Web Service**: Query `/api/v1/health/live/` and expect `200 OK` (liveness probe).
2. **Verify Database, Redis, and Storage**: Query `/api/v1/health/` and confirm all services show `"status": "ok"`.
3. **Verify Migrations**: Query `/api/v1/operations/dashboard/` (using a PRO_USER token) and verify `migration_status.status = "healthy"`.
