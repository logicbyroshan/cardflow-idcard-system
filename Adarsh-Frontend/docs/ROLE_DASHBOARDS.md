# Role Dashboards & Routing Mapping

This document details the user role mappings, temporary routing endpoints, and resolution flow.

## User Role Mapping Groups
Roles are mapped into two distinct workspace groups to load their respective layouts:

### 1. Operations & Admin Workspace (`AdminDashboardLayout`)
Designed for system configuration, client registrations, daemon tasks, and network monitoring:
*   **`admin`**
*   **`pro_user`**

### 2. Client & Desk Workspace (`ClientDashboardLayout`)
Designed for task printing, reprint tracking, and individual user queues:
*   **`client`**
*   **`operator`**
*   **`assistant`**

---

## Routing & Resolving Flow
The routing architecture exposes a resolver that automatically handles URL requests to the base `/dashboard` path:

1. **Base Entry (`/dashboard`)**:
   * Routed to `DashboardResolver`.
   * Checks the user's role.
   * Performs an immediate redirect replacement (`replace: true`) to preserve page history stack integrity.
2. **Admin Panel Endpoint (`/dashboard/admin`)**:
   * Displays the comprehensive multi-column admin grid layout.
   * Restricts visibility to `admin` and `pro_user` roles.
3. **Client Panel Endpoint (`/dashboard/client`)**:
   * Displays the compact single/double column layout.
   * Restricts visibility to client operators and assistants.

---

## Dynamic Role Testing
Using the navigation bar user profile options or workspace settings, testers can switch between user roles. Upon role modification, the dashboard engine automatically re-evaluates the active workspace and triggers a layout transition to keep user state isolated.
