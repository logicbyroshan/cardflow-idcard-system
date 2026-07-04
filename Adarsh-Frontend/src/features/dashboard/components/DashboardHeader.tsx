import React, { useState, useEffect } from 'react'
import { Bell, Search } from 'lucide-react'

interface DashboardHeaderProps {
  orgName?: string
  unreadNotifications?: number
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  orgName = 'Adarsh ID Management Platform',
  unreadNotifications = 8,
}) => {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }).toUpperCase()
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }

  return (
    <header className="h-12 min-h-[48px] bg-panel border border-border px-3.5 flex items-center justify-between select-none font-saira text-left w-full overflow-hidden">
      {/* Brand & Organization Title */}
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="text-body font-black text-foreground tracking-wide truncate leading-none">
          {orgName}
        </h1>
        <span className="text-[9px] text-muted-foreground uppercase border border-border/60 px-1 rounded-xs tracking-wider">
          Admin Dashboard
        </span>
      </div>

      {/* Date, Time, Search Hint, Notification count */}
      <div className="flex items-center gap-4 text-caption">
        {/* Date and Time Info */}
        <div className="hidden md:flex items-center gap-2 border-r border-border/60 pr-4 font-mono text-[11px]">
          <span className="text-muted-foreground font-semibold">{formatDate(time)}</span>
          <span className="text-muted-foreground">•</span>
          <span className="text-foreground font-black tracking-wider">{formatTime(time)}</span>
        </div>

        {/* Global Search Hint */}
        <div className="hidden lg:flex items-center gap-1.5 bg-neutral-950/40 border border-border/40 px-1.5 py-0.5 rounded-xs">
          <Search className="h-3 w-3 text-muted-foreground" />
          <kbd className="text-muted-foreground text-[9px] font-mono font-bold">
            CTRL+SHIFT+S
          </kbd>
        </div>

        {/* Notification Indicator */}
        <div className="relative cursor-pointer hover:bg-neutral-800/25 p-1 rounded-xs transition-colors">
          <Bell className="h-4 w-4 text-foreground" />
          {unreadNotifications > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white font-mono font-bold text-[8px] px-1 rounded-full leading-none min-w-[12px] h-[12px] flex items-center justify-center">
              {unreadNotifications}
            </span>
          )}
        </div>
      </div>
    </header>
  )
}

export default DashboardHeader
