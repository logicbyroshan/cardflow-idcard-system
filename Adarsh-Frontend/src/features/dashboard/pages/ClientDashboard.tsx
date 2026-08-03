import React from 'react'
import { ClientDashboardLayout } from '../layouts/ClientDashboardLayout'

export const ClientDashboard: React.FC = () => {
  return (
    <div className="w-full min-h-screen p-4 lg:p-6 bg-background">
      <ClientDashboardLayout />
    </div>
  )
}

export default ClientDashboard
