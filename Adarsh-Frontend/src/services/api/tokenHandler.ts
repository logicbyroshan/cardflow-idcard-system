const TOKEN_KEY = 'adarsh_auth_token'

export const tokenHandler = {
  getToken: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  
  setToken: (token: string): void => {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch (e) {
      console.error('Failed to save auth token', e)
    }
  },
  
  clearToken: (): void => {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch (e) {
      console.error('Failed to clear auth token', e)
    }
  }
}
