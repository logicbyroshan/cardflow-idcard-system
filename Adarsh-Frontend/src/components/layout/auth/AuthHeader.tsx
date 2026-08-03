import React from 'react'
import { BrandConfig } from '@/assets/branding/BrandConfig'

interface AuthHeaderProps {
  title: string
  subtitle?: string
}

export const AuthHeader: React.FC<AuthHeaderProps> = ({ title, subtitle }) => {
  return (
    <div className="flex flex-col items-center justify-center p-6 border-b border-border bg-neutral-900/10 font-saira">
      {/* Brand logo image component */}
      <BrandConfig.AuthLogo className="h-10 w-auto mb-2 text-foreground" />
      <div className="text-center mt-2 space-y-1">
        <h2 className="text-subheading font-extrabold text-foreground tracking-wider uppercase">
          {title}
        </h2>
        {subtitle && (
          <p className="text-caption text-muted-foreground leading-none">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}

export default AuthHeader
