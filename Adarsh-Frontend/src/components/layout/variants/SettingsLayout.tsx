import React from 'react'

interface SettingsLayoutProps {
  tabs: { id: string; label: string; active?: boolean; onClick?: () => void }[]
  children: React.ReactNode
}

export const SettingsLayout: React.FC<SettingsLayoutProps> = ({ tabs, children }) => {
  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-panel border border-border rounded-sm overflow-hidden divide-y md:divide-y-0 md:divide-x divide-border">
      {/* Left tabs menu */}
      <div className="w-full md:w-64 shrink-0 bg-neutral-950/10 p-4 space-y-1">
        <h3 className="text-caption text-muted font-bold uppercase tracking-wider px-2 mb-2">Settings Navigation</h3>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={tab.onClick}
            className={`w-full text-left px-3 py-2 rounded-sm text-body transition-colors font-medium ${
              tab.active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted hover:text-foreground hover:bg-neutral-800/40'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Right settings content area */}
      <div className="flex-1 p-6 overflow-y-auto bg-background/30 space-y-6">
        {children}
      </div>
    </div>
  )
}

export default SettingsLayout
