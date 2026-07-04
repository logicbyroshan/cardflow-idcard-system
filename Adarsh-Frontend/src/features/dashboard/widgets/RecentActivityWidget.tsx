import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { type WidgetLifecycleState } from '../types'
import { 
  Plus, 
  FileUp, 
  FileDown, 
  RefreshCcw, 
  Send, 
  RefreshCw, 
  GitBranch 
} from 'lucide-react'

interface RecentActivityWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const RecentActivityWidget: React.FC<RecentActivityWidgetProps> = ({ state, onRefresh }) => {
  const activities = [
    { action: 'Client Created', detail: 'Delhi Public School (Dwarka)', actor: 'admin_roshan', time: '2m ago', type: 'create' },
    { action: 'Import Completed', detail: '2,500 student records batch #88', actor: 'operator_vijay', time: '15m ago', type: 'import' },
    { action: 'Export Completed', detail: 'Approved card list (CSV)', actor: 'operator_vijay', time: '30m ago', type: 'export' },
    { action: 'Reprint Requested', detail: 'St. Xavier\'s - 12 photo corrections', actor: 'assistant_amit', time: '1h ago', type: 'reprint' },
    { action: 'Notification Sent', detail: 'Roster approval alert to client principal', actor: 'system_daemon', time: '2h ago', type: 'notif' },
    { action: 'Desktop Sync', detail: 'DESKTOP-OP41 synchronized 120 card templates', actor: 'agent_node_dwarka', time: '4h ago', type: 'sync' },
    { action: 'Workflow Transition', detail: 'GD Goenka: 80 cards PENDING -> VERIFIED', actor: 'operator_vijay', time: '6h ago', type: 'transition' }
  ]

  const getIcon = (type: string) => {
    switch (type) {
      case 'create':
        return <Plus className="h-3.5 w-3.5 text-emerald-400" />
      case 'import':
        return <FileUp className="h-3.5 w-3.5 text-blue-400" />
      case 'export':
        return <FileDown className="h-3.5 w-3.5 text-purple-400" />
      case 'reprint':
        return <RefreshCcw className="h-3.5 w-3.5 text-rose-400" />
      case 'notif':
        return <Send className="h-3.5 w-3.5 text-cyan-400" />
      case 'sync':
        return <RefreshCw className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
      default:
        return <GitBranch className="h-3.5 w-3.5 text-indigo-400" />
    }
  }

  return (
    <WidgetWrapper 
      title="Recent Platform Activity" 
      subtitle="Audit trails and operational status updates"
      initialState={state}
      onRefresh={onRefresh}
    >
      <div className="space-y-1.5 font-saira max-h-[350px] overflow-y-auto pr-1">
        {activities.map((act, idx) => (
          <div 
            key={idx} 
            className="flex items-center justify-between p-1.5 bg-neutral-950/20 border border-border/40 rounded-xs hover:border-border/80 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-6.5 w-6.5 rounded-xs bg-neutral-950 border border-border/60 flex items-center justify-center shrink-0">
                {getIcon(act.type)}
              </div>
              <div className="flex flex-col text-left min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-foreground leading-none">
                    {act.action}
                  </span>
                  <span className="text-[9px] text-muted-foreground truncate leading-none">
                    — {act.detail}
                  </span>
                </div>
                <span className="text-[9px] text-muted-foreground truncate mt-0.5 leading-none font-semibold">
                  By {act.actor}
                </span>
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground font-semibold shrink-0 font-mono">
              {act.time}
            </div>
          </div>
        ))}
      </div>
    </WidgetWrapper>
  )
}
export default RecentActivityWidget
