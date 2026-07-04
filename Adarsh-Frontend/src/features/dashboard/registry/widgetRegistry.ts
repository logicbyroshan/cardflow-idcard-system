import { ClientOverviewWidget } from '../widgets/ClientOverviewWidget'
import { PlatformMetricsWidget } from '../widgets/PlatformMetricsWidget'
import { WorkflowTrendWidget } from '../widgets/WorkflowTrendWidget'
import { RecentActivityWidget } from '../widgets/RecentActivityWidget'
import { RecentReprintsWidget } from '../widgets/RecentReprintsWidget'
import { QuickActionsWidget } from '../widgets/QuickActionsWidget'
import { WorkflowOverviewWidget } from '../widgets/WorkflowOverviewWidget'
import { DesktopUsageWidget } from '../widgets/DesktopUsageWidget'
import { SystemHealthWidget } from '../widgets/SystemHealthWidget'
import { UserOverviewWidget } from '../widgets/UserOverviewWidget'
import { type WidgetRegistryEntry } from '../types'

/**
 * Global registry defining all dashboard widgets, their roles, priorities, and conditions.
 */
export const widgetRegistry: WidgetRegistryEntry[] = [
  {
    config: {
      id: 'workflow-overview',
      roles: ['ADMIN', 'PRO_USER', 'CLIENT', 'OPERATOR', 'ASSISTANT'],
      enabled: true,
      priority: 10
    },
    component: WorkflowOverviewWidget
  },
  {
    config: {
      id: 'platform-metrics',
      roles: ['ADMIN', 'PRO_USER'],
      enabled: true,
      priority: 20
    },
    component: PlatformMetricsWidget
  },
  {
    config: {
      id: 'client-overview',
      roles: ['ADMIN', 'PRO_USER'],
      enabled: true,
      priority: 30,
      permissions: ['view_clients'],
      featureFlag: 'clients_module'
    },
    component: ClientOverviewWidget
  },
  {
    config: {
      id: 'workflow-trend',
      roles: ['ADMIN', 'PRO_USER'],
      enabled: true,
      priority: 40
    },
    component: WorkflowTrendWidget
  },
  {
    config: {
      id: 'recent-reprints',
      roles: ['ADMIN', 'PRO_USER'],
      enabled: true,
      priority: 45
    },
    component: RecentReprintsWidget
  },
  {
    config: {
      id: 'recent-activity',
      roles: ['ADMIN', 'PRO_USER'],
      enabled: true,
      priority: 50,
      permissions: ['view_audit_logs']
    },
    component: RecentActivityWidget
  },
  {
    config: {
      id: 'quick-actions',
      roles: ['ADMIN', 'PRO_USER', 'CLIENT', 'OPERATOR', 'ASSISTANT'],
      enabled: true,
      priority: 60
    },
    component: QuickActionsWidget
  },
  {
    config: {
      id: 'desktop-usage',
      roles: ['ADMIN', 'PRO_USER'],
      enabled: true,
      priority: 70,
      featureFlag: 'desktop_agents'
    },
    component: DesktopUsageWidget
  },
  {
    config: {
      id: 'system-health',
      roles: ['ADMIN', 'PRO_USER'],
      enabled: true,
      priority: 80
    },
    component: SystemHealthWidget
  },
  {
    config: {
      id: 'user-overview',
      roles: ['ADMIN', 'PRO_USER'],
      enabled: true,
      priority: 90
    },
    component: UserOverviewWidget
  }
]

export default widgetRegistry
