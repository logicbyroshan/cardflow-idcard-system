import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '../store/authStore'
import { type User } from '../types'

describe('Authentication Zustand Store', () => {
  beforeEach(() => {
    // Reset Zustand store state before each test
    useAuthStore.getState().clearSession()
  })

  it('should initialize with default empty values', () => {
    const state = useAuthStore.getState()
    expect(state.identity).toBeNull()
    expect(state.user).toBeNull()
    expect(state.token).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.authStatus).toBe('idle')
  })

  it('should set identity successfully', () => {
    useAuthStore.getState().setIdentity('admin@adarshid.com')
    expect(useAuthStore.getState().identity).toBe('admin@adarshid.com')
  })

  it('should set active session context', () => {
    const mockUser: User = {
      id: 'usr-41',
      email: 'admin@adarshid.com',
      username: 'admin',
      phone: null,
      role: 'admin',
      is_active: true,
      created_at: new Date().toISOString()
    }
    const token = 'access_token_123'
    const refresh = 'refresh_token_456'

    useAuthStore.getState().setSession(mockUser, token, refresh)

    const state = useAuthStore.getState()
    expect(state.user).toEqual(mockUser)
    expect(state.token).toBe(token)
    expect(state.refreshToken).toBe(refresh)
    expect(state.isAuthenticated).toBe(true)
    expect(state.authStatus).toBe('success')
  })

  it('should clear session context on logout', () => {
    const mockUser: User = {
      id: 'usr-41',
      email: 'admin@adarshid.com',
      username: 'admin',
      phone: null,
      role: 'admin',
      is_active: true,
      created_at: new Date().toISOString()
    }
    useAuthStore.getState().setSession(mockUser, 'tok', 'ref')
    useAuthStore.getState().clearSession()

    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.token).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.authStatus).toBe('idle')
  })

  it('should allow role updates for layout simulation', () => {
    const mockUser: User = {
      id: 'usr-41',
      email: 'admin@adarshid.com',
      username: 'admin',
      phone: null,
      role: 'admin',
      is_active: true,
      created_at: new Date().toISOString()
    }
    useAuthStore.getState().setSession(mockUser, 'tok', 'ref')
    useAuthStore.getState().updateRole('operator')

    expect(useAuthStore.getState().user?.role).toBe('operator')
  })
})
