# Core Features & Operational Workflows Guide

This guide provides a detailed breakdown of the primary business features, card status lifecycles, reprint handling queues, and operational workflows implemented within **CardFlow**.

---

## 1. Dynamic ID Card Schema Engine

CardFlow provides a flexible dynamic schema builder that allows schools, colleges, and organizations to customize card structures without requiring database migrations.

### Schema Mechanics (`IDCardTable`)
- **JSON Field Spec**: Columns are defined in a structured JSON schema (`fields` attribute), supporting types such as `text`, `number`, `date`, `select`, `image`, `signature`, `qr`, and `barcode`.
- **Case Preservation**: Input text casing is strictly preserved across create, update, and bulk upload paths.
- **Dynamic Filter Generation**: Frontend UI automatically constructs tabular filter controls based on configured field types.

---

## 2. Card Status Lifecycle & Transition Pipeline

Cards pass through a strictly enforced, state-machine driven status pipeline:

```text
[ PENDING ] ──────► [ VERIFIED ] ──────► [ POOL ] ──────► [ APPROVED ] ──────► [ DOWNLOAD ]
 (Initial)          (Checked)          (Batch)         (Finalized)         (Exported)
```

| Status | Meaning & Operational Scope |
|---|---|
| `pending` | Card record created (via web portal, mobile app, or bulk CSV). Awaiting initial review. |
| `verified` | Data and student photo verified by client admin or operator. |
| `pool` | Grouped into a print batch pool for physical card production. |
| `approved` | Formally approved by super-admin or institution authority for printing. |
| `download` | Exported into final PDF print grid or Word document bundle. |

---

## 3. Dedicated Reprint Workflow Queue (`reprintcard/`)

When a student or staff member loses an ID card or requires a replacement, CardFlow handles reprints via an isolated queue that prevents disruption to main production runs.

```text
[ REQUESTED ] ────────► [ CONFIRMED ] ────────► [ DOWNLOADED ] ────────► [ POOL ]
(Reprint Entry)        (Admin Approved)         (PDF Generated)          (Completed)
```

1. **Reprint Request (`Requested`)**: Initiated from web, mobile app, or client portal with specified reason (Lost, Damaged, Information Update).
2. **Confirmation (`Confirmed`)**: Verified by institution staff with payment or approval flag.
3. **PDF Generation (`Downloaded`)**: Exported into reprint-specific PDF print grids.
4. **Archived Pool (`Pool`)**: Marked complete and stored for historical auditing.

---

## 4. Multi-Tenant Role Operations & Access Matrix

CardFlow implements double-gated security policies for institutional accounts:

| Feature / Operation | Super Admin | Client Admin | Staff User | Operator |
|---|---|---|---|---|
| Create/Edit Card Schema | Yes | Yes | Read-Only | No |
| Add / Edit Cards | Yes | Yes | Yes | Yes |
| Delete Single Card | Yes | Yes | No | No |
| Delete All Cards (Bulk) | Yes | No | No | No |
| Approve Print Batches | Yes | Yes | No | No |
| Trigger Bulk ZIP Reupload | Yes | Yes | No | Yes |
| Export PDF / Excel / Word | Yes | Yes | Yes | Assigned |

---

## 5. Audit Logging & System Telemetry

- **ActivityLog**: Logs every card creation, modification, status transition, and export generation with timestamp, user ID, and client context.
- **Active User Telemetry**: Automatically alerts super-administrators via email and toast notification when working concurrent sessions exceed system thresholds (>50 active users).
- **System Load Snapshots (`stats/`)**: Collects CPU, RAM, database connection pool, and background queue metrics.
