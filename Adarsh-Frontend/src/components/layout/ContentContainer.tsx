import React from 'react'
import { cn } from '@/utils/cn'

interface ContentContainerProps {
  children: React.ReactNode
  className?: string
}

export const ContentContainer: React.FC<ContentContainerProps> = ({
  children,
  className,
}) => {
  return (
    <main 
      className={cn('flex-1 p-0 overflow-hidden min-w-[720px] bg-background', className)}
    >
      {children}
    </main>
  )
}

export default ContentContainer
