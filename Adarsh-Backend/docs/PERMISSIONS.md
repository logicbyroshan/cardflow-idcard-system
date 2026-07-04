# Adarsh ID Panel: Role & Permission Matrix

This document defines the roles, permissions, scopes, and boundaries within the Adarsh ID Panel tenant system.

---

## 1. System Roles Directory

1. **`PRO_USER` (Platform Super Admin)**:
   * Has system-wide unrestricted access across all organizations.
   * Accesses operations telemetry dashboards, backup policies, announcements, and maintenance states.
   * Executes silent user impersonation sessions for troubleshooting.
2. **`ADMIN` (Tenant Admin)**:
   * Root administrator for a specific Organization tenant.
   * Can create users (Operators, Clients, Assistants) within their organization.
   * Configures tables, schema fields, templates, and integration API keys.
3. **`OPERATOR` (Data Operator)**:
   * Handles importing datasets (Excel/ZIP) and performs batch card creations.
   * Can update card values and execute card state transitions from `PENDING` to `VERIFIED`.
4. **`CLIENT` (Verification Client)**:
   * Authorizes card printing by moving cards from `VERIFIED` to `APPROVED`.
   * Triggers sandbox overlays to test modifications safely.
   * Initiates bulk exports (PDF, DOCX, ZIP).
5. **`ASSISTANT` (Scope-Restricted User)**:
   * Restricted to a specific Class/Section scope.
   * Can read and edit cards belonging to their assigned scope.
   * Cannot view, update, or transition cards outside of their scope.
6. **`GUEST / SANDBOX`**:
   * Temporary read-only or virtualized access to sandboxed cards without write authority on the production database.

---

## 2. Authorization Permission Matrix

| Operation | PRO_USER | ADMIN | OPERATOR | CLIENT | ASSISTANT | GUEST |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Manage Organizations** | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Silent Impersonation** | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Platform Maintenance Modes** | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Read Operations Dashboards** | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Manage Tenant API Keys** | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Create Users in Tenant** | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Manage Table Schemas** | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Bulk Import (XLSX/ZIP)** | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **Transition: Pending ➔ Verified**| ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Transition: Verified ➔ Approved**| ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| **Start Sandbox Session** | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| **Trigger PDF/Docx Exports** | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| **Edit Card (In Scope)** | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **Edit Card (Out of Scope)** | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |

---

## 3. Scope Isolation Rules

### Assistant Scope Enforcement
Assistants cannot access cards outside their scope. If an Assistant attempts to retrieve or mutate an out-of-scope card:
1. The backend triggers a scope verification failure.
2. An error response (`requires_class_change=True`) is returned to the client application.
3. The client application prompts the Assistant to change their class/section context before proceeding.

### Tenant Isolation Enforcement
All queries (excluding those run by a `PRO_USER` or active Impersonation session) are automatically scoped using:
```python
# Django Selector Layer pattern
def get_cards_for_user(user):
    if user.role == Role.PRO_USER:
        return Card.objects.all()
    return Card.objects.filter(organization=user.organization, is_deleted=False)
```
This isolates SQL execution boundaries, preventing cross-tenant data leaks.
