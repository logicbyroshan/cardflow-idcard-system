import React from 'react'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface PageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: string[]
  statusTags?: { label: string; variant?: 'default' | 'secondary' | 'destructive' | 'outline' }[]
  actionSlot?: React.ReactNode
  filtersSlot?: React.ReactNode
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  breadcrumbs = [],
  statusTags = [],
  actionSlot,
  filtersSlot,
}) => {
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-3 mb-4 select-none">
      {/* Breadcrumb Path */}
      {breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-1 text-[11px] text-muted-foreground uppercase tracking-wider">
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
              <span className={idx === breadcrumbs.length - 1 ? 'text-primary font-semibold' : ''}>
                {crumb}
              </span>
            </React.Fragment>
          ))}
        </nav>
      )}

      {/* Title + Subtitle + Actions Row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-heading font-bold text-foreground leading-tight tracking-tight uppercase">
              {title}
            </h1>
            {statusTags.map((tag, idx) => (
              <Badge 
                key={idx} 
                variant={tag.variant || 'default'} 
                className="text-[10px] py-0 px-1.5 h-4 uppercase tracking-widest font-bold font-mono"
              >
                {tag.label}
              </Badge>
            ))}
          </div>
          {description && <p className="text-caption text-muted">{description}</p>}
        </div>

        {/* Action Buttons */}
        {actionSlot && (
          <div className="flex items-center gap-2 shrink-0 md:self-end">
            {actionSlot}
          </div>
        )}
      </div>

      {/* Grid Filters and sub-actions */}
      {filtersSlot && (
        <div className="mt-2 pt-2 border-t border-border/40">
          {filtersSlot}
        </div>
      )}
    </div>
  )
}

export default PageHeader
