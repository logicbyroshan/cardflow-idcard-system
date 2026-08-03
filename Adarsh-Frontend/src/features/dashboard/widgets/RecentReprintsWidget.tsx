import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { type WidgetLifecycleState } from '../types'
import { FileText, CheckCircle2, AlertTriangle, Clock } from 'lucide-react'

interface RecentReprintsWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const RecentReprintsWidget: React.FC<RecentReprintsWidgetProps> = ({ state, onRefresh }) => {
  const reprints = [
    { cardId: 'CRD-8941', holder: 'Adarsh Patel', reason: 'Damaged Magnetic Strip', time: '12m ago', status: 'printing' },
    { cardId: 'CRD-7104', holder: 'Roshan Damor', reason: 'Spelling Correction', time: '45m ago', status: 'completed' },
    { cardId: 'CRD-3298', holder: 'Sneha Shah', reason: 'Card Lost', time: '2h ago', status: 'failed' },
    { cardId: 'CRD-4911', holder: 'Vijay Kumar', reason: 'Role Promotion Upgrade', time: '4h ago', status: 'completed' }
  ]

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      case 'failed':
        return <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
      default:
        return <Clock className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
    }
  }

  return (
    <WidgetWrapper 
      title="Reprints Queue" 
      subtitle="Pending and recent batch reprint runs"
      initialState={state}
      onRefresh={onRefresh}
    >
      <div className="space-y-2.5 font-saira">
        {reprints.map((rep, idx) => (
          <div 
            key={idx} 
            className="flex items-center justify-between p-2 bg-neutral-950/20 border border-border/40 rounded-xs hover:border-border/80 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-7 w-7 rounded-xs bg-neutral-950 border border-border/60 flex items-center justify-center text-muted-foreground shrink-0">
                <FileText className="h-3.5 w-3.5" />
              </div>
              <div className="flex flex-col text-left min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-foreground truncate">
                    {rep.holder}
                  </span>
                  <span className="text-[9px] font-black text-primary bg-primary/10 border border-primary/20 px-1 rounded-xs uppercase tracking-wide">
                    {rep.cardId}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground truncate mt-0.5 leading-none">
                  Reason: {rep.reason}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <span className="text-[10px] text-muted-foreground font-semibold">
                {rep.time}
              </span>
              {getStatusIcon(rep.status)}
            </div>
          </div>
        ))}
      </div>
    </WidgetWrapper>
  )
}
export default RecentReprintsWidget
