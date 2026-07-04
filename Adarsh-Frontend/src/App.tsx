import React from 'react'
import { RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/app/providers/AppProviders'
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary'
import { router } from '@/app/router/AppRouter'
import { initializeApp } from '@/app/initialization/initializeApp'

import { BrandConfig } from '@/assets/branding/BrandConfig'

function App() {
  const [isInitialized, setIsInitialized] = React.useState(false)

  React.useEffect(() => {
    // Run core system bootstrapping
    initializeApp().then(() => {
      setIsInitialized(true)
    })
  }, [])

  if (!isInitialized) {
    // Return early loading indicator during workspace boot
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3 select-none">
          <BrandConfig.LoadingLogo className="h-16 w-16 text-primary" />
          <span className="text-caption uppercase tracking-wider font-bold animate-pulse">Initializing {BrandConfig.name}...</span>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  )
}

export default App
