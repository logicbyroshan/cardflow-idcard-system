import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { type WidgetLifecycleState } from '../types'
import { User } from 'lucide-react'

interface RecentClientsWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const RecentClientsWidget: React.FC<RecentClientsWidgetProps> = ({ state, onRefresh }) => {
  const clients = [
    { name: 'Apex Group Ltd.', email: 'apex@group.com', type: 'Enterprise Client', status: 'Active' },
    { name: 'Dr. Adarsh Clinic', email: 'clinic@adarsh.com', type: 'Standard Client', status: 'Active' },
    { name: 'Metro Education Trust', email: 'trust@metro.edu', type: 'Pro Client', status: 'Pending Verification' },
    { name: 'Nexus Telecom', email: 'billing@nexus.net', type: 'Enterprise Client', status: 'Active' }
  ]

  return (
    <WidgetWrapper 
      title="Recent Client Accounts" 
      subtitle="Latest client operator registration records"
      initialState={state}
      onRefresh={onRefresh}
    >
      <div className="space-y-2.5 font-saira">
        {clients.map((client, idx) => (
          <div 
            key={idx} 
            className="flex items-center justify-between p-2 bg-neutral-950/20 border border-border/40 rounded-xs hover:border-border/80 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-7 w-7 rounded-xs bg-primary/10 border border-primary/25 flex items-center justify-center text-primary shrink-0">
                <User className="h-3.5 w-3.5" />
              </div>
              <div className="flex flex-col text-left min-w-0">
                <span className="text-[11px] font-bold text-foreground truncate leading-none">
                  {client.name}
                </span>
                <span className="text-[10px] text-muted-foreground truncate mt-0.5 leading-none">
                  {client.email}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-end shrink-0">
              <span className="text-[9px] font-extrabold text-muted-foreground uppercase tracking-wide">
                {client.type}
              </span>
              <span 
                className={`text-[8px] font-black uppercase tracking-widest mt-0.5 ${
                  client.status === 'Active' ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                ● {client.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </WidgetWrapper>
  )
}
export default RecentClientsWidget
