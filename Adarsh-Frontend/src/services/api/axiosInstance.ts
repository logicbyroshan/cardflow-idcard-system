import axios from 'axios'
import { tokenHandler } from './tokenHandler'
import { mapAxiosError } from './errorMapper'

export const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
})

// Request Interceptor: Attach bearer token to request headers
axiosInstance.interceptors.request.use(
  (config) => {
    const token = tokenHandler.getToken()
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(mapAxiosError(error))
  }
)

// Response Interceptor: Catch auth failures and format errors
axiosInstance.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    const apiError = mapAxiosError(error)
    
    // Auto-logout/redirect on unauthorized responses
    if (apiError.status === 401) {
      tokenHandler.clearToken()
      // Optional: Dispatch event or redirect via window location / router
    }
    
    return Promise.reject(apiError)
  }
)
