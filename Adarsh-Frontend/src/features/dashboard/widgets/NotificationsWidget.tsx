import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { type WidgetLifecycleState } from '../types'
import { Info, AlertTriangle } from 'lucide-react'

interface NotificationsWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const NotificationsWidget: React.FC<NotificationsWidgetProps> = ({ state, onRefresh }) => {
  const notifications = [
    { title: 'Database Backup Completed', desc: 'Auto archive saved to local store.', time: '10m ago', type: 'info' },
    { title: 'New Print Roster Assigned', desc: 'Batch #88 requires operator approval.', time: '1h ago', type: 'alert' },
    { title: 'Client Config Updated', desc: 'Dr. Adarsh Clinic updated radius parameters.', time: '5h ago', type: 'info' },
    { title: 'System Engine Startup', desc: 'Vite platform server initialization complete.', time: '1d ago', type: 'info' }
  ]

  const getIcon = (type: string) => {
    if (type === 'alert') return <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
    return <Info className="h-3.5 w-3.5 text-blue-400" />
  }

  return (
    <WidgetWrapper 
      title="System Notifications" 
      subtitle="Critical alerts and messages"
      initialState={state}
      onRefresh={onRefresh}
    >
      <div className="space-y-2.5 font-saira">
        {notifications.map((notif, idx) => (
          <div 
            key={idx} 
            className="flex items-start gap-2.5 p-2.5 bg-neutral-950/20 border border-border/40 rounded-xs hover:border-border/80 transition-colors text-left"
          >
            <div className="h-7 w-7 rounded-xs bg-neutral-950 border border-border/60 flex items-center justify-center shrink-0 mt-0.5">
              {getIcon(notif.type)}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-bold text-foreground truncate">
                  {notif.title}
                </span>
                <span className="text-[9px] text-muted-foreground shrink-0 font-semibold">
                  {notif.time}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-normal">
                {notif.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </WidgetWrapper>
  )
}
export default NotificationsWidget
