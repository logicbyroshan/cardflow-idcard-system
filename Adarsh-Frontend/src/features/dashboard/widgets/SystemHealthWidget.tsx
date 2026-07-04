import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { type WidgetLifecycleState } from '../types'
import { CheckCircle2 } from 'lucide-react'

interface SystemHealthWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const SystemHealthWidget: React.FC<SystemHealthWidgetProps> = ({ state, onRefresh }) => {
  const services = [
    { name: 'Database', status: 'Healthy', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' },
    { name: 'Redis Cache', status: 'Healthy', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' },
    { name: 'R2 Storage', status: 'Healthy', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' },
    { name: 'Celery Workers', status: 'Healthy', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' }
  ]

  return (
    <WidgetWrapper
      title="Infrastructure Health"
      subtitle="Background services operation status"
      initialState={state}
      onRefresh={onRefresh}
    >
      <div className="grid grid-cols-2 gap-2 font-saira text-left">
        {services.map((svc, idx) => (
          <div 
            key={idx} 
            className="p-2 bg-neutral-950/20 border border-border/40 rounded-xs flex items-center justify-between"
          >
            <span className="text-[11px] font-bold text-foreground">
              {svc.name}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span className={`text-[9px] font-black uppercase tracking-wider border px-1 rounded-xs ${svc.color}`}>
                {svc.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </WidgetWrapper>
  )
}

export default SystemHealthWidget
