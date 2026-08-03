import React from 'react'
import { WidgetWrapper } from '../components/WidgetWrapper'
import { type WidgetLifecycleState } from '../types'
import { TrendingUp, RefreshCw, Activity } from 'lucide-react'

interface WorkflowTrendWidgetProps {
  state?: WidgetLifecycleState
  onRefresh?: () => void
}

export const WorkflowTrendWidget: React.FC<WorkflowTrendWidgetProps> = ({ state, onRefresh }) => {
  // Sparkline data coordinates
  const cardsProcessedData = 'M 0 35 L 15 28 L 30 42 L 45 15 L 60 22 L 75 8 L 90 12 L 105 5 L 120 18 L 135 20 L 150 10 L 165 28 L 180 8 L 195 12 L 210 25 L 225 10 L 240 5 L 255 18 L 270 20 L 285 6 L 300 2'
  const cardsProcessedFill = 'M 0 35 L 15 28 L 30 42 L 45 15 L 60 22 L 75 8 L 90 12 L 105 5 L 120 18 L 135 20 L 150 10 L 165 28 L 180 8 L 195 12 L 210 25 L 225 10 L 240 5 L 255 18 L 270 20 L 285 6 L 300 2 L 300 50 L 0 50 Z'

  const reprintsData = 'M 0 45 L 15 40 L 30 48 L 45 35 L 60 30 L 75 42 L 90 25 L 105 18 L 120 30 L 135 28 L 150 35 L 165 20 L 180 25 L 195 15 L 210 8 L 225 22 L 240 35 L 255 12 L 270 18 L 285 5 L 300 12'
  const reprintsFill = 'M 0 45 L 15 40 L 30 48 L 45 35 L 60 30 L 75 42 L 90 25 L 105 18 L 120 30 L 135 28 L 150 35 L 165 20 L 180 25 L 195 15 L 210 8 L 225 22 L 240 35 L 255 12 L 270 18 L 285 5 L 300 12 L 300 50 L 0 50 Z'

  const volumeData = 'M 0 25 L 15 35 L 30 20 L 45 42 L 60 15 L 75 30 L 90 8 L 105 28 L 120 12 L 135 32 L 150 14 L 165 22 L 180 5 L 195 25 L 210 10 L 225 35 L 240 18 L 255 30 L 270 12 L 285 45 L 300 8'
  const volumeFill = 'M 0 25 L 15 35 L 30 20 L 45 42 L 60 15 L 75 30 L 90 8 L 105 28 L 120 12 L 135 32 L 150 14 L 165 22 L 180 5 L 195 25 L 210 10 L 225 35 L 240 18 L 255 30 L 270 12 L 285 45 L 300 8 L 300 50 L 0 50 Z'

  return (
    <WidgetWrapper
      title="30-Day Workflow Trends"
      subtitle="Operational printing, reprints, and processing volume timeline indicators"
      initialState={state}
      onRefresh={onRefresh}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px] font-saira text-left w-full">
        {/* Cards Processed Sparkline */}
        <div className="p-[10px] bg-neutral-950/20 border border-border/40 rounded-xs flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="flex flex-col">
              <span className="text-[9px] text-muted-foreground uppercase font-black tracking-wider leading-none">
                Cards Processed (30 Days)
              </span>
              <span className="text-[16px] font-black text-foreground font-mono mt-[4px] leading-none">
                12,854
              </span>
            </div>
            <span className="text-[9px] font-bold text-emerald-400 flex items-center gap-[2px] bg-emerald-500/10 px-[4px] py-[1px] rounded-xs">
              <TrendingUp className="h-2.5 w-2.5" /> +12.4%
            </span>
          </div>
          
          <div className="h-[40px] w-full mt-[10px] overflow-hidden">
            <svg viewBox="0 0 300 50" width="100%" height="100%" preserveAspectRatio="none">
              <defs>
                <linearGradient id="gradient-cards" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={cardsProcessedFill} fill="url(#gradient-cards)" />
              <path d={cardsProcessedData} fill="none" stroke="#10b981" strokeWidth="1.5" />
            </svg>
          </div>

          <div className="flex justify-between text-[8px] text-muted-foreground font-mono mt-[6px] pt-[4px] border-t border-border/30">
            <span>AVG: 428/DAY</span>
            <span>PEAK: 840/DAY</span>
          </div>
        </div>

        {/* Reprints Sparkline */}
        <div className="p-[10px] bg-neutral-950/20 border border-border/40 rounded-xs flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="flex flex-col">
              <span className="text-[9px] text-muted-foreground uppercase font-black tracking-wider leading-none">
                Reprints Logged (30 Days)
              </span>
              <span className="text-[16px] font-black text-foreground font-mono mt-[4px] leading-none">
                314
              </span>
            </div>
            <span className="text-[9px] font-bold text-rose-400 flex items-center gap-[2px] bg-rose-500/10 px-[4px] py-[1px] rounded-xs">
              <RefreshCw className="h-2.5 w-2.5" /> -2.1%
            </span>
          </div>

          <div className="h-[40px] w-full mt-[10px] overflow-hidden">
            <svg viewBox="0 0 300 50" width="100%" height="100%" preserveAspectRatio="none">
              <defs>
                <linearGradient id="gradient-reprints" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={reprintsFill} fill="url(#gradient-reprints)" />
              <path d={reprintsData} fill="none" stroke="#f43f5e" strokeWidth="1.5" />
            </svg>
          </div>

          <div className="flex justify-between text-[8px] text-muted-foreground font-mono mt-[6px] pt-[4px] border-t border-border/30">
            <span>AVG: 10/DAY</span>
            <span>PEAK: 34/DAY</span>
          </div>
        </div>

        {/* Processing Volume Sparkline */}
        <div className="p-[10px] bg-neutral-950/20 border border-border/40 rounded-xs flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="flex flex-col">
              <span className="text-[9px] text-muted-foreground uppercase font-black tracking-wider leading-none">
                Processing Volume (Daily)
              </span>
              <span className="text-[16px] font-black text-foreground font-mono mt-[4px] leading-none">
                184,802
              </span>
            </div>
            <span className="text-[9px] font-bold text-blue-400 flex items-center gap-[2px] bg-blue-500/10 px-[4px] py-[1px] rounded-xs">
              <Activity className="h-2.5 w-2.5" /> +5.7%
            </span>
          </div>

          <div className="h-[40px] w-full mt-[10px] overflow-hidden">
            <svg viewBox="0 0 300 50" width="100%" height="100%" preserveAspectRatio="none">
              <defs>
                <linearGradient id="gradient-volume" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={volumeFill} fill="url(#gradient-volume)" />
              <path d={volumeData} fill="none" stroke="#3b82f6" strokeWidth="1.5" />
            </svg>
          </div>

          <div className="flex justify-between text-[8px] text-muted-foreground font-mono mt-[6px] pt-[4px] border-t border-border/30">
            <span>AVG: 6.1K/DAY</span>
            <span>PEAK: 12.8K/DAY</span>
          </div>
        </div>
      </div>
    </WidgetWrapper>
  )
}

export default WorkflowTrendWidget
