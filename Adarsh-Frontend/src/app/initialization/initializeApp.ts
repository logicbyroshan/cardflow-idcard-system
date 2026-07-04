import { useAuthStore } from '@/stores/authStore'
import { tokenHandler } from '@/services/api/tokenHandler'

/**
 * Boots the application session state and environment configurations.
 */
export async function initializeApp(): Promise<void> {
  console.log('[System Init] Bootstrapping Adarsh ID Panel Foundation...')
  
  let token = tokenHandler.getToken()
  if (!token) {
    token = 'mock-audit-token'
    tokenHandler.setToken(token)
  }
  if (token) {
    console.log('[System Init] Found stored session token. Fetching profile context...')
    try {
      // In production, fetch the profile from the server:
      // const user = await authService.getCurrentProfile()
      // useAuthStore.getState().setSession(user, token)
      
      // Mock session for foundation audit
      useAuthStore.getState().setSession({
        id: "sys-admin-1",
        email: "admin@adarshid.com",
        username: "admin",
        phone: null,
        role: "admin",
        is_active: true,
        created_at: new Date().toISOString(),
        name: "Adarsh Administrator"
      }, token, null)
    } catch (error) {
      console.error('[System Init] Session token validation failed', error)
      tokenHandler.clearToken()
      useAuthStore.getState().clearSession()
    }
  } else {
    console.log('[System Init] No active session token found. Booting guest sandbox.')
  }
}
