import React from 'react'
import { useFormContext } from 'react-hook-form'
import {
  FormField as ShadcnFormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form'

export interface FormFieldProps {
  name: string
  label?: string
  description?: string
  children: React.ReactElement
  className?: string
}

export const FormField: React.FC<FormFieldProps> = ({
  name,
  label,
  description,
  children,
  className,
}) => {
  const { control } = useFormContext()

  return (
    <ShadcnFormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {label && <FormLabel>{label}</FormLabel>}
          <FormControl>
            {React.cloneElement(children, {
              ...field,
              value: field.value ?? '',
              onChange: (e: any) => {
                // Support both React change event and direct value updates (like switch/checkbox)
                const val = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e
                field.onChange(val)
              }
            })}
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export default FormField
