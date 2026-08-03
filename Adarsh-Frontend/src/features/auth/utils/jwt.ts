import { type User, type UserRole } from '../types'

interface JwtPayload {
  user_id?: string
  role?: UserRole
  email?: string
  username?: string
  exp?: number
}

/**
 * Decodes the payload segment of a JWT token without using third-party library dependencies.
 */
export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    
    // Decode base64url
    const base64Url = parts[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )
    
    return JSON.parse(jsonPayload)
  } catch (error) {
    console.error('[JWT Utils] Failed to decode token payload:', error)
    return null
  }
}

/**
 * Parses user information from a JWT token, with fallback bindings.
 */
export function parseUserFromToken(token: string, fallbackIdentifier?: string): User | null {
  const payload = decodeJwt(token)
  if (!payload) return null
  const id = payload.user_id || 'sys-user-unknown'
  const email = payload.email || (fallbackIdentifier && fallbackIdentifier.includes('@') ? fallbackIdentifier : null)
  const username = payload.username || (fallbackIdentifier && !fallbackIdentifier.includes('@') ? fallbackIdentifier : null) || 'user'
  
  // Detect role from payload claims or infer from identifier text
  let role: UserRole = 'assistant'
  if (payload.role) {
    role = payload.role
  } else if (fallbackIdentifier) {
    const lower = fallbackIdentifier.toLowerCase()
    if (lower.includes('admin')) {
      role = 'admin'
    } else if (lower.includes('op')) {
      role = 'operator'
    } else if (lower.includes('pro')) {
      role = 'pro_user'
    } else if (lower.includes('client')) {
      role = 'client'
    }
  }

  return {
    id,
    email,
    username,
    phone: null,
    role,
    name: username || email || 'Adarsh User',
    is_active: true,
    created_at: new Date().toISOString()
  }
}
