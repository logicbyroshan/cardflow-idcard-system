# Domain Handbook

This section explains the 21 isolated apps within the `apps/` directory.

### 1. Users
- **Purpose**: Identity and core authentication.
- **Models**: `User`, `Profile`.
- **Flow**: Handles login, JWT generation, password resets.

### 2. Organizations
- **Purpose**: Tenant boundary.
- **Models**: `Organization`, `ClientDetail`.

### 3. Permissions & 4. Features & 5. Licenses
- **Purpose**: Granular RBAC and feature-flagging.
- **Dependencies**: Ties deeply into Policy evaluations.

### 6. Versions & 7. Impersonation
- **Purpose**: Tracks app versions and handles `PRO_USER` impersonation flows.

### 8. Tables & 9. Fields
- **Purpose**: Dynamic schema definition for Cards.

### 10. Cards
- **Purpose**: The core entity storing JSONB dynamic data.

### 11. Workflow
- **Purpose**: State machine transitioning Cards from Draft -> Approved -> Printed.

### 12. Imports & 13. Exports
- **Purpose**: Tracking background jobs for data ingress and egress.

### 14. Mediafiles
- **Purpose**: Mapping physical storage objects to database records (e.g. photos, signatures).

### 15. Jobs & 16. Notifications
- **Purpose**: Generic background task tracking and websocket/email notifications.

### 17. Search
- **Purpose**: High-speed indexing logic for global lookup.

### 18. Sandbox
- **Purpose**: Temporary test environment tracking for clients.

### 19. Auditlogs
- **Purpose**: Immutable ledger of all system actions.

### 20. Settings & 21. Desktop_sync
- **Purpose**: Global config overrides and desktop client API handshakes.\n