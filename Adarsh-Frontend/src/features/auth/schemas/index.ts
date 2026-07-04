import { z } from 'zod'

// Validates Email, Username, or Phone for step 1
export const identitySchema = z.object({
  identifier: z.string()
    .min(3, 'Identity must be at least 3 characters')
    .refine((val) => {
      // Allow email format, standard phone format, or alphanumeric usernames
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)
      const isPhone = /^\+?\d{9,15}$/.test(val)
      const isUsername = /^[a-zA-Z0-9_.-]+$/.test(val)
      return isEmail || isPhone || isUsername
    }, {
      message: 'Must be a valid email, username, or phone number',
    })
})

export type IdentityFormValues = z.infer<typeof identitySchema>

// Validates Password input
export const passwordSchema = z.object({
  password: z.string().min(1, 'Password is required')
})

export type PasswordFormValues = z.infer<typeof passwordSchema>

// Validates 6-Digit OTP code input
export const otpSchema = z.object({
  otp: z.string()
    .length(6, 'Verification code must be exactly 6 digits')
    .regex(/^\d+$/, 'Verification code must contain only numbers')
})

export type OtpFormValues = z.infer<typeof otpSchema>

// Validates Request Reset password schema
export const forgotPasswordSchema = z.object({
  identifier: z.string().min(3, 'Identity is required')
})

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

// Validates reset password fields
export const resetPasswordSchema = z.object({
  identifier: z.string().min(1, 'Identity is required'),
  otp: z.string()
    .length(6, 'Verification code must be exactly 6 digits')
    .regex(/^\d+$/, 'Verification code must contain only numbers'),
  new_password: z.string().min(6, 'Password must be at least 6 characters'),
  confirm_password: z.string().min(6, 'Confirm password must be at least 6 characters')
}).refine((data) => data.new_password === data.confirm_password, {
  message: 'Passwords must match',
  path: ['confirm_password']
})

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>
