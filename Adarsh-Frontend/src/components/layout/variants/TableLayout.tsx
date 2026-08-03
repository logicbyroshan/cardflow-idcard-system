import React from 'react'

interface LayoutProps {
  children: React.ReactNode
  toolbarSlot?: React.ReactNode
  paginationSlot?: React.ReactNode
}

export const TableLayout: React.FC<LayoutProps> = ({ 
  children, 
  toolbarSlot,
  paginationSlot 
}) => {
  return (
    <div className="flex flex-col h-full w-full bg-panel border border-border rounded-sm overflow-hidden">
      {/* Table Toolbar */}
      {toolbarSlot && (
        <div className="p-3 border-b border-border bg-neutral-900/20">
          {toolbarSlot}
        </div>
      )}

      {/* Grid Container */}
      <div className="flex-1 overflow-auto bg-background/50">
        {children}
      </div>

      {/* Pagination Footer */}
      {paginationSlot && (
        <div className="p-3 border-t border-border bg-neutral-900/20">
          {paginationSlot}
        </div>
      )}
    </div>
  )
}

export default TableLayout
