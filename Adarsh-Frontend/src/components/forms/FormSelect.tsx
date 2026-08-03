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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface SelectOption {
  label: string
  value: string
}

interface FormSelectProps {
  name: string
  label?: string
  description?: string
  placeholder?: string
  options: SelectOption[]
  wrapperClassName?: string
}

export const FormSelect: React.FC<FormSelectProps> = ({
  name,
  label,
  description,
  placeholder = "Select an option",
  options,
  wrapperClassName,
}) => {
  const { control } = useFormContext()

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={wrapperClassName}>
          {label && <FormLabel>{label}</FormLabel>}
          <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
            <FormControl>
              <SelectTrigger className="w-full bg-background border-border">
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent className="bg-panel border border-border">
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} className="focus:bg-secondary">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export default FormSelect
