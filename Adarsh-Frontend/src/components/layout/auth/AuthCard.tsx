import React from 'react'
import { cn } from '@/utils/cn'

interface AuthCardProps {
  children: React.ReactNode
  className?: string
}

export const AuthCard: React.FC<AuthCardProps> = ({ children, className }) => {
  return (
    <div 
      className={cn(
        "w-[640px] max-w-[640px] min-w-[640px] bg-panel border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden font-saira",
        className
      )}
    >
      {children}
    </div>
  )
}

export default AuthCard
