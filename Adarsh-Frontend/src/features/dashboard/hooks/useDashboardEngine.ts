import { create } from 'zustand'
import { useAuthStore } from '../../auth/store/authStore'
import { widgetRegistry } from '../registry/widgetRegistry'
import { type WidgetRegistryEntry } from '../types'

interface DashboardEngineStore {
  permissions: string[]
  featureFlags: string[]
  togglePermission: (perm: string) => void
  toggleFeatureFlag: (flag: string) => void
}

// Global store to hold mock toggles for design audit validation
export const useDashboardEngineStore = create<DashboardEngineStore>((set) => ({
  permissions: ['view_clients', 'view_reprints', 'view_audit_logs'],
  featureFlags: ['clients_module', 'desktop_agents'],
  
  togglePermission: (perm) => set((state) => ({
    permissions: state.permissions.includes(perm)
      ? state.permissions.filter((p) => p !== perm)
      : [...state.permissions, perm]
  })),
  
  toggleFeatureFlag: (flag) => set((state) => ({
    featureFlags: state.featureFlags.includes(flag)
      ? state.featureFlags.filter((f) => f !== flag)
      : [...state.featureFlags, flag]
  }))
}))

export function useDashboardEngine() {
  const { user } = useAuthStore()
  const { permissions, featureFlags, togglePermission, toggleFeatureFlag } = useDashboardEngineStore()

  /**
   * Filters and sorts registered widgets based on role constraints,
   * config toggles, custom permissions, and feature flags.
   */
  const getVisibleWidgets = (): WidgetRegistryEntry[] => {
    if (!user) return []

    // Standardize role to uppercase (e.g. 'ADMIN')
    const userRole = user.role.toUpperCase()

    return widgetRegistry
      .filter((entry) => {
        const { config } = entry

        // 1. Is widget enabled globally?
        if (!config.enabled) return false

        // 2. Is user role authorized?
        const configRoles = config.roles.map((r) => r.toUpperCase())
        if (!configRoles.includes(userRole)) return false

        // 3. Are all required permissions satisfied?
        if (config.permissions && config.permissions.length > 0) {
          const hasAll = config.permissions.every((p) => permissions.includes(p))
          if (!hasAll) return false
        }

        // 4. Is the required feature flag enabled?
        if (config.featureFlag) {
          if (!featureFlags.includes(config.featureFlag)) return false
        }

        return true
      })
      .sort((a, b) => a.config.priority - b.config.priority)
  }

  return {
    visibleWidgets: getVisibleWidgets(),
    permissions,
    featureFlags,
    togglePermission,
    toggleFeatureFlag
  }
}
