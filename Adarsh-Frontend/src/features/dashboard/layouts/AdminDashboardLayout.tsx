import React, { useState } from 'react'
import { useDashboardEngine } from '../hooks/useDashboardEngine'
import { DashboardHeader } from '../components/DashboardHeader'
import { Sliders } from 'lucide-react'
import { cn } from '@/utils/cn'

export const AdminDashboardLayout: React.FC = () => {
  const {
    visibleWidgets,
    permissions,
    featureFlags,
    togglePermission,
    toggleFeatureFlag
  } = useDashboardEngine()

  const [activeSection, setActiveSection] = useState<'recent-clients' | 'recent-reprints' | 'recent-updates' | 'analytics'>('recent-clients')

  // Helper to find and render a widget component by its id
  const renderWidget = (id: string) => {
    const entry = visibleWidgets.find((w) => w.config.id === id)
    if (!entry) return null
    const WidgetComponent = entry.component
    return <WidgetComponent key={id} />
  }

  const sections: { id: 'recent-clients' | 'recent-reprints' | 'recent-updates' | 'analytics'; label: string }[] = [
    { id: 'recent-clients', label: 'Recent Clients' },
    { id: 'recent-reprints', label: 'Recent Reprints' },
    { id: 'recent-updates', label: 'Recent Updates' },
    { id: 'analytics', label: 'Analytics' }
  ]

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'recent-clients':
        return renderWidget('client-overview')
      case 'recent-reprints':
        return renderWidget('recent-reprints')
      case 'recent-updates':
        return renderWidget('recent-activity')
      case 'analytics':
        return renderWidget('workflow-trend')
      default:
        return null
    }
  }

  return (
    <div className="flex h-full w-full overflow-hidden font-saira text-left select-none items-stretch p-0 m-0 bg-background">
      {/* Left/Center Columns: Operations Control Hub (The ONLY scrollable region) */}
      <div className="flex-1 min-w-[680px] h-full flex flex-col justify-between overflow-hidden bg-background border-r border-border">
        
        {/* Header */}
        <div className="p-2 bg-panel border-b border-border shrink-0">
          <DashboardHeader orgName="Adarsh ID Management Platform" unreadNotifications={8} />
        </div>

        {/* Workflow Strip */}
        <div className="p-2 bg-neutral-950/10 border-b border-border shrink-0">
          {renderWidget('workflow-overview')}
        </div>

        {/* Visibility Engine Controls (Debug Panel) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1 bg-neutral-950/20 text-[9px] font-bold text-foreground border-b border-border shrink-0 select-none">
          <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1">
            <Sliders className="h-2.5 w-2.5" /> Visibility Engine Controls:
          </span>
          <div className="flex flex-wrap items-center gap-3">
            {/* Permission Toggles */}
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={permissions.includes('view_clients')}
                onChange={() => togglePermission('view_clients')}
                className="rounded bg-neutral-900 border-border text-primary focus:ring-0 h-2.5 w-2.5"
              />
              Clients Perm
            </label>

            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={permissions.includes('view_audit_logs')}
                onChange={() => togglePermission('view_audit_logs')}
                className="rounded bg-neutral-900 border-border text-primary focus:ring-0 h-2.5 w-2.5"
              />
              Audit Perm
            </label>

            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={permissions.includes('view_reprints')}
                onChange={() => togglePermission('view_reprints')}
                className="rounded bg-neutral-900 border-border text-primary focus:ring-0 h-2.5 w-2.5"
              />
              Reprint Perm
            </label>

            {/* Feature Flag Toggles */}
            <label className="flex items-center gap-1 cursor-pointer text-indigo-400 border-l border-border/40 pl-2">
              <input
                type="checkbox"
                checked={featureFlags.includes('clients_module')}
                onChange={() => toggleFeatureFlag('clients_module')}
                className="rounded bg-neutral-900 border-border text-primary focus:ring-0 h-2.5 w-2.5"
              />
              Clients Module
            </label>

            <label className="flex items-center gap-1 cursor-pointer text-indigo-400">
              <input
                type="checkbox"
                checked={featureFlags.includes('desktop_agents')}
                onChange={() => toggleFeatureFlag('desktop_agents')}
                className="rounded bg-neutral-900 border-border text-primary focus:ring-0 h-2.5 w-2.5"
              />
              Agent Nodes Flag
            </label>
          </div>
        </div>

        {/* Scrollable Center Content Area */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 thin-scrollbar bg-background">
          {/* Selected Section */}
          <div className="min-h-[220px]">
            {renderActiveSection()}
          </div>

          {/* Bottom Status Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-border border border-border bg-panel shrink-0">
            <div className="p-2">{renderWidget('desktop-usage')}</div>
            <div className="p-2">{renderWidget('system-health')}</div>
          </div>
        </div>
      </div>

      {/* Right Utility Area: Fixed height 100vh, never scrolls */}
      <div className="w-[320px] h-full shrink-0 bg-panel divide-y divide-border flex flex-col justify-start overflow-hidden">
        
        {/* Dashboard Sections Switcher */}
        <div className="p-2.5 shrink-0">
          <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest block mb-1.5">
            Dashboard Sections
          </span>
          <div className="flex flex-col border border-border bg-neutral-950/20 divide-y divide-border/60">
            {sections.map((sec) => (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                className={cn(
                  "w-full text-left px-2.5 py-1 text-[10px] font-black transition-colors select-none tracking-wider",
                  activeSection === sec.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted hover:text-foreground hover:bg-neutral-800/40"
                )}
              >
                {sec.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="p-2.5 shrink-0">
          {renderWidget('quick-actions')}
        </div>

        {/* User Overview */}
        <div className="p-2.5 shrink-0">
          {renderWidget('user-overview')}
        </div>
      </div>

      {/* Thin webkit scrollbar inline styles */}
      <style>{`
        .thin-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .thin-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.05);
        }
        .thin-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 3px;
        }
        .thin-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.22);
        }
      `}</style>
    </div>
  )
}

export default AdminDashboardLayout
