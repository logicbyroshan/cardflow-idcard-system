import React from 'react'
import { FormField } from './FormField'
import { Input } from '@/components/ui/input'

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  name: string
  label?: string
  description?: string
  wrapperClassName?: string
}

export const FormInput: React.FC<FormInputProps> = ({
  name,
  label,
  description,
  wrapperClassName,
  ...props
}) => {
  return (
    <FormField name={name} label={label} description={description} className={wrapperClassName}>
      <Input {...props} />
    </FormField>
  )
}

export default FormInput
