import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../auth/store/authStore'

export const DashboardResolver: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  useEffect(() => {
    if (!user) {
      navigate('/auth/login', { replace: true })
      return
    }

    const role = user.role.toLowerCase()
    if (role === 'admin' || role === 'pro_user') {
      navigate('/dashboard/admin', { replace: true })
    } else {
      navigate('/dashboard/client', { replace: true })
    }
  }, [user, navigate])

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background font-saira animate-pulse">
      <div className="flex flex-col items-center gap-2">
        <div className="h-8 w-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
        <span className="text-caption text-muted-foreground font-semibold">
          Resolving dashboard workspace...
        </span>
      </div>
    </div>
  )
}

export default DashboardResolver
