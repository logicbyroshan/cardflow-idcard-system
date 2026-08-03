import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/toaster'
import { BrandProvider } from '@/components/brand/BrandProvider'

// Initialize the global query client with optimized ERP caching policies
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // Prevent redundant background fetches in dense tables
      retry: 1, // Minimize network congestion on cluster nodes
      staleTime: 5 * 60 * 1000, // 5 minutes stale
    },
  },
})

interface AppProvidersProps {
  children: React.ReactNode
}

export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrandProvider>
        {children}
        <Toaster />
      </BrandProvider>
    </QueryClientProvider>
  )
}

export default AppProviders
