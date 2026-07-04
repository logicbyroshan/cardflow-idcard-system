import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { type WidgetLifecycleState } from '../types'
import { Users, UserCheck, Shield, Laptop, Smartphone, UsersRound } from 'lucide-react'

interface UserOverviewWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const UserOverviewWidget: React.FC<UserOverviewWidgetProps> = ({ state, onRefresh }) => {
  const users = [
    { label: 'Clients', value: '182', icon: Users, color: 'text-indigo-400' },
    { label: 'Operators', value: '42', icon: UserCheck, color: 'text-emerald-400' },
    { label: 'Admins', value: '14', icon: Shield, color: 'text-blue-400' },
    { label: 'Assistants', value: '95', icon: UsersRound, color: 'text-cyan-400' },
    { label: 'Desktop Active', value: '4 Active', icon: Laptop, color: 'text-amber-400' },
    { label: 'Mobile Active', value: '18 Online', icon: Smartphone, color: 'text-purple-400' }
  ]

  return (
    <WidgetWrapper
      title="User & Session Overview"
      subtitle="Platform accounts and active sessions"
      initialState={state}
      onRefresh={onRefresh}
    >
      <div className="grid grid-cols-2 gap-[6px] font-saira text-left w-full">
        {users.map((u, idx) => {
          const Icon = u.icon
          return (
            <div 
              key={idx} 
              className="p-[4px] bg-neutral-950/20 border border-border/40 rounded-xs flex items-center gap-[6px] justify-start h-[34px] w-full min-w-0"
            >
              <Icon className={`h-[14px] w-[14px] ${u.color} shrink-0`} />
              <div className="flex flex-col min-w-0 justify-center">
                <span className="text-[8px] text-muted-foreground uppercase font-black leading-none truncate">
                  {u.label}
                </span>
                <span className="text-[11px] font-black text-foreground font-mono mt-[2px] leading-none">
                  {u.value}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </WidgetWrapper>
  )
}

export default UserOverviewWidget
