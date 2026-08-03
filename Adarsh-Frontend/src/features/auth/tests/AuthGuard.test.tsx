import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthGuard } from '@/app/guards/AuthGuard'
import { useAuthStore } from '../store/authStore'

describe('AuthGuard Route Interceptor', () => {
  beforeEach(() => {
    useAuthStore.getState().clearSession()
  })

  it('should redirect unauthenticated sessions to /auth/login', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route 
            path="/dashboard" 
            element={
              <AuthGuard>
                <div>Dashboard Panel Content</div>
              </AuthGuard>
            } 
          />
          <Route path="/auth/login" element={<div>Login Screen Redirect Node</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.queryByText('Dashboard Panel Content')).toBeNull()
    expect(screen.getByText('Login Screen Redirect Node')).not.toBeNull()
  })

  it('should allow authenticated sessions through to targeted routes', () => {
    useAuthStore.getState().setSession(
      {
        id: 'usr-1',
        email: 'user@adarsh.com',
        username: 'user',
        phone: null,
        role: 'client',
        is_active: true,
        created_at: new Date().toISOString()
      },
      'fake-token',
      'fake-refresh'
    )

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route 
            path="/dashboard" 
            element={
              <AuthGuard>
                <div>Dashboard Panel Content</div>
              </AuthGuard>
            } 
          />
          <Route path="/auth/login" element={<div>Login Screen Redirect Node</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Dashboard Panel Content')).not.toBeNull()
    expect(screen.queryByText('Login Screen Redirect Node')).toBeNull()
  })
})
