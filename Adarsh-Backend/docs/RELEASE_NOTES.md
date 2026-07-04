# Adarsh ID Panel: Release Notes (v1.3.0-rc1)

This release elevates the Adarsh ID Panel backend platform to production readiness. It combines the core identity management domains with hardening measures, deployment telemetry, disaster recovery procedures, a centralized notification platform, and a dedicated reprint request management flow.

---

## 1. Key Platform Deliverables

- **Centralized Notification Platform**:
  - Centralized notification routing with global, client, role, organization, and user scoped targets.
  - Multi-channel delivery rules (Web, Mobile, Desktop) supporting severity levels (INFO, SUCCESS, WARNING, ERROR, CRITICAL).
- **Reprint Management System**:
  - Dedicated out-of-workflow reprint request flow ensuring cards remain in `DOWNLOADED` status.
  - Immediate application of data and media file replacements upon approval.
  - Desktop sync API integration for bulk printing.
- **Enterprise Reliability**:
  - Auto-healing database pools and thread-safe request correlation tracking.
  - Fail-fast validators ensuring all database, caching, and storage nodes are reachable on system boot.
- **Robust Disaster Recovery**:
  - Background processes verifying backup sizes, file hashes, and ZIP file structures.
  - Automated Grandfather-Father-Son retention cleaning rules to optimize disk space.
  - Simulated restore runs checking database dumps without affecting live tables.
- **Operations Telemetry Panel**:
  - Dynamic disk and memory snapshot records.
  - Real-time diagnostics view tracking PostgreSQL connection states, Redis read/write capabilities, and Celery beat scheduler tasks.
- **Secure Integration Sync APIs**:
  - Authenticated API keys for remote print PCs, allowing automated local printing and card-printed status confirmations.

---

## 2. Target Environments & Hardware Requirements

### Operating System
- Ubuntu Server 20.04 LTS / 22.04 LTS (recommended)
- Debian 11 / 12

### Minimum System Specifications
- **CPU**: 2 Cores (Intel/AMD or ARM64)
- **RAM**: 4 GB Physical RAM
- **Disk**: 40 GB NVMe Storage (varies depending on Headshots and ZIP file volume)

### Core Dependencies
- Python 3.11.x
- PostgreSQL 15+
- Redis 7.x
- WeasyPrint (with cairo/pango PDF dependencies)
