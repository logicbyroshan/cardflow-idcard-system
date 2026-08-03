import React from 'react'

export type WidgetId =
  | 'recent-clients'
  | 'recent-reprints'
  | 'recent-activity'
  | 'notifications'
  | 'quick-actions'
  | 'workflow-overview'
  | 'desktop-usage'
  | 'system-health'
  | 'client-overview'
  | 'platform-metrics'
  | 'workflow-trend'
  | 'user-overview'

export type WidgetLifecycleState = 'loading' | 'empty' | 'success' | 'error'

export interface WidgetConfig {
  id: WidgetId
  roles: string[] // supports uppercase/lowercase, e.g. ["PRO_USER", "ADMIN"]
  enabled: boolean
  priority: number
  permissions?: string[] // optional permission check
  featureFlag?: string // optional feature flag check
}

export interface WidgetRegistryEntry {
  config: WidgetConfig
  component: React.ComponentType<{ state?: WidgetLifecycleState; onRefresh?: () => void }>
}

export interface DashboardLayoutProps {
  children?: React.ReactNode
}

export interface WorkflowStatusConfig {
  key: string
  label: string
  color: string // Tailwind bg/text/border colors
  badgeStyle: string // CSS/Tailwind class
  token: string
}
