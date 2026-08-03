import React from 'react'

interface LayoutProps {
  children: React.ReactNode
}

export const DashboardLayout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-full h-full pb-6">
      {children}
    </div>
  )
}

export default DashboardLayout
