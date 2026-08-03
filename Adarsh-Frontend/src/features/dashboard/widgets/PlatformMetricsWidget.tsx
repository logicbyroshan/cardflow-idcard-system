import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { type WidgetLifecycleState } from '../types'
import { Building, School, Users, UserCheck, Table, CreditCard } from 'lucide-react'

interface PlatformMetricsWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const PlatformMetricsWidget: React.FC<PlatformMetricsWidgetProps> = ({ state, onRefresh }) => {
  const metrics = [
    { label: 'Organizations', value: '14', icon: Building, color: 'text-blue-400' },
    { label: 'Clients', value: '182', icon: School, color: 'text-indigo-400' },
    { label: 'Operators', value: '42', icon: Users, color: 'text-emerald-400' },
    { label: 'Assistants', value: '95', icon: UserCheck, color: 'text-cyan-400' },
    { label: 'Tables', value: '560', icon: Table, color: 'text-amber-400' },
    { label: 'Cards', value: '148,209', icon: CreditCard, color: 'text-rose-400' }
  ]

  return (
    <WidgetWrapper
      title="Platform Aggregates"
      subtitle="Total metrics currently synchronized across the platform instance"
      initialState={state}
      onRefresh={onRefresh}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border border-border bg-neutral-950/20 divide-x divide-y lg:divide-y-0 divide-border font-saira">
        {metrics.map((m, idx) => {
          const Icon = m.icon
          return (
            <div key={idx} className="p-3 flex items-center gap-3 justify-start lg:justify-center">
              <div className="h-8 w-8 rounded-xs bg-neutral-900 border border-border/60 flex items-center justify-center shrink-0">
                <Icon className={`h-4.5 w-4.5 ${m.color}`} />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-[10px] text-muted-foreground uppercase font-black tracking-wider leading-none">
                  {m.label}
                </span>
                <span className="text-[18px] font-black text-foreground mt-0.5 font-mono leading-none">
                  {m.value}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </WidgetWrapper>
  )
}

export default PlatformMetricsWidget
