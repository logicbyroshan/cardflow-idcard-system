import React from 'react'
import { useFormContext } from 'react-hook-form'
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form'
import { Checkbox } from '@/components/ui/checkbox'

interface FormCheckboxProps {
  name: string
  label: string
  description?: string
  wrapperClassName?: string
}

export const FormCheckbox: React.FC<FormCheckboxProps> = ({
  name,
  label,
  description,
  wrapperClassName,
}) => {
  const { control } = useFormContext()

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-panel ${wrapperClassName}`}>
          <FormControl>
            <Checkbox
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          </FormControl>
          <div className="space-y-1 leading-none">
            <FormLabel className="text-body font-medium">{label}</FormLabel>
            {description && <FormDescription className="text-caption mt-1">{description}</FormDescription>}
            <FormMessage />
          </div>
        </FormItem>
      )}
    />
  )
}

export default FormCheckbox
