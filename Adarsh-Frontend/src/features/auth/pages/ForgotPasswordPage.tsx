import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { User, AlertCircle } from 'lucide-react'
import { authService } from '../services/authService'
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '../schemas'
import { AuthCard } from '@/components/layout/auth/AuthCard'
import { AuthHeader } from '@/components/layout/auth/AuthHeader'
import { AuthFooter } from '@/components/layout/auth/AuthFooter'
import { useToast } from '@/hooks/use-toast'

export const ForgotPasswordPage: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()
  
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema)
  })

  const onSubmit = async (data: ForgotPasswordFormValues) => {
    setLoading(true)
    setErrorMessage(null)
    try {
      await authService.forgotPassword(data.identifier)
      toast({
        title: 'Verification Code Sent',
        description: 'A 6-digit OTP reset code has been dispatched to your email address.'
      })
      navigate('/auth/reset-password')
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to send verification code')
      toast({
        variant: 'destructive',
        title: 'Request Failed',
        description: error?.message || 'We could not dispatch a verification code at this time.'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard>
      <AuthHeader title="RESET PASSWORD" />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 font-saira">
        <div className="text-center mb-6">
          <h2 className="text-md font-bold text-foreground leading-normal tracking-wide">
            Reset password
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Enter your email, username, or phone to receive a code
          </p>
        </div>

        {errorMessage && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive text-caption px-3 py-2 rounded-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="identifier" className="text-caption text-muted-foreground font-semibold">
            Email, Username, or Phone
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-muted-foreground pointer-events-none">
              <User className="h-4 w-4" />
            </span>
            <input
              id="identifier"
              type="text"
              disabled={loading}
              placeholder="iamroshandamor@gmail.com"
              {...register('identifier')}
              className="w-full h-9 pl-9 pr-3 bg-neutral-900 border border-border/80 rounded-xs text-caption focus:border-primary focus:ring-1 focus:ring-primary/45 outline-none transition-all text-foreground"
            />
          </div>
          {errors.identifier && (
            <p className="text-[11px] text-destructive font-medium mt-0.5">
              {errors.identifier.message}
            </p>
          )}
        </div>

        <div className="space-y-2 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full h-9 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/95 hover:to-indigo-600/95 active:scale-[0.99] text-primary-foreground font-bold rounded-xs text-caption flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed select-none"
          >
            {loading ? 'Sending OTP Code...' : 'Request Reset OTP'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/auth/login')}
            disabled={loading}
            className="w-full h-9 bg-transparent hover:bg-neutral-800 border border-border/60 hover:border-border text-foreground font-bold rounded-xs text-caption flex items-center justify-center gap-1.5 transition-all select-none"
          >
            ← Back to Login
          </button>
        </div>
      </form>

      <AuthFooter />
    </AuthCard>
  )
}
export default ForgotPasswordPage
