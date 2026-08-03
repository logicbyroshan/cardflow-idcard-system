import React from 'react'
import { BrandConfig } from '@/assets/branding/BrandConfig'

export const AuthFooter: React.FC = () => {
  return (
    <div className="p-4 border-t border-border bg-neutral-950/20 text-caption font-saira flex items-center justify-between text-muted-foreground select-none">
      <div className="flex gap-3">
        <a href="#support" className="hover:text-foreground hover:underline">Support Hotline</a>
        <span>•</span>
        <a href="#status" className="hover:text-foreground hover:underline">System Status</a>
      </div>
      <div className="font-mono text-[9px]">
        {BrandConfig.build} | {BrandConfig.version}
      </div>
    </div>
  )
}

export default AuthFooter
