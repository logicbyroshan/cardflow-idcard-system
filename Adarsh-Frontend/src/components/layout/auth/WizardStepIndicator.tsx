import React from 'react'
import { cn } from '@/utils/cn'

export type AuthStep = 'identity' | 'password' | 'otp' | 'success'

interface WizardStepIndicatorProps {
  currentStep: AuthStep
}

export const WizardStepIndicator: React.FC<WizardStepIndicatorProps> = ({ currentStep }) => {
  const steps: { id: AuthStep; label: string }[] = [
    { id: 'identity', label: 'IDENTITY' },
    { id: 'password', label: 'PASSWORD' },
    { id: 'otp', label: 'OTP CODE' },
    { id: 'success', label: 'SUCCESS' }
  ]

  const getStepState = (stepId: AuthStep) => {
    const stepOrder: AuthStep[] = ['identity', 'password', 'otp', 'success']
    const currentIndex = stepOrder.indexOf(currentStep)
    const thisIndex = stepOrder.indexOf(stepId)

    if (thisIndex < currentIndex) return 'completed'
    if (thisIndex === currentIndex) return 'current'
    return 'upcoming'
  }

  return (
    <div className="flex items-center justify-between w-full border-b border-border bg-neutral-950/20 px-6 py-2 select-none font-saira">
      {steps.map((step, idx) => {
        const state = getStepState(step.id)
        return (
          <React.Fragment key={step.id}>
            <div className="flex items-center gap-2">
              {/* Step indicator dot/number */}
              <div 
                className={cn(
                  "h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-bold border transition-colors",
                  state === 'completed' && "bg-primary/20 border-primary text-primary",
                  state === 'current' && "bg-primary text-primary-foreground border-primary",
                  state === 'upcoming' && "bg-neutral-900 border-border text-muted-foreground"
                )}
              >
                {state === 'completed' ? '✓' : idx + 1}
              </div>
              <span 
                className={cn(
                  "text-[10px] font-bold tracking-widest transition-colors",
                  state === 'current' ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className="h-[1px] flex-1 mx-3 bg-border" />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default WizardStepIndicator
