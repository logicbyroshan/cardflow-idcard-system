import React from 'react'
import { cn } from '@/utils/cn'

interface AuthLayoutProps {
  children: React.ReactNode
  className?: string
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children, className }) => {
  return (
    <div 
      className={cn(
        "min-h-screen w-screen bg-background text-foreground flex items-center justify-center p-4 relative overflow-hidden font-saira",
        className
      )}
    >
      {/* Background ambient accents if any (subtle) */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
      
      {/* Centered card node */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  )
}

export default AuthLayout
