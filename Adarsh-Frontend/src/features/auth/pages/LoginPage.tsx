import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { User, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { authService } from '../services/authService'
import { identitySchema, passwordSchema, type IdentityFormValues, type PasswordFormValues } from '../schemas'
import { AuthCard } from '@/components/layout/auth/AuthCard'
import { AuthHeader } from '@/components/layout/auth/AuthHeader'
import { AuthFooter } from '@/components/layout/auth/AuthFooter'
import { WizardStepIndicator } from '@/components/layout/auth/WizardStepIndicator'
import { useToast } from '@/hooks/use-toast'

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()
  
  // Zustand Auth Store state
  const { identity } = useAuthStore()
  
  // Step indicator state: 'identity' | 'password'
  const [step, setStep] = useState<'identity' | 'password'>(identity ? 'password' : 'identity')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // React Hook Form for Step 1: Identity
  const {
    register: registerIdentity,
    handleSubmit: handleIdentitySubmit,
    formState: { errors: identityErrors }
  } = useForm<IdentityFormValues>({
    resolver: zodResolver(identitySchema),
    defaultValues: {
      identifier: identity || ''
    }
  })

  // React Hook Form for Step 2: Password
  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    formState: { errors: passwordErrors }
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema)
  })

  // Advance to Password step
  const onIdentitySubmit = async (data: IdentityFormValues) => {
    setLoading(true)
    setErrorMessage(null)
    try {
      await authService.verifyIdentity(data.identifier)
      setStep('password')
    } catch (error: any) {
      setErrorMessage(error?.message || 'Invalid identity details')
      toast({
        variant: 'destructive',
        title: 'Identity Verification Failed',
        description: error?.message || 'Check your entry and try again.'
      })
    } finally {
      setLoading(false)
    }
  }

  // Submit Password credentials
  const onPasswordSubmit = async (data: PasswordFormValues) => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const { user } = await authService.login(data.password)
      
      // Check if multi-step OTP authentication is flagged
      const authState = useAuthStore.getState()
      if (authState.authStatus === 'otp_required') {
        toast({
          title: 'OTP Code Generated',
          description: 'A 6-digit verification code has been sent to your registered email.'
        })
        navigate('/auth/otp')
      } else {
        toast({
          title: 'Authentication Successful',
          description: `Welcome back, ${user.username || 'User'}!`
        })
        // Redirect to dashboard
        navigate('/dashboard')
      }
    } catch (error: any) {
      setErrorMessage(error?.message || 'Invalid credentials')
      toast({
        variant: 'destructive',
        title: 'Authentication Failed',
        description: error?.message || 'Please check your password and try again.'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleBackToIdentity = () => {
    setStep('identity')
    setErrorMessage(null)
  }

  return (
    <AuthCard>
      <AuthHeader title="ADARSH ID PANEL" subtitle="Enterprise Identity Console" />
      
      {/* Step dots wizard */}
      <WizardStepIndicator currentStep={step} />

      {step === 'identity' ? (
        /* Flow 1: Identity Screen */
        <form onSubmit={handleIdentitySubmit(onIdentitySubmit)} className="space-y-4 font-saira">
          <div className="text-center mb-6">
            <h2 className="text-md font-bold text-foreground leading-normal tracking-wide">
              Enter your email, username, or phone
            </h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              We'll check if you have an account
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
                autoComplete="username"
                disabled={loading}
                placeholder="iamroshandamor@gmail.com"
                {...registerIdentity('identifier')}
                className="w-full h-9 pl-9 pr-3 bg-neutral-900 border border-border/80 rounded-xs text-caption focus:border-primary focus:ring-1 focus:ring-primary/45 outline-none transition-all text-foreground"
              />
            </div>
            {identityErrors.identifier && (
              <p className="text-[11px] text-destructive font-medium mt-0.5">
                {identityErrors.identifier.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-9 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/95 hover:to-indigo-600/95 active:scale-[0.99] text-primary-foreground font-bold rounded-xs text-caption flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed select-none mt-2"
          >
            {loading ? 'Verifying...' : 'Continue'}
          </button>
        </form>
      ) : (
        /* Flow 2: Password Screen */
        <form onSubmit={handlePasswordSubmit(onPasswordSubmit)} className="space-y-4 font-saira">
          <div className="text-center mb-6">
            <h2 className="text-md font-bold text-foreground leading-normal tracking-wide">
              Enter your password
            </h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Welcome back!
            </p>
          </div>

          {errorMessage && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive text-caption px-3 py-2 rounded-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* User info display card block */}
          <div className="p-3 bg-neutral-900/60 border border-border/40 rounded-xs flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <User className="h-4 w-4" />
            </div>
            <div className="flex flex-col text-left overflow-hidden">
              <span className="text-caption font-bold text-foreground leading-none">User</span>
              <span className="text-[11px] text-muted-foreground truncate mt-0.5">{identity}</span>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-caption text-muted-foreground font-semibold">
              Password
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-muted-foreground pointer-events-none">
                <Lock className="h-4 w-4" />
              </span>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                disabled={loading}
                placeholder="••••••••••••"
                {...registerPassword('password')}
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
            {passwordErrors.password && (
              <p className="text-[11px] text-destructive font-medium mt-0.5">
                {passwordErrors.password.message}
              </p>
            )}
            <div className="text-right mt-1">
              <button
                type="button"
                onClick={() => navigate('/auth/forgot-password')}
                className="text-[11px] text-primary hover:underline font-semibold"
              >
                Forgot password?
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full h-9 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/95 hover:to-indigo-600/95 active:scale-[0.99] text-primary-foreground font-bold rounded-xs text-caption flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed select-none"
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </button>

            <button
              type="button"
              onClick={handleBackToIdentity}
              disabled={loading}
              className="w-full h-9 bg-transparent hover:bg-neutral-800 border border-border/60 hover:border-border text-foreground font-bold rounded-xs text-caption flex items-center justify-center gap-1.5 transition-all select-none"
            >
              ← Back
            </button>
          </div>
        </form>
      )}

      <AuthFooter />
    </AuthCard>
  )
}
export default LoginPage
