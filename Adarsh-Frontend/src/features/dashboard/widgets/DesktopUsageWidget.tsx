import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { type WidgetLifecycleState } from '../types'
import { Monitor, Smartphone, RefreshCw, Clock } from 'lucide-react'

interface DesktopUsageWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const DesktopUsageWidget: React.FC<DesktopUsageWidgetProps> = ({ state, onRefresh }) => {
  const usageItems = [
    { label: 'Desktop Active Nodes', value: '4 nodes online', icon: Monitor, detail: 'DESKTOP-OP41, DESKTOP-OP42, DESKTOP-OP43, MACBOOK-OP4', color: 'text-emerald-400' },
    { label: 'Mobile Active Sessions', value: '18 users active', icon: Smartphone, detail: 'iOS 12 active, Android 6 active', color: 'text-blue-400' },
    { label: 'Recent Sync Action', value: 'Sync Roster Batch #88', icon: RefreshCw, detail: 'Delhi Public School — 240 records', color: 'text-amber-400' },
    { label: 'Last Sync Time', value: '0.4s ago', icon: Clock, detail: 'Vite daemon sync latency: 42ms', color: 'text-muted-foreground' }
  ]

  return (
    <WidgetWrapper
      title="Desktop & Device Usage"
      subtitle="Operational device syncs and active connections"
      initialState={state}
      onRefresh={onRefresh}
    >
      <div className="space-y-1.5 font-saira text-left">
        {usageItems.map((item, idx) => {
          const Icon = item.icon
          return (
            <div 
              key={idx} 
              className="flex items-center justify-between p-2 bg-neutral-950/20 border border-border/40 rounded-xs hover:border-border/80 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 rounded-xs bg-neutral-950 border border-border/60 flex items-center justify-center shrink-0">
                  <Icon className={`h-3.5 w-3.5 ${item.color}`} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] text-muted-foreground uppercase font-black tracking-wider leading-none">
                    {item.label}
                  </span>
                  <span className="text-[11px] font-bold text-foreground truncate mt-0.5 leading-none">
                    {item.value}
                  </span>
                  <span className="text-[9px] text-muted-foreground truncate mt-0.5 leading-none">
                    {item.detail}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </WidgetWrapper>
  )
}

export default DesktopUsageWidget
