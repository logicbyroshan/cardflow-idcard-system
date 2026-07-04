import React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface QuickActionItem {
  icon: React.ComponentType<{ className?: string }>
  label: string
  counter?: number
  permission?: string
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger'
}

interface QuickActionListProps {
  actions: QuickActionItem[]
  userPermissions?: string[] // Optional actual permissions checks
  className?: string
}

export const QuickActionList: React.FC<QuickActionListProps> = ({
  actions,
  userPermissions = [],
  className
}) => {
  // Check permission helper
  const hasPermission = (perm?: string) => {
    if (!perm) return true
    return userPermissions.includes(perm)
  }

  // Filter actions based on permission settings
  const visibleActions = actions.filter((action) => hasPermission(action.permission))

  return (
    <div className={cn("flex flex-col space-y-[4px] font-saira", className)}>
      {visibleActions.map((action, idx) => {
        const Icon = action.icon
        return (
          <button
            key={idx}
            type="button"
            onClick={action.onClick}
            className="flex items-center justify-between w-full h-[32px] px-[8px] bg-neutral-900/35 hover:bg-neutral-800/50 border border-border/40 hover:border-border/80 rounded-xs transition-all active:scale-[0.99] select-none text-left"
          >
            <div className="flex items-center gap-[8px]">
              {/* Icon Container */}
              <div 
                className={cn(
                  "p-[2px] rounded-xs flex items-center justify-center border",
                  action.variant === 'danger'
                    ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                    : action.variant === 'primary'
                    ? "bg-primary/10 border-primary/20 text-primary"
                    : "bg-neutral-800 border-border/80 text-muted-foreground"
                )}
              >
                <Icon className="h-[12px] w-[12px]" />
              </div>

              {/* Label */}
              <span className="text-[11px] font-bold text-foreground tracking-wide">
                {action.label}
              </span>
            </div>

            <div className="flex items-center gap-[6px]">
              {/* Counter Badge */}
              {action.counter !== undefined && (
                <span className="h-[18px] px-[4px] bg-neutral-950 text-muted-foreground border border-border/40 text-[8px] font-black rounded-xs flex items-center justify-center select-none min-w-[16px]">
                  {action.counter}
                </span>
              )}
              <ChevronRight className="h-[12px] w-[12px] text-muted-foreground/60" />
            </div>
          </button>
        )
      })}
    </div>
  )
}
export default QuickActionList
