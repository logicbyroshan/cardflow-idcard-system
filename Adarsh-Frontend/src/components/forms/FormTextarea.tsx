import React from 'react'
import { FormField } from './FormField'
import { Textarea } from '@/components/ui/textarea'

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  name: string
  label?: string
  description?: string
  wrapperClassName?: string
}

export const FormTextarea: React.FC<FormTextareaProps> = ({
  name,
  label,
  description,
  wrapperClassName,
  ...props
}) => {
  return (
    <FormField name={name} label={label} description={description} className={wrapperClassName}>
      <Textarea {...props} />
    </FormField>
  )
}

export default FormTextarea
