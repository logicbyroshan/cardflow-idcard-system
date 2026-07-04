import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { KeyRound, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { authService } from '../services/authService'
import { resetPasswordSchema, type ResetPasswordFormValues } from '../schemas'
import { AuthCard } from '@/components/layout/auth/AuthCard'
import { AuthHeader } from '@/components/layout/auth/AuthHeader'
import { AuthFooter } from '@/components/layout/auth/AuthFooter'
import { useToast } from '@/hooks/use-toast'

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()
  
  // Zustand Auth Store state
  const { identity } = useAuthStore()

  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      identifier: identity || '',
      otp: '',
      new_password: '',
      confirm_password: ''
    }
  })

  const onSubmit = async (data: ResetPasswordFormValues) => {
    setLoading(true)
    setErrorMessage(null)
    try {
      await authService.resetPassword(data.otp, data.new_password)
      toast({
        title: 'Password Reset Successful',
        description: 'Your password has been updated. Please sign in with your new credentials.'
      })
      navigate('/auth/login')
    } catch (error: any) {
      setErrorMessage(error?.message || 'Password reset failed')
      toast({
        variant: 'destructive',
        title: 'Reset Failed',
        description: error?.message || 'Check your reset code and try again.'
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
            Enter new password
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Complete verification and update credentials
          </p>
        </div>

        {errorMessage && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive text-caption px-3 py-2 rounded-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Identity Hidden Bind */}
        <input type="hidden" {...register('identifier')} />

        {/* 6 Digit OTP input */}
        <div className="space-y-1">
          <label htmlFor="otp" className="text-caption text-muted-foreground font-semibold">
            6-Digit Verification Code
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-muted-foreground pointer-events-none">
              <KeyRound className="h-4 w-4" />
            </span>
            <input
              id="otp"
              type="text"
              maxLength={6}
              disabled={loading}
              placeholder="123456"
              {...register('otp')}
              className="w-full h-9 pl-9 pr-3 bg-neutral-900 border border-border/80 rounded-xs text-caption focus:border-primary focus:ring-1 focus:ring-primary/45 outline-none transition-all text-foreground tracking-[0.2em] font-bold"
            />
          </div>
          {errors.otp && (
            <p className="text-[11px] text-destructive font-medium mt-0.5">
              {errors.otp.message}
            </p>
          )}
        </div>

        {/* New Password input */}
        <div className="space-y-1">
          <label htmlFor="new_password" className="text-caption text-muted-foreground font-semibold">
            New Password
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-muted-foreground pointer-events-none">
              <Lock className="h-4 w-4" />
            </span>
            <input
              id="new_password"
              type={showPassword ? 'text' : 'password'}
              disabled={loading}
              placeholder="••••••••••••"
              {...register('new_password')}
              className="w-full h-9 pl-9 pr-10 bg-neutral-900 border border-border/80 rounded-xs text-caption focus:border-primary focus:ring-1 focus:ring-primary/45 outline-none transition-all text-foreground"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground focus:outline-none"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.new_password && (
            <p className="text-[11px] text-destructive font-medium mt-0.5">
              {errors.new_password.message}
            </p>
          )}
        </div>

        {/* Confirm Password input */}
        <div className="space-y-1">
          <label htmlFor="confirm_password" className="text-caption text-muted-foreground font-semibold">
            Confirm Password
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-muted-foreground pointer-events-none">
              <Lock className="h-4 w-4" />
            </span>
            <input
              id="confirm_password"
              type={showPassword ? 'text' : 'password'}
              disabled={loading}
              placeholder="••••••••••••"
              {...register('confirm_password')}
              className="w-full h-9 pl-9 pr-10 bg-neutral-900 border border-border/80 rounded-xs text-caption focus:border-primary focus:ring-1 focus:ring-primary/45 outline-none transition-all text-foreground"
            />
          </div>
          {errors.confirm_password && (
            <p className="text-[11px] text-destructive font-medium mt-0.5">
              {errors.confirm_password.message}
            </p>
          )}
        </div>

        <div className="space-y-2 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full h-9 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/95 hover:to-indigo-600/95 active:scale-[0.99] text-primary-foreground font-bold rounded-xs text-caption flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed select-none"
          >
            {loading ? 'Updating Password...' : 'Reset Password'}
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
export default ResetPasswordPage
