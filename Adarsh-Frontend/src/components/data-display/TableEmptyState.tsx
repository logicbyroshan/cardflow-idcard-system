import React from 'react'
import { Inbox } from 'lucide-react'

interface TableEmptyStateProps {
  title?: string
  description?: string
}

export const TableEmptyState: React.FC<TableEmptyStateProps> = ({
  title = "No records found",
  description = "There are no entries matching your current view or filter criteria.",
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-panel border border-border border-t-0 rounded-none min-h-[200px]">
      <Inbox className="h-10 w-10 text-muted mb-3" />
      <h3 className="text-subheading text-foreground mb-1">{title}</h3>
      <p className="text-caption max-w-sm">{description}</p>
    </div>
  )
}

export default TableEmptyState
