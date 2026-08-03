import React from 'react'
import { AdminDashboardLayout } from '../layouts/AdminDashboardLayout'

export const AdminDashboard: React.FC = () => {
  return (
    <div className="w-full h-full overflow-hidden bg-background">
      <AdminDashboardLayout />
    </div>
  )
}

export default AdminDashboard
