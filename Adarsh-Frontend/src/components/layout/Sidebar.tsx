import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuthStore } from '@/stores/authStore'
import { navigationConfig } from '@/constants/navigation'
import { Badge } from '@/components/ui/badge'
import { useBrand } from '@/components/brand/BrandProvider'

export const Sidebar: React.FC = () => {
  const location = useLocation()
  const { user } = useAuthStore()
  const brand = useBrand()
  const [openSubmenus, setOpenSubmenus] = useState<Record<string, boolean>>({})

  // Default fallback user role
  const userRole = user?.role || 'admin'

  const toggleSubmenu = (label: string) => {
    setOpenSubmenus((prev) => ({
      ...prev,
      [label]: !prev[label],
    }))
  }

  // Mock Feature Flags for visualization
  const featureFlags = [
    { flag: 'MOCK_SYNC_V2', active: true },
    { flag: 'ROSTER_AUDIT', active: false },
  ]

  // Filter navigation items by role
  const filteredNavGroups = navigationConfig.map((group) => {
    const visibleItems = group.items.filter((item) => {
      const hasItemAccess = item.roles.includes(userRole)
      return hasItemAccess
    }).map((item) => {
      // Filter submenus by role if they exist
      if (item.submenu) {
        return {
          ...item,
          submenu: item.submenu.filter((sub) => sub.roles.includes(userRole)),
        }
      }
      return item
    })

    return {
      ...group,
      items: visibleItems,
    }
  }).filter((group) => group.items.length > 0)

  return (
    <aside className="w-[192px] bg-sidebar border-r border-border flex flex-col h-screen select-none shrink-0 font-saira">
      {/* Brand Header */}
      <div className="h-[44px] border-b border-border flex items-center px-[10px] gap-[6px] bg-neutral-950/20 shrink-0">
        <brand.Icon className="h-[16px] w-[16px] text-primary animate-pulse shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="font-bold text-[12px] text-foreground tracking-wider leading-none truncate">
            {brand.name}
          </span>
          <span className="text-[8px] text-muted-foreground uppercase tracking-widest mt-[2px] leading-none">
            {brand.version}
          </span>
        </div>
      </div>

      {/* Nav Groups */}
      <nav className="flex-1 py-[8px] px-[6px] space-y-[12px] overflow-y-auto">
        {filteredNavGroups.map((group, groupIdx) => (
          <div key={groupIdx} className="space-y-[4px]">
            <div className="px-[8px] text-[9px] font-black text-muted-foreground uppercase tracking-wider">
              {group.groupName}
            </div>
            <div className="space-y-[2px]">
              {group.items.map((item) => {
                const hasSubmenu = item.submenu && item.submenu.length > 0
                const isSubmenuOpen = !!openSubmenus[item.label]
                const isActive = location.pathname.startsWith(item.path)

                return (
                  <div key={item.path} className="space-y-[2px]">
                    {hasSubmenu ? (
                      <button
                        onClick={() => toggleSubmenu(item.label)}
                        className={cn(
                          'w-full flex items-center justify-between px-[8px] py-[4px] text-[11px] font-bold rounded-xs transition-colors text-muted hover:text-foreground hover:bg-neutral-800/40',
                          isActive && 'text-foreground bg-neutral-800/20'
                        )}
                      >
                        <div className="flex items-center gap-[8px] min-w-0">
                          <item.icon className="h-[14px] w-[14px] shrink-0 text-muted-foreground" />
                          <span className="truncate">{item.label}</span>
                        </div>
                        {isSubmenuOpen ? (
                          <ChevronDown className="h-[12px] w-[12px] text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-[12px] w-[12px] text-muted-foreground shrink-0" />
                        )}
                      </button>
                    ) : (
                      <Link
                        to={item.path}
                        className={cn(
                          'flex items-center gap-[8px] px-[8px] py-[4px] text-[11px] font-bold rounded-xs transition-colors',
                          location.pathname === item.path
                            ? 'bg-primary text-primary-foreground font-black'
                            : 'text-muted hover:text-foreground hover:bg-neutral-800/40'
                        )}
                      >
                        <item.icon className="h-[14px] w-[14px] shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    )}

                    {/* Submenu rendering */}
                    {hasSubmenu && isSubmenuOpen && (
                      <div className="pl-[20px] pr-[4px] py-[2px] space-y-[2px] border-l border-border/40 ml-[14px]">
                        {item.submenu!.map((sub) => {
                          const isSubActive = location.pathname === sub.path
                          return (
                            <Link
                              key={sub.path}
                              to={sub.path}
                              className={cn(
                                'block px-[8px] py-[4px] text-[10px] font-bold rounded-xs transition-colors truncate',
                                isSubActive
                                  ? 'text-primary font-black'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-neutral-800/20'
                              )}
                            >
                              {sub.label}
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Dev Mode Canvas Entry */}
      {import.meta.env.DEV && (
        <div className="px-[6px] py-[6px] border-t border-border bg-neutral-950/20 shrink-0">
          <Link
            to="/design-lab"
            className={cn(
              'flex items-center gap-[8px] px-[8px] py-[4px] text-[10px] rounded-xs transition-colors border border-dashed border-border/60 text-primary hover:bg-primary/10 font-bold',
              location.pathname.startsWith('/design-lab') && 'bg-primary/10 border-primary text-primary font-black'
            )}
          >
            <Terminal className="h-[12px] w-[12px] shrink-0" />
            <span className="truncate">DESIGN LAB CANVAS</span>
          </Link>
        </div>
      )}

      {/* Footer System Meta */}
      <div className="p-[8px] border-t border-border bg-neutral-950/40 text-[10px] space-y-[6px] shrink-0">
        <div className="flex flex-col gap-[4px]">
          <span className="text-[8px] text-muted-foreground uppercase font-black tracking-wider leading-none">Active Flags</span>
          <div className="flex gap-[4px] flex-wrap">
            {featureFlags.map((flag, idx) => (
              <Badge 
                key={idx} 
                variant={flag.active ? 'default' : 'outline'}
                className="text-[8px] h-[14px] py-0 px-[4px] font-mono uppercase font-bold shrink-0"
              >
                {flag.flag.replace('MOCK_', '')}
              </Badge>
            ))}
          </div>
        </div>

        <div className="pt-[4px] border-t border-border/40 flex justify-between text-[9px] text-muted-foreground font-mono leading-none">
          <span className="truncate">{brand.build}</span>
          <span>v3.0.0</span>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
