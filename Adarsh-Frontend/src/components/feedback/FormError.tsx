import React from 'react'
import { AlertCircle } from 'lucide-react'

interface FormErrorProps {
  message?: string
}

export const FormError: React.FC<FormErrorProps> = ({ message }) => {
  if (!message) return null

  return (
    <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 rounded-md text-caption">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export default FormError
