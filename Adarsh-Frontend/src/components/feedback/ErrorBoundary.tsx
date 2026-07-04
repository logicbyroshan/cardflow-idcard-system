import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children?: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in boundary:', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  public render() {
    if (this.state.hasError) {
      if (this.fallback) {
        return this.fallback
      }

      return (
        <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center border border-border bg-panel rounded-card">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-heading text-destructive mb-2">Something went wrong</h2>
          <p className="text-caption max-w-md mb-6">
            An unexpected error occurred in the application: {this.state.error?.message || 'Unknown Error'}
          </p>
          <Button variant="outline" size="sm" onClick={this.handleReset} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reload Page
          </Button>
        </div>
      )
    }

    return this.props.children
  }

  // Support fallback as either prop or method parameter
  private get fallback(): ReactNode {
    return this.props.fallback || null
  }
}
export default ErrorBoundary
