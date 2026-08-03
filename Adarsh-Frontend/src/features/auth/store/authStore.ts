import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { type AuthState, type UserRole } from '../types'

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      identity: null,
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      authStatus: 'idle',
      otpStatus: 'idle',
      error: null,
      pendingAuth: null,

      setIdentity: (identity) => set({ identity }),
      
      setSession: (user, token, refreshToken) => set({ 
        user, 
        token, 
        refreshToken, 
        isAuthenticated: !!token,
        authStatus: token ? 'success' : 'idle',
        error: null,
        pendingAuth: null
      }),
      
      clearSession: () => set({ 
        identity: null,
        user: null, 
        token: null, 
        refreshToken: null, 
        isAuthenticated: false,
        authStatus: 'idle',
        otpStatus: 'idle',
        error: null,
        pendingAuth: null
      }),
      
      setAuthStatus: (authStatus) => set({ authStatus }),
      setOtpStatus: (otpStatus) => set({ otpStatus }),
      setError: (error) => set({ error }),
      
      updateRole: (role: UserRole) => set((state) => ({
        user: state.user ? { ...state.user, role } : null
      })),

      setPendingAuth: (pendingAuth) => set({ pendingAuth })
    }),
    {
      name: 'adarsh-auth-storage',
      storage: createJSONStorage(() => localStorage),
      // Only persist user, token, refreshToken, isAuthenticated, and pendingAuth
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        pendingAuth: state.pendingAuth,
      }),
    }
  )
)
