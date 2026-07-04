# Backward Compatibility & Versioning Guidelines

This document defines the official engineering standards for managing backward compatibility and API versioning in this project. 

---

## 1. Purpose

Our platform serves multiple active production clients, including:
* **Android Native Applications** (React Native/PWA)
* **Desktop Synchronization Clients** (Electron/Python scripts)
* **Web Dashboard Frontends** (Django templates & interactive JS)
* **Third-Party API Integrations**

Since we cannot force users to update their client applications immediately, all backend changes **must preserve backward compatibility**. Features must evolve without breaking existing clients or causing downtime.

---

## 2. Project Principles

1. **One Database, One Business Logic**: Do not duplicate business models or database tables to support legacy contracts. Use compatibility wrappers, adapters, and translation layers.
2. **Centralized Compatibility Service**: All mapping logic, client version checking, ID wrapping, and role conversions must live in `CompatibilityService` inside `core/services/compat_service.py`.
3. **No Breaking Model Renames**: Never drop or rename a database column or choice value without a translation fallback and safe migration lifecycle.
4. **Client Version Detection**: Detect client platforms and versions dynamically from request headers (`X-App-Platform` and `X-App-Version`) to determine legacy payload support.

---

## 3. API Versioning & Deprecation Lifecycle

When introducing changes to existing APIs:
1. **Additive Changes Only**: Adding fields is safe. Never rename or delete fields in serialization payloads.
2. **Centralized Response Translation**: If a field must be renamed or a response schema changes, use `CompatibilityService.translate_dict` to rewrite the response payload for legacy clients.
3. **Endpoint Aliases**: If an endpoint is renamed, leave the legacy URL path in `config/urls.py` and delegate the request directly to the new view function without duplicating code.

---

## 4. Safe Database Migration Strategy

1. **Phase 1 (Backward Compatible)**: Add new models, fields, or choices as nullable/with fallbacks. Write a data migration to sync values. The code must support both fields.
2. **Phase 2 (Release & Adoption)**: Deploy the backend, release updated client applications, and monitor adoption.
3. **Phase 3 (Cleanup)**: Once legacy adoption is at 0%, remove the compatibility code and old fields in a major release.

---

## 5. Examples & Reference Implementions

### A. Role Renames (e.g. `operator` ➔ `admin_staff`)
When renames occur:
* **Database**: Holds the new values (`'operator'`).
* **API Boundary**: Use `CompatibilityService.map_role_to_legacy` inside JSON response payloads:
  ```python
  'role': CompatibilityService.map_role_to_legacy(user.role)
  ```

### B. ID Wrapping offsets
To avoid disjoint table primary key conflicts when splitting or merging models:
* Operators wrap IDs with `+100000`.
* Assistants wrap IDs with `+200000`.
* Decoded using:
  ```python
  staff_type, real_id = CompatibilityService.decode_id(staff_id)
  ```

---

## 6. Pull Request Compatibility Checklist

Every Pull Request modifying APIs, database schemas, or serializers must satisfy:
- [ ] No existing database columns or choices are deleted/renamed without fallback translations.
- [ ] Centralized translation layers map legacy fields/responses for versions marked `is_legacy`.
- [ ] No URL patterns are deleted; renamed paths are registered as forwarding aliases.
- [ ] Reversible operations are implemented in Django migrations for clean rollbacks.
- [ ] Unit tests are updated to cover both legacy and new client payload verification.
