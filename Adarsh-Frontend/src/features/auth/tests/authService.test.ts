import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authService } from '../services/authService'
import { useAuthStore } from '../store/authStore'
import { axiosInstance } from '@/services/api/axiosInstance'

// Mock Axios Instance
vi.mock('@/services/api/axiosInstance', () => ({
  axiosInstance: {
    post: vi.fn()
  }
}))

describe('Authentication API Service Wrappers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useAuthStore.getState().clearSession()
  })

  it('should verify identity format locally and save identifier', async () => {
    const success = await authService.verifyIdentity('iamroshandamor@gmail.com')
    expect(success).toBe(true)
    expect(useAuthStore.getState().identity).toBe('iamroshandamor@gmail.com')
  })

  it('should propagate validation failures for short identities', async () => {
    await expect(authService.verifyIdentity('ab')).rejects.toThrow()
  })

  it('should send password verification and return tokens for normal users', async () => {
    useAuthStore.getState().setIdentity('client_user')
    
    // Mock JWT payload with a client role
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ user_id: 'client-id-123', role: 'client', email: 'client@adarsh.com' }))
    const signature = 'fake_sig'
    const mockToken = `${header}.${payload}.${signature}`

    vi.mocked(axiosInstance.post).mockResolvedValueOnce({
      data: {
        access: mockToken,
        refresh: 'refresh_token_payload'
      }
    })

    const result = await authService.login('secretpassword')
    expect(result.tokens.access).toBe(mockToken)
    expect(result.user.role).toBe('client')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('should request OTP challenge and set pendingAuth context for high privilege users', async () => {
    useAuthStore.getState().setIdentity('admin_user')

    // Mock JWT payload with an admin role
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ user_id: 'admin-id-123', role: 'admin', email: 'admin@adarsh.com' }))
    const signature = 'fake_sig'
    const mockToken = `${header}.${payload}.${signature}`

    vi.mocked(axiosInstance.post).mockResolvedValueOnce({
      data: {
        access: mockToken,
        refresh: 'refresh_token_payload'
      }
    })

    const result = await authService.login('secretpassword')
    expect(result.tokens.access).toBe(mockToken)
    expect(useAuthStore.getState().authStatus).toBe('otp_required')
    expect(useAuthStore.getState().pendingAuth).not.toBeNull()
  })

  it('should call forgot-password post endpoint to dispatch verification codes', async () => {
    vi.mocked(axiosInstance.post).mockResolvedValueOnce({ data: { message: 'OTP sent' } })

    const res = await authService.forgotPassword('client@adarsh.com')
    expect(res).toBe(true)
    expect(axiosInstance.post).toHaveBeenCalledWith('/auth/forgot-password/', { identifier: 'client@adarsh.com' })
  })

  it('should call reset-password post endpoint to reset credentials', async () => {
    vi.mocked(axiosInstance.post).mockResolvedValueOnce({ data: { message: 'Password reset successful' } })
    useAuthStore.getState().setIdentity('client@adarsh.com')

    const res = await authService.resetPassword('123456', 'newpassword123')
    expect(res).toBe(true)
    expect(axiosInstance.post).toHaveBeenCalledWith('/auth/reset-password/', {
      identifier: 'client@adarsh.com',
      otp: '123456',
      new_password: 'newpassword123'
    })
  })
})
