import React, { useState } from 'react'
import { RotateCw, AlertTriangle, Inbox, RefreshCcw } from 'lucide-react'
import { cn } from '@/utils/cn'
import { type WidgetLifecycleState } from '../types'

interface WidgetWrapperProps {
  title: string
  subtitle?: string
  initialState?: WidgetLifecycleState
  children: React.ReactNode
  onRefresh?: () => void
  className?: string
}

export const WidgetWrapper: React.FC<WidgetWrapperProps> = ({
  title,
  subtitle,
  initialState = 'success',
  children,
  onRefresh,
  className
}) => {
  const [state, setState] = useState<WidgetLifecycleState>(initialState)

  return (
    <div 
      className={cn(
        "bg-neutral-900/40 border border-border/60 hover:border-border/90 rounded-xs transition-all overflow-hidden flex flex-col font-saira shadow-md backdrop-blur-md",
        className
      )}
    >
      {/* Widget Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-neutral-950/20 select-none">
        <div className="flex flex-col text-left">
          <span className="text-[12px] font-extrabold text-foreground tracking-wider uppercase leading-none">
            {title}
          </span>
          {subtitle && (
            <span className="text-[10px] text-muted-foreground mt-0.5 leading-none">
              {subtitle}
            </span>
          )}
        </div>

        {/* LifeCycle Controls & Actions */}
        <div className="flex items-center gap-1.5">
          {/* Debug State Selector */}
          <div className="flex items-center bg-neutral-950/40 border border-border/40 rounded-xs p-0.5 text-[8px] font-bold text-muted-foreground mr-1">
            <button
              type="button"
              onClick={() => setState('loading')}
              className={cn(
                "px-1 py-0.5 rounded-xs transition-colors hover:text-foreground",
                state === 'loading' && "bg-amber-500/20 text-amber-400 font-black"
              )}
              title="Toggle Loading State"
            >
              LD
            </button>
            <button
              type="button"
              onClick={() => setState('empty')}
              className={cn(
                "px-1 py-0.5 rounded-xs transition-colors hover:text-foreground",
                state === 'empty' && "bg-blue-500/20 text-blue-400 font-black"
              )}
              title="Toggle Empty State"
            >
              MT
            </button>
            <button
              type="button"
              onClick={() => setState('error')}
              className={cn(
                "px-1 py-0.5 rounded-xs transition-colors hover:text-foreground",
                state === 'error' && "bg-destructive/20 text-destructive font-black"
              )}
              title="Toggle Error State"
            >
              ERR
            </button>
            <button
              type="button"
              onClick={() => setState('success')}
              className={cn(
                "px-1 py-0.5 rounded-xs transition-colors hover:text-foreground",
                state === 'success' && "bg-emerald-500/20 text-emerald-400 font-black"
              )}
              title="Toggle Success State"
            >
              OK
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (onRefresh) onRefresh()
              setState('loading')
              setTimeout(() => setState('success'), 800)
            }}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 hover:bg-neutral-800/60 rounded-xs"
            title="Refresh Widget Data"
          >
            <RotateCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Widget Body Container */}
      <div className="p-2.5 flex-1 min-h-[100px] flex flex-col justify-center relative">
        {state === 'loading' && (
          <div className="flex flex-col items-center justify-center space-y-2 py-4 animate-pulse">
            <div className="relative">
              <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            </div>
            <span className="text-[11px] text-muted-foreground tracking-wide font-medium">
              Synchronizing widget logs...
            </span>
          </div>
        )}

        {state === 'empty' && (
          <div className="flex flex-col items-center justify-center text-center py-4 space-y-1.5 select-none">
            <div className="h-8 w-8 rounded-full bg-neutral-950/40 flex items-center justify-center border border-border/40 text-muted-foreground">
              <Inbox className="h-4 w-4" />
            </div>
            <div className="text-[11px] font-bold text-foreground tracking-wide uppercase">No Records Found</div>
            <p className="text-[10px] text-muted-foreground max-w-[200px]">
              This database view is currently empty.
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center justify-center text-center py-4 space-y-2 select-none">
            <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center border border-destructive/20 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="space-y-0.5">
              <div className="text-[11px] font-bold text-foreground tracking-wide uppercase">Connection Timeout</div>
              <p className="text-[10px] text-muted-foreground max-w-[200px]">
                Failed to execute database stream.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setState('loading')
                setTimeout(() => setState('success'), 600)
              }}
              className="h-6 px-2.5 bg-neutral-800 hover:bg-neutral-700 active:scale-[0.98] border border-border/80 text-[10px] font-bold rounded-xs text-foreground flex items-center gap-1 transition-all"
            >
              <RefreshCcw className="h-2.5 w-2.5" /> Retry Fetch
            </button>
          </div>
        )}

        {state === 'success' && (
          <div className="w-full animate-fade-in">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
export default WidgetWrapper
