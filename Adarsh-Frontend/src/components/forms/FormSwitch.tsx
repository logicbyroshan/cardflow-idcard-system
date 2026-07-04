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
import { Switch } from '@/components/ui/switch'

interface FormSwitchProps {
  name: string
  label: string
  description?: string
  wrapperClassName?: string
}

export const FormSwitch: React.FC<FormSwitchProps> = ({
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
        <FormItem className={`flex flex-row items-center justify-between rounded-md border border-border p-4 bg-panel ${wrapperClassName}`}>
          <div className="space-y-0.5">
            <FormLabel className="text-body font-medium">{label}</FormLabel>
            {description && <FormDescription className="text-caption mt-1">{description}</FormDescription>}
          </div>
          <FormControl>
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export default FormSwitch
