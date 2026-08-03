# Widget Registry & Lifecycles

This document describes the widget registration system and the standardized component lifecycle states.

## Registry Schema
Each dashboard block registers itself in `src/features/dashboard/registry/widgetRegistry.ts` using the `WidgetRegistryEntry` interface:

```typescript
export interface WidgetConfig {
  id: WidgetId
  roles: string[]         // Authorized roles list (e.g. ['ADMIN', 'PRO_USER'])
  enabled: boolean        // Master toggle
  priority: number        // Higher priority dictates placement order
  permissions?: string[]  // Optional granular permissions
  featureFlag?: string    // Optional feature flag gate
}

export interface WidgetRegistryEntry {
  config: WidgetConfig
  component: React.ComponentType<{ state?: WidgetLifecycleState; onRefresh?: () => void }>
}
```

---

## Widget Registration Entries
The engine currently registers 8 functional widget placeholders:

| Widget ID | Target Component | Roles Map | Default Priority | Gated Permission | Gated Feature |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `workflow-overview` | `WorkflowOverviewWidget` | All Roles | 10 | None | None |
| `recent-clients` | `RecentClientsWidget` | `ADMIN`, `PRO_USER` | 20 | `view_clients` | `clients_module` |
| `recent-reprints` | `RecentReprintsWidget` | `ADMIN`, `PRO_USER`, `OPERATOR` | 30 | `view_reprints` | None |
| `recent-activity` | `RecentActivityWidget` | `ADMIN`, `PRO_USER` | 40 | `view_audit_logs` | None |
| `notifications` | `NotificationsWidget` | All Roles | 50 | None | None |
| `quick-actions` | `QuickActionsWidget` | All Roles | 60 | None | None |
| `desktop-usage` | `DesktopUsageWidget` | `ADMIN`, `PRO_USER` | 70 | None | `desktop_agents` |
| `system-health` | `SystemHealthWidget` | `ADMIN`, `PRO_USER` | 80 | None | None |

---

## Standardized Lifecycles
All widgets wrap their internal render layouts with the `WidgetWrapper` component. This guarantees support for the four core lifecycle states from day one:

1. **Loading State (`loading`)**: Renders a spinning progress loader and status sync messages.
2. **Empty State (`empty`)**: Renders a custom empty state icon, label, and description when the query returns no records.
3. **Error State (`error`)**: Displays an error warning alert with a retry button to re-trigger the data fetch.
4. **Success State (`success`)**: Displays the actual widget view.

### Debug Mode Toggles
For testing and design audits, each widget displays small state selector pills (`LD`, `MT`, `ERR`, `OK`) in its header card row when hovered or focused, allowing testers to instantly trigger transitions between these states.
