# Production Engineering Backlog & Change Advisory Board (CAB) Document

**Project Name:** Adarsh Admin New  
**Date:** 2026-07-23  
**Governing Body:** Production Change Advisory Board (CAB)  
**Output Document:** `PROJECT_CHANGE_BACKLOG.md`  

---

> [!IMPORTANT]
> **CAB Operational Governance Rules**:
> 1. **Single Change per Deployment**: Every Engineering Change Request (ECR) represents an independent deployment package. Unrelated changes MUST NOT be combined into a single release.
> 2. **Verified Findings Only**: Only findings evaluated as `OPTIMIZE` in `PROJECT_VERIFIED_FINDINGS.md` are admitted to this production backlog.
> 3. **Preserve System Functionality**: Every change must preserve existing public APIs, database structures, and business logic.
> 4. **Independent Testability & Rollback**: Each ECR must have its own isolated test suite, zero-downtime deployment sequence, and immediate rollback protocol.

---

## Backlog Priority Ranking Methodology

All ECRs in this backlog are prioritized using a four-factor matrix:
$$\text{Priority Rank} = \frac{\text{Measurable Benefit} \times \text{Confidence}}{\text{Production Risk} \times \text{Implementation Effort}}$$

---

## Engineering Change Requests (ECRs)

---

### ECR-001: Redis Caching of Distinct Field Option Values

#### 1. Change ID
`ECR-001`

#### 2. Title
Redis Caching for Dynamic Card Filter Dropdown Options

#### 3. Category
Caching

#### 4. Source Finding
`PERF-004` (from `PROJECT_VERIFIED_FINDINGS.md`)

#### 5. Business Reason
Improves search filter modal responsiveness in the web portal for operators and school administrators. Eliminates repeated database queries during UI filter interactions, ensuring smooth portal user experience.

#### 6. Technical Reason
Opening search filter modals currently executes un-cached `SELECT DISTINCT` queries across `core_idcard` columns (such as `class_name`, `section`, `blood_group`). As card records grow per client, running distinct queries directly against PostgreSQL increases DB CPU load and adds latency. Caching the resulting distinct value arrays in Redis for 10 minutes removes PostgreSQL query overhead.

#### 7. Current Behaviour
`get_distinct_field_values()` in `core/views/idcard_card_api.py` queries PostgreSQL via `IDCard.objects.filter(client=client).values_list(field_name, flat=True).distinct()` every time a filter dropdown is loaded in the portal UI.

#### 8. Proposed Behaviour
`get_distinct_field_values()` checks Redis for a client-specific cache key (`adarsh:card_distinct_values:{client_id}:{field_name}`). If present, it returns the cached list. If missing, it queries PostgreSQL, writes the result to Redis with a 600-second (10 minute) TTL, and returns the response. Model `post_save` and `post_delete` signals invalidate the cache key whenever cards are added or modified.

#### 9. User Visible Change
**NO**. Dropdown options load identically. Response time improves slightly (~15ms–40ms faster).

#### 10. Files Expected To Change
* `core/views/idcard_card_api.py` (Implement cache check/set in `get_distinct_field_values`)
* `idcards/signals.py` (Add cache invalidation on card save/delete)

#### 11. Database Migration Required
**NO**. No schema changes required.

#### 12. Redis Required
**YES**. Uses existing Redis cache backend (`CACHES['default']`).

#### 13. Background Worker Required
**NO**.

#### 14. Configuration Change
**NO**.

#### 15. Estimated Development Time
`2` Hours.

#### 16. Estimated Testing Time
`2` Hours.

#### 17. Estimated Rollback Time
`5` Minutes.

#### 18. Expected Measurable Improvement
* **Database Query Reduction:** Reduces `SELECT DISTINCT` queries on `core_idcard` by ~90% for active sessions.
* **Response Latency:** Reduces modal filter option API response latency from ~45ms to ~3ms.
* **Measurement Method:** Measured via Django Debug Toolbar query count and Redis hit ratio metrics (`INFO stats`).

#### 19. Verification Plan
1. **Pre-Deployment:** Run local benchmark verifying `get_distinct_field_values()` executes 1 SQL query on first hit and 0 SQL queries on subsequent hits.
2. **Post-Deployment:** Monitor Redis hit count and verify `adarsh:card_distinct_values:*` keys populate successfully with a 600s TTL.

#### 20. Regression Risks
* Stale dropdown values if cache invalidation signal fails during new class creation.
* Graceful fallback: If Redis is unavailable, code falls back to direct DB query.

#### 21. Regression Tests Required
* Run existing test: `client/tests.py::test_card_filter_dropdowns`
* Add new unit test: `idcards/tests/test_cache.py::test_distinct_values_cache_invalidation`

#### 22. Deployment Plan
1. Deploy updated `core/views/idcard_card_api.py` and `idcards/signals.py` to production application nodes.
2. Perform rolling restart of Gunicorn worker processes.
3. Verify zero 500 errors in `logs/error.log`.

#### 23. Rollback Plan
1. Revert application code commit via Git deployment pipeline.
2. Perform rolling restart of Gunicorn worker processes.
3. Flush Redis keys matching `adarsh:card_distinct_values:*`.

#### 24. Production Monitoring
* Monitor `500` error rates on `/api/idcard/distinct-values/`.
* Monitor Redis cache hit/miss ratio.
* Monitor PostgreSQL slow query log for `SELECT DISTINCT`.

#### 25. Final CAB Decision
**APPROVED**  
*Justification:* Low risk, zero database migrations, transparent UX, and clear 15–40ms latency reduction.

---

### ECR-002: HTML Pre-Escaping Validation in Custom Template Filters

#### 1. Change ID
`ECR-002`

#### 2. Title
Input Sanitation and Pre-Escaping Hardening for Custom Template Filters

#### 3. Category
Security

#### 4. Source Finding
`SEC-002` (from `PROJECT_VERIFIED_FINDINGS.md`)

#### 5. Business Reason
Ensures defense-in-depth HTML security compliance for web portal data tables, guaranteeing that user-submitted strings rendered with `<wbr>` line-break tags cannot introduce XSS vulnerabilities.

#### 6. Technical Reason
Custom template filters in `core/templatetags/custom_filters.py` (such as `email_break` and `safe_html`) manipulate strings before invoking `mark_safe()`. To guarantee XSS safety, input strings must explicitly pass through `django.utils.html.escape()` prior to string concatenation and `mark_safe()` conversion.

#### 7. Current Behaviour
`email_break` in `core/templatetags/custom_filters.py` performs `mark_safe(escape(val[:idx]) + '<wbr>' + escape(val[idx:]))`. While pre-escaping is present, helper functions lack explicit type verification and fail-safe fallback when non-string objects are passed into template tags.

#### 8. Proposed Behaviour
Refactor helper functions in `core/templatetags/custom_filters.py` to add strict `isinstance(value, str)` checks and explicit pre-escaping assertions prior to `mark_safe()`. If input is invalid or `None`, return empty string or escaped string safely without raising exceptions.

#### 9. User Visible Change
**NO**. Visual rendering of emails and text breaks in web portal tables remains identical.

#### 10. Files Expected To Change
* `core/templatetags/custom_filters.py`

#### 11. Database Migration Required
**NO**.

#### 12. Redis Required
**NO**.

#### 13. Background Worker Required
**NO**.

#### 14. Configuration Change
**NO**.

#### 15. Estimated Development Time
`1` Hour.

#### 16. Estimated Testing Time
`1` Hour.

#### 17. Estimated Rollback Time
`5` Minutes.

#### 18. Expected Measurable Improvement
* **Security Compliance:** 100% verification that all `mark_safe()` tags in template filters sanitize input strings.
* **Measurement Method:** Evaluated via automated security unit test assertions passing un-escaped script payloads into template filters.

#### 19. Verification Plan
1. Execute unit test suite verifying script tags (e.g. `<script>alert(1)</script>`) passed into `{{ email|email_break }}` are escaped to `&lt;script&gt;`.
2. Inspect rendered HTML source code of staff table views to confirm `<wbr>` tags render properly.

#### 20. Regression Risks
* Broken table formatting if escaping escapes intended HTML entities twice.
* Mitigation: Pre-escaping uses standard Django `escape()` rules.

#### 21. Regression Tests Required
* Run existing test: `core/tests.py::test_custom_template_filters`
* Add new unit test: `core/tests/test_templatetags_security.py`

#### 22. Deployment Plan
1. Deploy updated `core/templatetags/custom_filters.py`.
2. Perform rolling restart of Gunicorn application workers.

#### 23. Rollback Plan
1. Revert `core/templatetags/custom_filters.py` to previous git commit.
2. Restart Gunicorn application workers.

#### 24. Production Monitoring
* Monitor template rendering errors in `logs/error.log`.
* Monitor browser XSS report headers if configured.

#### 25. Final CAB Decision
**APPROVED WITH CONDITIONS**  
*Condition:* Must include unit tests proving `<script>` tags are sanitized while `<wbr>` tags remain intact before deploying to production.

---

### ECR-003: Non-Blocking B-Tree Index Creation on `IDCard(client, status)`

#### 1. Change ID
`ECR-003`

#### 2. Title
Composite Index Creation for Client ID Card Status Filtering

#### 3. Category
Database

#### 4. Source Finding
`DB-001` / `PERF-005` (from `PROJECT_VERIFIED_FINDINGS.md`)

#### 5. Business Reason
Accelerates card table search, status filtering, and dashboard stats aggregation for large school accounts with over 10,000 student cards.

#### 6. Technical Reason
The `core_idcard` table is queried frequently using combined filtering on `client_id` and `status` (e.g. `WHERE client_id = X AND status = 'APPROVED'`). Currently, PostgreSQL relies on single-column foreign key indexes or sequential table scans. A composite B-Tree index on `(client_id, status)` allows PostgreSQL query planner to perform index-only scans.

#### 7. Current Behaviour
Query planner uses bitmap index scans or table scans when querying cards by client and status, consuming DB CPU during heavy filter operations.

#### 8. Proposed Behaviour
Add `models.Index(fields=['client', 'status'], name='idcard_client_status_idx')` to `IDCard.Meta.indexes`. Generate a Django migration that executes `CREATE INDEX CONCURRENTLY` in production.

#### 9. User Visible Change
**NO**. Card table search and filter results load faster (~30ms–100ms speedup on large client accounts).

#### 10. Files Expected To Change
* `core/models.py` (Add index to `IDCard.Meta.indexes`)
* `core/migrations/0092_add_idcard_client_status_idx.py` (New migration file)

#### 11. Database Migration Required
**YES**. Migration creates a composite B-Tree index in PostgreSQL. Must use `AddIndexConcurrently` or `atomic = False` with `CREATE INDEX CONCURRENTLY` to avoid table locking.

#### 12. Redis Required
**NO**.

#### 13. Background Worker Required
**NO**.

#### 14. Configuration Change
**NO**.

#### 15. Estimated Development Time
`1` Hour.

#### 16. Estimated Testing Time
`2` Hours.

#### 17. Estimated Rollback Time
`5` Minutes.

#### 18. Expected Measurable Improvement
* **Query Latency:** Reduces query execution time for `filter(client=C, status=S)` from ~120ms to ~8ms on datasets >50,000 rows.
* **Measurement Method:** Measured via PostgreSQL `EXPLAIN ANALYZE` showing scan method shift from `Bitmap Heap Scan` to `Index Scan using idcard_client_status_idx`.

#### 19. Verification Plan
1. **Staging Verification:** Run `python manage.py sqlmigrate core 0092` to verify `CREATE INDEX CONCURRENTLY` statement syntax.
2. **Production Verification:** Run `EXPLAIN ANALYZE SELECT * FROM core_idcard WHERE client_id = 1 AND status = 'APPROVED';` before and after migration.

#### 20. Regression Risks
* Brief lock escalation if index creation is run non-concurrently.
* Mitigation: Migration MUST specify `atomic = False` and `CREATE INDEX CONCURRENTLY`.

#### 21. Regression Tests Required
* Run existing test: `core/tests.py::test_idcard_model`
* Execute migration check: `python manage.py check`

#### 22. Deployment Plan
1. Deploy code and migration file to production nodes.
2. Execute migration: `python manage.py migrate core 0092`.
3. Verify index creation status in PostgreSQL: `SELECT indexname, status FROM pg_indexes WHERE tablename = 'core_idcard';`.

#### 23. Rollback Plan
1. Execute reverse migration or drop index: `DROP INDEX CONCURRENTLY IF EXISTS idcard_client_status_idx;`.
2. Revert code commit.

#### 24. Production Monitoring
* Monitor PostgreSQL lock contention metrics.
* Monitor database CPU load during migration execution.
* Monitor slow query logs.

#### 25. Final CAB Decision
**APPROVED**  
*Justification:* High database optimization benefit, zero downtime when executed concurrently, trivial rollback, and zero user experience disruption.

---

## Production Implementation Roadmap

| Priority | Change ID | Title | Benefit | Risk | Effort | Confidence | Downtime | Migration | User Impact | Status | Implementation Order |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | `ECR-001` | Redis Caching of Distinct Field Option Values | High | Very Low | 2 hrs | 95% | No | No | None | **APPROVED** | **1st (Immediate)** |
| 2 | `ECR-003` | Non-Blocking B-Tree Index on `IDCard(client, status)` | High | Low | 1 hr | 95% | No | Yes | None | **APPROVED** | **2nd (Follow-up)** |
| 3 | `ECR-002` | HTML Pre-Escaping Validation in Custom Template Filters | Low | Very Low | 1 hr | 90% | No | No | None | **APPROVED WITH CONDITIONS** | **3rd (Scheduled)** |

---

*Document authorized by the Production Change Advisory Board for `Adarsh Admin New`.*
