import React from 'react'
import { Loader2 } from 'lucide-react'

export const PageLoader: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] w-full p-8">
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
      <span className="text-caption animate-pulse">Loading system workspace...</span>
    </div>
  )
}

export default PageLoader
