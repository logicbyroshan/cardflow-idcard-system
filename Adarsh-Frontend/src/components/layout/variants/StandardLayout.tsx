import React from 'react'

interface LayoutProps {
  children: React.ReactNode
}

export const StandardLayout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="flex flex-col gap-4 w-full h-full max-w-7xl mx-auto py-2">
      {children}
    </div>
  )
}

export default StandardLayout
