import React from 'react'
import { Skeleton } from '@/components/ui/skeleton'

interface TableLoaderProps {
  rows?: number
  cols?: number
}

export const TableLoader: React.FC<TableLoaderProps> = ({ rows = 5, cols = 4 }) => {
  return (
    <div className="w-full space-y-2 border border-border bg-panel p-4 rounded-none">
      {/* Header Skeleton */}
      <div className="flex gap-4 pb-2 border-b border-border">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-6 flex-1 bg-neutral-800" />
        ))}
      </div>
      
      {/* Rows Skeletons */}
      <div className="space-y-3 pt-2">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={`r-${r}`} className="flex gap-4 items-center">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={`r-${r}-c-${c}`} className="h-5 flex-1 bg-neutral-800/60" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default TableLoader
