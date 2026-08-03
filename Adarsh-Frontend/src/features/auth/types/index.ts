export type UserRole = 'admin' | 'operator' | 'pro_user' | 'client' | 'assistant'

export interface User {
  id: string
  email: string | null
  username: string | null
  phone: string | null
  role: UserRole
  name?: string 
  is_active: boolean
  created_at: string
}

export interface AuthTokens {
  access: string
  refresh: string
}

export interface PendingAuth {
  user: User
  tokens: AuthTokens
}

export type AuthStatus = 'idle' | 'checking_identity' | 'authenticating' | 'otp_required' | 'success' | 'error'

export type OtpStatus = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified' | 'expired' | 'error'

export interface AuthState {
  identity: string | null
  user: User | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  authStatus: AuthStatus
  otpStatus: OtpStatus
  error: string | null
  pendingAuth: PendingAuth | null
  setIdentity: (identity: string | null) => void
  setSession: (user: User | null, token: string | null, refreshToken: string | null) => void
  clearSession: () => void
  setAuthStatus: (status: AuthStatus) => void
  setOtpStatus: (status: OtpStatus) => void
  setError: (error: string | null) => void
  updateRole: (role: UserRole) => void
  setPendingAuth: (pendingAuth: PendingAuth | null) => void
}
