import { AxiosError } from 'axios'

export interface ApiError {
  message: string
  status?: number
  code?: string
  errors?: Record<string, string[]> // For form/field validation errors from backend
}

export function mapAxiosError(error: unknown): ApiError {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const data = error.response?.data

    // If backend returns a structured validation error
    if (data && typeof data === 'object') {
      const apiMessage = (data as any).message || (data as any).detail || error.message
      const fieldErrors = (data as any).errors || null
      
      return {
        message: apiMessage,
        status,
        code: (data as any).code,
        errors: fieldErrors,
      }
    }

    if (status === 401) {
      return { message: 'Unauthorized. Please login again.', status }
    }
    if (status === 403) {
      return { message: 'Access denied. You do not have permissions for this action.', status }
    }
    if (status === 404) {
      return { message: 'Requested resource not found.', status }
    }
    if (status && status >= 500) {
      return { message: 'Internal server error. Please try again later.', status }
    }

    return {
      message: error.message || 'A network error occurred.',
      status,
    }
  }

  if (error instanceof Error) {
    return { message: error.message }
  }

  return { message: 'An unexpected error occurred.' }
}
