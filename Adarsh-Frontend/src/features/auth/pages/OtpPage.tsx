import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { authService } from '../services/authService'
import { OtpInput } from '../components/OtpInput'
import { AuthCard } from '@/components/layout/auth/AuthCard'
import { AuthHeader } from '@/components/layout/auth/AuthHeader'
import { AuthFooter } from '@/components/layout/auth/AuthFooter'
import { WizardStepIndicator } from '@/components/layout/auth/WizardStepIndicator'
import { useToast } from '@/hooks/use-toast'

export const OtpPage: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()
  
  // Zustand Auth Store state
  const { pendingAuth, clearSession } = useAuthStore()

  const [otpValue, setOtpValue] = useState('')
  const [timer, setTimer] = useState(60)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Redirect to login if there is no pending authentication context
  useEffect(() => {
    if (!pendingAuth) {
      toast({
        variant: 'destructive',
        title: 'Authentication Session Missing',
        description: 'Please enter your username and password first.'
      })
      navigate('/auth/login')
    }
  }, [pendingAuth, navigate, toast])

  // Countdown timer effect
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => (prev > 0 ? prev - 1 : 0))
      }, 1000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [timer])

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otpValue.length !== 6) {
      setErrorMessage('Verification code must be exactly 6 digits')
      return
    }

    if (!pendingAuth) return

    setLoading(true)
    setErrorMessage(null)

    try {
      const user = await authService.verifyOtp(otpValue, pendingAuth.user, pendingAuth.tokens)
      toast({
        title: 'OTP Verification Successful',
        description: `Welcome back, ${user.username || 'User'}!`
      })
      navigate('/dashboard')
    } catch (error: any) {
      setErrorMessage(error?.message || 'Invalid verification code')
      toast({
        variant: 'destructive',
        title: 'Verification Failed',
        description: error?.message || 'OTP verification code is incorrect or has expired.'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleResendCode = async () => {
    if (timer > 0 || !pendingAuth) return
    
    setLoading(true)
    setErrorMessage(null)
    try {
      await axiosInstanceForgotPassword()
      setTimer(60)
      setOtpValue('')
      toast({
        title: 'Verification Code Sent',
        description: 'A new 6-digit OTP code has been dispatched to your email address.'
      })
    } catch (error: any) {
      setErrorMessage(error?.message || 'Failed to resend code')
    } finally {
      setLoading(false)
    }
  }

  // Wrapper for background forgot-password request
  const axiosInstanceForgotPassword = async () => {
    if (!pendingAuth) return
    await authService.forgotPassword(pendingAuth.user.email || pendingAuth.user.username || '')
  }

  const handleBackToLogin = () => {
    clearSession()
    navigate('/auth/login')
  }

  if (!pendingAuth) return null

  return (
    <AuthCard>
      <AuthHeader title="TWO FACTOR AUTHENTICATION" subtitle="Verification Challenge Required" />

      {/* Step dots wizard */}
      <WizardStepIndicator currentStep="otp" />

      <form onSubmit={handleVerifyOtp} className="space-y-4 font-saira">
        <div className="text-center mb-6">
          <h2 className="text-md font-bold text-foreground leading-normal tracking-wide">
            Verify your email
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Enter the 6-digit code sent to your email
          </p>
        </div>

        {errorMessage && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive text-caption px-3 py-2 rounded-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 6 digit input boxes */}
        <OtpInput value={otpValue} onChange={setOtpValue} disabled={loading} />

        <div className="space-y-3 pt-2">
          <button
            type="submit"
            disabled={loading || otpValue.length !== 6}
            className="w-full h-9 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/95 hover:to-indigo-600/95 active:scale-[0.99] text-primary-foreground font-bold rounded-xs text-caption flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed select-none"
          >
            {loading ? 'Verifying OTP...' : 'Verify OTP'}
          </button>

          {/* Resend timer or action link */}
          <div className="text-center text-[12px] text-muted-foreground">
            {timer > 0 ? (
              <span>Didn't receive code? Resend in {timer}s</span>
            ) : (
              <button
                type="button"
                onClick={handleResendCode}
                disabled={loading}
                className="text-primary hover:underline font-bold"
              >
                Resend Code
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleBackToLogin}
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
export default OtpPage
