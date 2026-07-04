import React from 'react'
import { cn } from '@/utils/cn'

export type WorkflowStatusKey =
  | 'pending'
  | 'verified'
  | 'approved'
  | 'downloaded'
  | 'reprint'
  | 'total'

export interface WorkflowStatusItem {
  key: WorkflowStatusKey
  label: string
  count: number
  color: string
}

interface WorkflowStripProps {
  counts?: Partial<Record<WorkflowStatusKey, number>>
  className?: string
}

export const WorkflowStrip: React.FC<WorkflowStripProps> = ({ counts = {}, className }) => {
  const statusItems: WorkflowStatusItem[] = [
    {
      key: 'pending',
      label: 'Pending',
      count: counts.pending ?? 142,
      color: 'text-amber-500'
    },
    {
      key: 'verified',
      label: 'Verified',
      count: counts.verified ?? 68,
      color: 'text-cyan-400'
    },
    {
      key: 'approved',
      label: 'Approved',
      count: counts.approved ?? 512,
      color: 'text-emerald-400'
    },
    {
      key: 'downloaded',
      label: 'Downloaded',
      count: counts.downloaded ?? 2901,
      color: 'text-blue-400'
    },
    {
      key: 'reprint',
      label: 'Reprint',
      count: counts.reprint ?? 12,
      color: 'text-rose-500'
    },
    {
      key: 'total',
      label: 'Total Cards',
      count: counts.total ?? 3732,
      color: 'text-foreground font-black'
    }
  ]

  return (
    <div 
      className={cn(
        "w-full border border-border bg-panel grid grid-cols-3 md:grid-cols-6 divide-x divide-y md:divide-y-0 divide-border select-none font-saira",
        className
      )}
    >
      {statusItems.map((item) => (
        <div
          key={item.key}
          className="px-[12px] py-[8px] flex flex-col justify-center items-start hover:bg-neutral-800/10 transition-colors"
        >
          <span className="text-[9px] text-muted-foreground uppercase font-black tracking-wider leading-none">
            {item.label}
          </span>
          <span className={cn("text-[18px] font-black font-mono mt-[6px] leading-none", item.color)}>
            {item.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}

export default WorkflowStrip
