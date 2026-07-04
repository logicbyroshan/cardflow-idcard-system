# Admin Dashboard Documentation

This document describes the structure, layouts, design rules, and integration points for the refined **Admin Operations Console** (Dashboard).

---

## 1. Widget Structure & Descriptions

The Admin Dashboard is organized around a dual-panel layout: a Left/Center Console for transactional records and analytics, and a fixed Right Utility Panel for status monitoring and shortcuts.

### Core Dashboard Widgets
1.  **Dashboard Header (`DashboardHeader`)**:
    *   **Purpose**: Display organization context, current ticking time, real-time date, unread notification counter, and global search shortcut (`CTRL+SHIFT+S`).
    *   **Specifications**: Constrained to exactly `48px` height with minimal labels to maximize vertical content space.
2.  **Workflow Roster Overview (`WorkflowOverviewWidget`)**:
    *   **Purpose**: Renders the dense single-row `WorkflowStrip` containing status aggregates.
    *   **Specifications**: Flat horizontal pipeline strip with minimal borders and zero margins.
3.  **Client Workspace Overview (`ClientOverviewWidget`)**:
    *   **Purpose**: ERP-style data grid displaying client school roster aggregates.
4.  **30-Day Workflow Trends (`WorkflowTrendWidget`)**:
    *   **Purpose**: Compact SVG sparkline graphs showing "Cards Processed" and "Reprints" trend curves.
5.  **Recent Platform Activity (`RecentActivityWidget`)**:
    *   **Purpose**: High-density event log stream of platform mutations.
6.  **Recent Reprints (`RecentReprintsWidget`)**:
    *   **Purpose**: Lists reprint requests queue, reason, and status indicator.
7.  **Quick Actions (`QuickActionsWidget`)**:
    *   **Purpose**: Stacks command shortcuts (Add Client, Add Operator, Send Message, Notifications, Platform Settings, Audit Logs) vertically.
8.  **User Overview (`UserOverviewWidget`)**:
    *   **Purpose**: Summarizes user types (Clients, Operators, Admins, Assistants) and active sync sessions (Desktop Active, Mobile Active).
9.  **Desktop & Device Usage (`DesktopUsageWidget`)**:
    *   **Purpose**: Lists active desktop node sync latency and sync actions.
10. **Infrastructure Health (`SystemHealthWidget`)**:
    *   **Purpose**: Displays check badges for Database, Redis Cache, R2 Storage, and Celery Workers.

---

## 2. Layout Decisions

To support low latency, high legibility, and rapid operational scanning:
*   **Dual-Panel split**:
    *   **Left Column**: Header, Workflow Strip, Center Panel (driven by tab switcher), and bottom status row (Desktop Usage & System Health).
    *   **Right Column**: Width approximately `320px`. Holds Dashboard Sections switcher, Quick Actions list, and User Overview widget.
*   **Section Layout Refinement**: All cards are border-separated and touch each other, with internal padding and zero margins.
*   **Analytics Mode**: Charts are rendered only when "Analytics" is selected in the tab switcher, preserving space when not in use.

---

## 3. Widget Registry Mapping

All widgets are configured inside `src/features/dashboard/registry/widgetRegistry.ts`:

```typescript
export const widgetRegistry: WidgetRegistryEntry[] = [
  {
    config: { id: 'workflow-overview', roles: ['ADMIN', 'PRO_USER', 'CLIENT', 'OPERATOR', 'ASSISTANT'], enabled: true, priority: 10 },
    component: WorkflowOverviewWidget
  },
  {
    config: { id: 'platform-metrics', roles: ['ADMIN', 'PRO_USER'], enabled: true, priority: 20 },
    component: PlatformMetricsWidget
  },
  {
    config: { id: 'client-overview', roles: ['ADMIN', 'PRO_USER'], enabled: true, priority: 30, permissions: ['view_clients'], featureFlag: 'clients_module' },
    component: ClientOverviewWidget
  },
  {
    config: { id: 'workflow-trend', roles: ['ADMIN', 'PRO_USER'], enabled: true, priority: 40 },
    component: WorkflowTrendWidget
  },
  {
    config: { id: 'recent-reprints', roles: ['ADMIN', 'PRO_USER'], enabled: true, priority: 45 },
    component: RecentReprintsWidget
  },
  {
    config: { id: 'recent-activity', roles: ['ADMIN', 'PRO_USER'], enabled: true, priority: 50, permissions: ['view_audit_logs'] },
    component: RecentActivityWidget
  },
  {
    config: { id: 'quick-actions', roles: ['ADMIN', 'PRO_USER', 'CLIENT', 'OPERATOR', 'ASSISTANT'], enabled: true, priority: 60 },
    component: QuickActionsWidget
  },
  {
    config: { id: 'desktop-usage', roles: ['ADMIN', 'PRO_USER'], enabled: true, priority: 70, featureFlag: 'desktop_agents' },
    component: DesktopUsageWidget
  },
  {
    config: { id: 'system-health', roles: ['ADMIN', 'PRO_USER'], enabled: true, priority: 80 },
    component: SystemHealthWidget
  },
  {
    config: { id: 'user-overview', roles: ['ADMIN', 'PRO_USER'], enabled: true, priority: 90 },
    component: UserOverviewWidget
  }
]
```
