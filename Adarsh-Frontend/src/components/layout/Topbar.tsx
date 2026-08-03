import React, { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { 
  Server, 
  User, 
  LogOut, 
  CheckCircle, 
  Bell, 
  Search, 
  Globe 
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'
import { useShortcuts } from '@/hooks/useShortcuts'

export const Topbar: React.FC = () => {
  const location = useLocation()
  const { user, clearSession, updateRole } = useAuthStore()
  const [notifications, setNotifications] = useState([
    { id: 1, text: 'Sync completed for Roster Batch 41', read: false, time: '2m ago' },
    { id: 2, text: 'New Reprint Request in operator queue', read: false, time: '5m ago' },
    { id: 3, text: 'Roster validation threshold triggered', read: true, time: '1h ago' }
  ])

  // Register Global Search keyboard shortcut CTRL+SHIFT+S
  useShortcuts([
    {
      key: 's',
      ctrlKey: true,
      shiftKey: true,
      description: 'Trigger global search modal',
      action: () => {
        alert('[Keyboard Shortcut] Global Search activated via CTRL+SHIFT+S')
      }
    }
  ])

  const currentUser = user || {
    name: 'Adarsh Administrator',
    email: 'admin@adarshid.com',
    role: 'admin' as const
  }

  const unreadCount = notifications.filter(n => !n.read).length

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  // Generate dynamic path breadcrumbs for layout page context
  const pathParts = location.pathname.split('/').filter(Boolean)
  const formattedCrumbs = pathParts.map(part => {
    return part.charAt(0).toUpperCase() + part.slice(1).replace('-', ' ')
  })

  return (
    <header className="h-14 bg-panel border-b border-border flex items-center justify-between px-4 select-none shrink-0 font-saira">
      
      {/* Left: Page Context & Breadcrumbs */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-success">
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span className="text-caption font-semibold hidden sm:inline">Sync Active</span>
        </div>
        <div className="h-4 w-[1px] bg-border" />
        <div className="text-caption text-muted-foreground flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" />
          <span className="font-semibold text-foreground">ROOT</span>
          {formattedCrumbs.map((crumb, idx) => (
            <React.Fragment key={idx}>
              <span className="text-border">/</span>
              <span className={idx === formattedCrumbs.length - 1 ? 'text-primary font-bold' : ''}>
                {crumb}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Right: Search, Notifications, User Menu, Role Toggler */}
      <div className="flex items-center gap-4">
        
        {/* Global Search Trigger */}
        <button 
          onClick={() => {
            alert('[Search Action] Clicked global search entry trigger (Shortcut: CTRL+SHIFT+S)')
          }}
          className="flex items-center gap-2 bg-background border border-border px-3 py-1.5 rounded-sm hover:border-primary/40 hover:text-foreground transition-colors text-muted-foreground text-caption"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Global Search...</span>
          <kbd className="bg-neutral-900 border border-border px-1.5 py-0.2 rounded-xs text-[9px] font-mono font-bold tracking-widest text-muted-foreground">
            CTRL+SHIFT+S
          </kbd>
        </button>

        {/* Notification Bell Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="relative p-1.5 rounded-sm hover:bg-neutral-800/40 text-muted hover:text-foreground transition-colors focus:outline-none">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-3.5 w-3.5 bg-primary text-primary-foreground font-extrabold text-[9px] rounded-full flex items-center justify-center font-mono">
                  {unreadCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-panel border border-border w-80 p-0 overflow-hidden">
            <div className="p-3 border-b border-border bg-neutral-950/20 flex justify-between items-center">
              <span className="text-caption font-bold text-foreground">Notifications ({unreadCount})</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-[10px] text-primary hover:underline font-bold">
                  Mark all read
                </button>
              )}
            </div>
            <div className="divide-y divide-border/40 max-h-60 overflow-y-auto">
              {notifications.map((n) => (
                <div key={n.id} className={`p-3 flex flex-col gap-1 ${!n.read ? 'bg-primary/5' : ''}`}>
                  <p className="text-caption text-foreground leading-normal">{n.text}</p>
                  <span className="text-[10px] text-muted-foreground font-mono">{n.time}</span>
                </div>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Quick Actions / Cluster Status */}
        <div className="hidden md:flex items-center gap-1.5 text-caption text-muted-foreground bg-neutral-900/40 px-2 py-1 border border-border/40 rounded-xs">
          <Server className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Node Clusters: 3/3</span>
        </div>

        {/* User Menu & Role Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 hover:bg-neutral-800/40 p-1 px-2 rounded-sm transition-colors focus:outline-none">
              <div className="h-6 w-6 rounded-sm bg-neutral-800 border border-border flex items-center justify-center text-primary">
                <User className="h-4 w-4" />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-caption font-bold text-foreground leading-none">{currentUser.name}</span>
                <span className="text-[9px] text-primary uppercase font-extrabold tracking-widest mt-0.5">{currentUser.role}</span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-panel border border-border w-64 p-0">
            <div className="p-3 border-b border-border">
              <span className="text-caption block font-bold text-foreground">{currentUser.name}</span>
              <span className="text-[11px] block text-muted-foreground mt-0.5">{currentUser.email}</span>
            </div>

            {/* Dynamic Role Switcher for Phase 1 Demo */}
            <div className="p-2 border-b border-border bg-neutral-950/20">
              <span className="text-[10px] block font-bold text-muted-foreground uppercase tracking-widest px-2 mb-1.5">
                Simulate Role Visibility
              </span>
              <div className="grid grid-cols-2 gap-1 px-1">
                {(['admin', 'operator', 'pro_user', 'client', 'assistant'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => updateRole(r)}
                    className={`text-[10px] py-1 px-2 text-left rounded-xs font-mono font-bold uppercase tracking-wider ${
                      currentUser.role === r 
                        ? 'bg-primary text-primary-foreground' 
                        : 'text-muted-foreground hover:bg-neutral-800 hover:text-foreground'
                    }`}
                  >
                    {r.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest px-3 pt-2">
              System Context
            </DropdownMenuLabel>
            <div className="px-3 pb-2 text-[10px] text-muted-foreground font-mono space-y-0.5">
              <div>BUILD: 9081-PROD</div>
              <div>VERSION: v3.0.0-fnd</div>
            </div>

            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem 
              onClick={clearSession} 
              className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer flex items-center gap-2 p-2.5"
            >
              <LogOut className="h-4 w-4" />
              <span className="text-caption font-bold">Log Out Session</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

      </div>
    </header>
  )
}

export default Topbar
