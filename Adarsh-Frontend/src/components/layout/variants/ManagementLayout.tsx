import React from 'react'

interface ManagementLayoutProps {
  listPanel: React.ReactNode
  detailPanel: React.ReactNode
}

export const ManagementLayout: React.FC<ManagementLayoutProps> = ({ 
  listPanel, 
  detailPanel 
}) => {
  return (
    <div className="flex flex-col lg:flex-row h-full w-full bg-panel border border-border rounded-sm overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-border">
      {/* Left List Pane */}
      <div className="w-full lg:w-96 shrink-0 flex flex-col h-full bg-neutral-950/10">
        {listPanel}
      </div>

      {/* Right Details/Editor Pane */}
      <div className="flex-1 flex flex-col h-full bg-background/20 overflow-y-auto">
        {detailPanel}
      </div>
    </div>
  )
}

export default ManagementLayout
