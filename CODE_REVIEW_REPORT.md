# Comprehensive Code Review Report
## Performance Issues, Bugs & Optimization Opportunities

---

## 1. N+1 Query Problems

### 1.1 — `client/views.py` `api_class_section_options` (Lines 487–535)
**Severity: HIGH**
Loads ALL cards for ALL tables belonging to a client, iterating through `field_data` in Python:
```python
for table in tables:
    cards = IDCard.objects.filter(table=table).values_list('field_data', flat=True)
    for fd in cards:
        ...
```
Each table triggers a separate query. For a client with 50 tables × 1000 cards, this is 50 queries + 50,000 Python iterations.

**Fix:** Use a single query with `IDCard.objects.filter(table__group__client=client).values_list('field_data', flat=True)` and extract class/section values in one pass.

---

### 1.2 — `client/views.py` `client_reprint_cards` (Lines 900–1065)
**Severity: MEDIUM**
For the "confirm" and "download" steps, accesses `rr.card.field_data` after `select_related('card')`. While `select_related` prevents extra queries for the card itself, the inner loop iterates over `table.fields` for every card to build `ordered_fields`, doing redundant Python work. Consider fetching cards with their field_data and building the ordered response in the service layer.

---

### 1.3 — `core/services/idcard_service.py` `search_cards` (Lines 1030–1100)
**Severity: LOW** (mitigated by DB-level `icontains` filter)
After filtering with `field_data__icontains`, iterates over remaining cards in Python to find `matched_field`/`matched_value`. The double pass is unavoidable for JSONField matching, but the `[:200]` cap limits impact.

---

### 1.4 — `staff/services.py` `list_admin_staff` (Lines 530–570)
**Severity: MEDIUM**
For each admin staff member, calls `AdminStaffPermissionService.get_user_permissions(staff.user)` which internally calls `user.get_all_permissions()` — this triggers DB queries per user for Django's permission cache loading.

**Fix:** Prefetch permissions in a single query with `prefetch_related('user_permissions')`, or batch-load permissions for all staff users in one query.

---

### 1.5 — `core/services/client_service.py` `_cascade_deactivate_staff` (Lines 430–445)
**Severity: MEDIUM**
Loops through active staff and calls `staff.user.save()` individually per staff member:
```python
for staff in active_staff:
    staff.user.is_active = False
    staff.user.save()
```
**Fix:** Use `User.objects.filter(id__in=staff_user_ids).update(is_active=False)` for a single query.

---

### 1.6 — `core/services/client_service.py` `_cascade_revoked_permissions` (Lines 300–338)
**Severity: MEDIUM**
Loops through all client staff and calls `staff.save()` individually. Similar to 1.5.

**Fix:** Use `Staff.objects.filter(client=client, staff_type='client_staff', <perm>=True).update(<perm>=False)` per permission, or batch with `bulk_update()`.

---

## 2. Redundant Database Queries

### 2.1 — `core/views/base.py` `manage_panel` (Lines ~879–920)
**Severity: HIGH**
Makes 6+ separate `.count()` queries without caching or aggregation:
- `Client.objects.filter(status='active').count()`
- `Client.objects.filter(status='inactive').count()`
- `Staff.objects.filter(staff_type='admin_staff').count()`
- etc.

**Fix:** Use a single `.aggregate()` call with conditional counts:
```python
Client.objects.aggregate(
    active=Count('id', filter=Q(status='active')),
    inactive=Count('id', filter=Q(status='inactive')),
)
```

---

### 2.2 — `core/views/base.py` `reprint_cards` (Lines ~900–1060)
**Severity: MEDIUM**
Loads data for only the current step but still queries ALL 3 steps' counts via separate DB queries. The `aggregate()` for step_counts is good, but for step 1 (`requests`), it fetches all cards + a separate query for `existing_reprint_ids`.

---

### 2.3 — `client/services.py` `ClientDashboardService.get_dashboard_data` (Lines 100–175)
**Severity: LOW**
Calls `groups.count()`, `tables.count()`, and `staff_count` as separate queries after already evaluating `groups` and `tables` querysets. Could use `len()` on already-evaluated querysets or combine into aggregates.

---

### 2.4 — `client/services.py` `ClientStaffService.update_staff` (Lines 500–560)
**Severity: LOW**
Calls `staff.save()` twice — once for staff fields/permissions, then again for `allowed_classes`/`allowed_sections`. Should consolidate into a single `save()`.

---

### 2.5 — `website/views.py` `load_more_reels` (Lines ~160–180)
**Severity: LOW**
Queries `Reel.objects.filter(is_active=True).count()` as a separate query after slicing. The count query runs every time the infinite scroll fires.

**Fix:** Cache the total count or use cursor-based pagination that doesn't need total count.

---

### 2.6 — `staff/services.py` `AdminStaffPermissionService.ensure_permissions_exist` (Lines 100–110)
**Severity: MEDIUM**
Called from `get_assignable_permissions()`, `get_or_create_admin_staff_group()`, and `assign_permissions_to_staff()` — meaning every staff CRUD operation calls `get_or_create()` 30+ times (one per permission). These should be cached after first call.

---

## 3. Large QuerySets Without Pagination

### 3.1 — `core/views/idcard_api.py` `api_global_search` (Lines ~308–430)
**Severity: HIGH**
Fetches up to 100 cards with `field_data__icontains`, then iterates through ALL field values in Python to build results. The limit of 100 is reasonable but the Python-side processing per card is O(fields × field_data_keys).

---

### 3.2 — `client/views.py` `api_class_section_options` (Lines 487–535)
**Severity: HIGH**
Loads ALL cards for ALL tables with NO pagination or limit. For large clients, this could return tens of thousands of field_data JSON objects:
```python
cards = IDCard.objects.filter(table=table).values_list('field_data', flat=True)
```
No `.iterator()` or chunking is used.

**Fix:** Add a LIMIT or use `.iterator(chunk_size=1000)`, and consider caching the results since class/section options change infrequently.

---

### 3.3 — `website/views.py` `our_work` (Lines ~105–150)
**Severity: LOW**
Loads ALL active portfolio items (could grow unbounded) into the template context. Consider pagination for very large portfolios.

---

## 4. Missing `@transaction.atomic`

### 4.1 — `core/views/base.py` Export Template CRUD (Lines ~1090–1180)
**Severity: MEDIUM**
`api_export_template_create` and `api_export_template_update` perform model creation/updates WITHOUT `@transaction.atomic`. The update uses bare `.save()` without `update_fields`.

---

### 4.2 — `client/services.py` `ClientStaffService.update_staff` (Lines 480–575)
**Severity: MEDIUM**
Updates `staff_user`, `staff`, and `staff.assigned_groups` across multiple `.save()` calls WITHOUT `transaction.atomic`. If the group assignment fails, user/staff changes are already committed.

**Fix:** Wrap the entire update block in `with transaction.atomic():`.

---

### 4.3 — `core/services/idcard_service.py` `delete_card` (Lines ~915–925)
**Severity: LOW**
Single `card.delete()` without transaction wrapping. The `delete()` itself is atomic, but if `delete_images()` were added as a pre-step (as in `bulk_delete`), it wouldn't be protected.

---

### 4.4 — `staff/services.py` `reset_password` (Lines 510–545)
**Severity: LOW**
Calls `user.set_password()` + `user.save()` outside a transaction. If the email send throws before the response, the password is changed but the user doesn't know.

---

## 5. Large Responses Without Streaming

### 5.1 — `exports/views.py` `api_download_all_cards` (Lines ~575–735)
**Severity: HIGH**
Generates base64-encoded XLSX + ZIP files for ALL statuses and packs them into a single JSON response. Each file is fully loaded into memory. With 5 statuses × (1 XLSX + N ZIPs), the response can easily exceed 100MB, causing OOM on a 1GB server.

**Fix:** Use background task processing (already available via BackgroundWorker) and return a task ID for polling. Or stream files individually.

---

### 5.2 — `exports/views.py` `api_export_images` (Lines ~480–540)
**Severity: HIGH**
Returns base64-encoded ZIP files in JSON response. For 3000 cards with photos, the ZIP files + base64 encoding can easily exceed available RAM.

**Fix:** Use background task export (already implemented in `export_processor.py`) and return download URLs.

---

### 5.3 — `core/views/idcard_api.py` Inline bulk upload (Lines ~1200–2100)
**Severity: HIGH** (documented in docstring as needing extraction)
The inline `api_idcard_bulk_upload` function (~900 lines) reads entire ZIP file contents into memory via `zip_photos_by_field` dict. `StreamingZipIndex` exists in `base.py` but isn't used here.

**Fix:** Use the existing background task bulk upload via `bulk_upload_processor.py` which processes images one-at-a-time from disk.

---

## 6. Missing Error Handling

### 6.1 — `client/services.py` `ClientImageService.upload_images` (Lines 1070–1120)
**Severity: MEDIUM**
For each card, iterates ALL field values looking for filename matches:
```python
for card in cards:
    for key, val in fd.items():
        if isinstance(val, str) and name_without_ext and name_without_ext.lower() in val.lower():
```
This has no early break after a match — it keeps iterating ALL fields of ALL cards. Also, `image.seek(0)` / `image.read()` inside the inner loop reads the entire file multiple times.

Additionally, the `cards = IDCard.objects.filter(table_id=table_id)` query loads ALL cards for the table with no limit, and there's no transaction wrapping.

---

### 6.2 — `core/views/idcard_api.py` `api_create_table_from_xlsx` (Lines ~2100–2355)
**Severity: MEDIUM**
Self-imports and calls `api_idcard_bulk_upload` as a function — a recursive view invocation:
```python
from core.views.idcard_api import api_idcard_bulk_upload
return api_idcard_bulk_upload(request, table.id)
```
If `api_idcard_bulk_upload` raises an unhandled exception, the table creation is committed but upload fails, leaving an empty table.

---

### 6.3 — `core/services/notification_service.py` `_send_email_alerts` (Lines ~referenced but not in read portion)
**Severity: LOW**
Fire-and-forget email sending. Email failures are logged but never retried or reported back.

---

## 7. Business Logic in Views (Architecture Violations)

### 7.1 — `core/views/idcard_api.py` `api_idcard_bulk_upload` (Lines ~1200–2100)
**Severity: HIGH**
~900 lines of inline business logic: XLSX parsing, ZIP image matching, field mapping, card creation with `IDCard.objects.create()` inside a loop. This violates the project's stated "ultra-thin views" architecture. The docstring acknowledges this:
```python
# TODO: Extract to IDCardService.bulk_upload()
```

---

### 7.2 — `core/views/idcard_api.py` `api_idcard_cards_json` (Lines ~varies)
**Severity: MEDIUM**
Duplicates filtering/sorting/pagination logic from `IDCardService.list_cards` instead of delegating to it. Two places to maintain the same logic creates divergence risk.

---

### 7.3 — `core/views/base.py` `build_idcard_actions_context` (Lines ~450–650)
**Severity: LOW**
Contains substantial queryset construction and pagination logic directly in the view helper. This is acceptable as it's a context builder, but the filtering/sorting logic should ideally be in the service layer.

---

## 8. Security Issues

### 8.1 — `client/services.py` `ClientStaffService.create_staff` (Lines 420–445)
**Severity: MEDIUM**
Skips Django password validators when phone is used as password:
```python
if not used_phone_as_password:
    from django.contrib.auth.password_validation import validate_password
    try:
        validate_password(password)
    except Exception as pw_err:
        ...
```
Phone numbers are typically 10 digits — predictable and easily brute-forced. The OTP-based password reset flow mitigates this somewhat, but initial accounts are vulnerable.

---

### 8.2 — `staff/services.py` `AdminStaffCreationService.create_admin_staff` (Lines 245–255)
**Severity: LOW**
Uses phone number as fallback password:
```python
final_password = password.strip() if password and password.strip() else (phone if phone else generate_secure_password())
```
Same concern as 8.1 but for admin staff accounts which have higher privileges.

---

### 8.3 — `core/middleware.py` `PermissionValidationMiddleware` (Lines ~100–170)
**Severity: LOW**
Re-fetches the user from DB with `select_related()` every 10 seconds. The `select_related()` call has no arguments, meaning it joins ALL foreign key relationships on the User model. This could expose more data than needed in memory.

**Fix:** Be explicit: `User.objects.select_related('client_profile', 'staff_profile').get(pk=...)`.

---

### 8.4 — `accounts/services.py` `OTPService.send_otp` (Lines 200–240)
**Severity: LOW**
In non-DEBUG production, OTP is stored in cache (likely Redis). If `DEV_EXPOSE_OTP` env var is accidentally set to `true` in production, the OTP is returned in the API response. The code has a two-gate check (`DEBUG` AND `DEV_EXPOSE_OTP`), which is good, but the env var name could be confused.

---

## 9. Inefficient Loops / Python-Side Processing

### 9.1 — `core/views/idcard_api.py` `api_idcard_bulk_upload` — Card creation in loop
**Severity: HIGH**
Creates cards one-by-one with `IDCard.objects.create()` inside a loop instead of using `bulk_create()`:
```python
for row_idx, row in enumerate(rows):
    card = IDCard.objects.create(table=table, field_data=field_data, status='pending')
```
For 5000 cards, this is 5000 INSERT queries.

**Note:** The background processor (`bulk_upload_processor.py`) correctly uses `bulk_create()` with batches of 100. The inline view version does not.

---

### 9.2 — `client/views.py` `api_class_section_options` (Lines 487–535)
**Severity: HIGH** (duplicate of 3.2 above)
Iterates ALL cards × ALL fields in Python to extract unique class/section values. For 50,000 cards with 10 fields each, that's 500,000 iterations.

---

### 9.3 — `core/services/idcard_service.py` `upgrade_all_classes` (Lines 1080–1156)
**Severity: LOW** (mitigated by `bulk_update` and `iterator`)
Uses `iterator(chunk_size=500)` and `bulk_update` — well-implemented batched processing.

---

### 9.4 — `client/services.py` `ClientImageService.upload_images` (Lines 1070–1120)
**Severity: HIGH**
For each uploaded image, iterates ALL cards in the table, then ALL field values per card:
```python
cards = IDCard.objects.filter(table_id=table_id)
for card in cards:
    for key, val in fd.items():
```
For N images × M cards × K fields, this is O(N × M × K) with no early termination.

**Fix:** Build an index of field values → card IDs first, then match images against the index.

---

## 10. Caching Opportunities

### 10.1 — `core/services/permission_service.py` `has()` method
**Severity: MEDIUM**
Called on every request (via middleware + decorators + views). Each call traverses role checks and attribute lookups. While individual calls are fast, the volume is very high.

**Fix:** Consider per-request caching using `request` object attributes or a short-TTL cache for the permission context.

---

### 10.2 — `client/views.py` `api_class_section_options` (Lines 487–535)
**Severity: HIGH**
Recomputes class/section options from ALL cards on every call. These values change only when cards are added/updated.

**Fix:** Cache the result per-client with a 5-minute TTL, invalidated on card create/update.

---

### 10.3 — `staff/services.py` `AdminStaffPermissionService.ensure_permissions_exist`
**Severity: LOW**
Calls `Permission.objects.get_or_create()` for ~30 permissions every time any staff permission operation runs. After initial setup, these always exist.

**Fix:** Add a module-level `_permissions_ensured = False` flag, or use Django's `AppConfig.ready()` to run once at startup.

---

### 10.4 — `website/views.py` — Good caching examples
**Positive:** The website views use caching effectively: `get_common_context()` caches `BusinessDetails` for 5 minutes, home sections are cached for 60s. This is well-implemented.

---

### 10.5 — `core/middleware.py` `WebsiteOfflineMiddleware`
**Positive:** Already caches website status for 30 seconds. Good implementation.

---

## 11. Obvious Bugs

### 11.1 — `client/services.py` `ClientStaffService.create_staff` — Double password set
**Severity: LOW (functional but wasteful)**
Creates user with `create_user(...)` which already hashes the password, then immediately calls `staff_user.set_password(password)` + `staff_user.save()` again (Lines ~450–455):
```python
staff_user = User.objects.create_user(
    username=username, email=email, ...
)
staff_user.set_password(password)
staff_user.save()
```
`create_user()` already calls `set_password()`. The second call + save is redundant — it hashes the password twice and makes an extra DB query.

---

### 11.2 — `client/services.py` `ClientStaffService.update_staff` — Double `staff.save()`
**Severity: LOW (functional but wasteful)**
`staff.save()` is called at line ~555, then `allowed_classes`/`allowed_sections` are set, and `staff.save()` is called again at line ~575. Two writes where one would suffice.

---

### 11.3 — `core/views/idcard_api.py` `api_create_table_from_xlsx` — View-calling-view pattern
**Severity: MEDIUM**
Imports and calls another view function directly:
```python
from core.views.idcard_api import api_idcard_bulk_upload
return api_idcard_bulk_upload(request, table.id)
```
This creates a tight coupling between two API endpoints. If the called view's signature changes, this breaks silently. Should delegate to a shared service method.

---

### 11.4 — `core/middleware.py` `PermissionValidationMiddleware` — `select_related()` without arguments
**Severity: LOW**
```python
fresh_user = User.objects.select_related().get(pk=request.user.pk)
```
With no arguments, `select_related()` follows ALL non-null foreign key and OneToOne relationships, potentially joining many tables unnecessarily.

---

### 11.5 — `client/views.py` `api_staff_list_create` — Missing `@require_client_admin` decorator
**Severity: MEDIUM**
Line 299 has `@require_http_methods(["GET", "POST"])` but the `@require_client_admin` decorator is applied to `api_staff_detail` (line 365) but NOT to `api_staff_list_create`. The GET path calls `ClientStaffService.list_staff()` which checks permission internally, but the POST (create) path only checks inside the service call. Adding the decorator at the view level provides defense-in-depth.

---

### 11.6 — `core/services/client_service.py` `delete` — User deletion ordering
**Severity: LOW**
Deletes client first, then user:
```python
with transaction.atomic():
    client.delete()   # Cascades Staff records
    user.delete()
```
Then separately cleans up orphaned client_staff users. If `user.delete()` fails, the client and staff records are already gone but the client's user record persists as an orphan. This is protected by `transaction.atomic()` so it's correct, but the cascade order could be clearer.

---

### 11.7 — `website/views.py` `load_more_reels` — Missing authentication
**Severity: INFO**
This is a public API endpoint (no `@login_required`), which is correct for a public website. However, there's no rate limiting on it (unlike `submit_testimonial` and `submit_contact`). An attacker could spam requests.

---

## Summary of Priorities

| Priority | Category | Count | Key Files |
|----------|----------|-------|-----------|
| **CRITICAL** | Large responses / OOM risk | 3 | `exports/views.py`, `core/views/idcard_api.py` |
| **HIGH** | N+1 / unbounded queries | 4 | `client/views.py`, `core/views/base.py` |
| **HIGH** | Business logic in views | 1 | `core/views/idcard_api.py` (bulk upload) |
| **HIGH** | Inefficient loops | 3 | `client/views.py`, `client/services.py` |
| **MEDIUM** | Missing transactions | 3 | `client/services.py`, `core/views/base.py` |
| **MEDIUM** | Redundant queries | 4 | `core/views/base.py`, `staff/services.py` |
| **MEDIUM** | Security | 2 | `client/services.py`, `staff/services.py` |
| **LOW** | Caching opportunities | 3 | Various |
| **LOW** | Minor bugs | 5 | Various |

### Top 5 Recommendations (Highest Impact)

1. **Extract inline bulk upload** from `core/views/idcard_api.py` to use the existing background task processor — eliminates ~900 lines of view code, prevents OOM, uses `bulk_create()`.

2. **Fix `api_class_section_options`** in `client/views.py` — unbounded query loading all cards with no pagination or caching.

3. **Move `api_download_all_cards`** in `exports/views.py` to use BackgroundWorker — base64-encoding multiple ZIPs in a single JSON response risks OOM on a 1GB server.

4. **Add `transaction.atomic` to `ClientStaffService.update_staff`** — currently 3 separate saves across User, Staff, and M2M without atomicity.

5. **Consolidate `manage_panel` count queries** in `core/views/base.py` — 6+ separate COUNT queries that could be 2 aggregate queries.
