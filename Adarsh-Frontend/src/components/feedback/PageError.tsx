import React from 'react'
import { AlertCircle, ArrowLeft, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PageErrorProps {
  title?: string
  message?: string
  onRetry?: () => void
  onBack?: () => void
}

export const PageError: React.FC<PageErrorProps> = ({
  title = "Page Error",
  message = "Failed to load page content. Please check your connection or try again.",
  onRetry,
  onBack,
}) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center bg-background border border-border rounded-card">
      <div className="bg-destructive/10 p-3 rounded-md mb-4 border border-destructive/20">
        <AlertCircle className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="text-subheading text-foreground mb-2">{title}</h2>
      <p className="text-caption max-w-sm mb-6">{message}</p>
      
      <div className="flex gap-4">
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>
        )}
        {onRetry && (
          <Button variant="default" size="sm" onClick={onRetry} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Try Again
          </Button>
        )}
      </div>
    </div>
  )
}

export default PageError
