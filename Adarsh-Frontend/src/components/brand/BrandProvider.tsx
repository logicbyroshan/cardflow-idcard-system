import React, { createContext, useContext } from 'react'
import { BrandConfig } from '@/assets/branding/BrandConfig'

type BrandContextType = typeof BrandConfig

const BrandContext = createContext<BrandContextType | null>(null)

export const BrandProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <BrandContext.Provider value={BrandConfig}>
      {children}
    </BrandContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useBrand = () => {
  const context = useContext(BrandContext)
  if (!context) {
    throw new Error('useBrand must be used within a BrandProvider')
  }
  return context
}
