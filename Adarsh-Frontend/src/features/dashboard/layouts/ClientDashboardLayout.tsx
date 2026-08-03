import React from 'react'
import { useDashboardEngine } from '../hooks/useDashboardEngine'
import { useAuthStore } from '../../auth/store/authStore'
import { User, Sliders } from 'lucide-react'

export const ClientDashboardLayout: React.FC = () => {
  const { user } = useAuthStore()
  const {
    visibleWidgets,
    permissions,
    featureFlags,
    togglePermission,
    toggleFeatureFlag
  } = useDashboardEngine()

  const renderWidget = (id: string) => {
    const entry = visibleWidgets.find((w) => w.config.id === id)
    if (!entry) return null
    const WidgetComponent = entry.component
    return <WidgetComponent key={id} />
  }

  const hasVisibleWidget = (ids: string[]) => {
    return visibleWidgets.some((w) => ids.includes(w.config.id))
  }

  return (
    <div className="space-y-6 font-saira text-left">
      {/* Header section with live debug controller panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-neutral-900/20 border border-border/40 rounded-xs backdrop-blur-md">
        <div>
          <h1 className="text-subheading font-black text-foreground tracking-wide flex items-center gap-2">
            <User className="h-5 w-5 text-primary" /> CLIENT OPERATIONS PANEL
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Role: <span className="text-primary font-bold uppercase">{user?.role}</span> • Scope: Assigned Workflows Only
          </p>
        </div>

        {/* Visibility Engine Controls (Debug Toggles) */}
        <div className="flex flex-wrap items-center gap-4 bg-neutral-950/40 border border-border/60 p-2.5 rounded-xs select-none">
          <div className="flex flex-col gap-1.5">
            <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1">
              <Sliders className="h-3 w-3" /> Visibility Engine Controls
            </span>
            <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-foreground">
              {/* Permission Toggles */}
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={permissions.includes('view_reprints')}
                  onChange={() => togglePermission('view_reprints')}
                  className="rounded bg-neutral-900 border-border text-primary focus:ring-0 h-3 w-3"
                />
                Reprint Perm
              </label>

              {/* Feature Flag Toggles */}
              <label className="flex items-center gap-1.5 cursor-pointer text-indigo-400 border-l border-border/60 pl-3">
                <input
                  type="checkbox"
                  checked={featureFlags.includes('clients_module')}
                  onChange={() => toggleFeatureFlag('clients_module')}
                  className="rounded bg-neutral-900 border-border text-primary focus:ring-0 h-3 w-3"
                />
                Clients Module
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Workflow Overview Section */}
      {hasVisibleWidget(['workflow-overview']) && (
        <div className="space-y-2">
          <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block">
            Workflow Overview
          </span>
          {renderWidget('workflow-overview')}
        </div>
      )}

      {/* 2. Client Grid Layout for Recent Activity, Quick Actions, and Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left column: Recent Activity Area */}
        {hasVisibleWidget(['recent-reprints']) && (
          <div className="space-y-4 lg:col-span-2">
            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block">
              Recent activity
            </span>
            {renderWidget('recent-reprints')}
          </div>
        )}

        {/* Right column: Quick Actions and Notifications stack */}
        <div className="space-y-6">
          {hasVisibleWidget(['quick-actions']) && (
            <div className="space-y-4">
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block">
                Quick Actions
              </span>
              {renderWidget('quick-actions')}
            </div>
          )}

          {hasVisibleWidget(['notifications']) && (
            <div className="space-y-4">
              <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block">
                Notifications
              </span>
              {renderWidget('notifications')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export default ClientDashboardLayout
