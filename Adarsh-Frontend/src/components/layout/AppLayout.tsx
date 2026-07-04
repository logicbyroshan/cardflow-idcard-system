import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import ContentContainer from './ContentContainer'

export const AppLayout: React.FC = () => {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Sidebar - Always visible, never collapses */}
      <Sidebar />

      {/* Main View Area */}
      <div className="flex flex-col flex-1 h-full overflow-hidden">
        {/* Topbar */}
        <Topbar />

        {/* Content Container (holds sub routes) */}
        <ContentContainer>
          <Outlet />
        </ContentContainer>
      </div>
    </div>
  )
}

export default AppLayout
