import { describe, it, expect } from 'vitest'
import { identitySchema, passwordSchema, otpSchema, resetPasswordSchema } from '../schemas'

describe('Authentication Form Validation Schemas', () => {
  describe('Identity validation (Email, Username, Phone)', () => {
    it('should pass valid email formats', () => {
      const res = identitySchema.safeParse({ identifier: 'iamroshandamor@gmail.com' })
      expect(res.success).toBe(true)
    })

    it('should pass valid alphanumeric username formats', () => {
      const res = identitySchema.safeParse({ identifier: 'admin_user12' })
      expect(res.success).toBe(true)
    })

    it('should pass valid phone formats', () => {
      const res = identitySchema.safeParse({ identifier: '+919876543210' })
      expect(res.success).toBe(true)
    })

    it('should fail too short identity values', () => {
      const res = identitySchema.safeParse({ identifier: 'ab' })
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.error.issues[0].message).toBe('Identity must be at least 3 characters')
      }
    })

    it('should fail invalid symbols in identifiers', () => {
      const res = identitySchema.safeParse({ identifier: 'user#name' })
      expect(res.success).toBe(false)
    })
  })

  describe('Password validation', () => {
    it('should pass non-empty passwords', () => {
      const res = passwordSchema.safeParse({ password: 'secretpassword123' })
      expect(res.success).toBe(true)
    })

    it('should fail empty passwords', () => {
      const res = passwordSchema.safeParse({ password: '' })
      expect(res.success).toBe(false)
    })
  })

  describe('OTP digit validation', () => {
    it('should pass exactly 6 digits', () => {
      const res = otpSchema.safeParse({ otp: '123456' })
      expect(res.success).toBe(true)
    })

    it('should fail letters in otp codes', () => {
      const res = otpSchema.safeParse({ otp: '12a456' })
      expect(res.success).toBe(false)
    })

    it('should fail lengths other than 6', () => {
      const res = otpSchema.safeParse({ otp: '12345' })
      expect(res.success).toBe(false)
    })
  })

  describe('Reset password validation', () => {
    it('should pass matching new passwords', () => {
      const res = resetPasswordSchema.safeParse({
        identifier: 'admin',
        otp: '123456',
        new_password: 'newpassword123',
        confirm_password: 'newpassword123'
      })
      expect(res.success).toBe(true)
    })

    it('should fail mismatching passwords', () => {
      const res = resetPasswordSchema.safeParse({
        identifier: 'admin',
        otp: '123456',
        new_password: 'newpassword123',
        confirm_password: 'differentpassword'
      })
      expect(res.success).toBe(false)
    })
  })
})
