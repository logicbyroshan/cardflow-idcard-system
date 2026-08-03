import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LoginPage from '../pages/LoginPage'
import { useAuthStore } from '../store/authStore'
import { authService } from '../services/authService'

// Mock entire authService to avoid external API dependencies
vi.mock('../services/authService', () => ({
  authService: {
    verifyIdentity: vi.fn().mockResolvedValue(true),
    login: vi.fn()
  }
}))

describe('Authentication Form Flow Integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useAuthStore.getState().clearSession()
  })

  it('should transition from step 1 (identity) to step 2 (password) upon successful verification', async () => {
    render(
      <MemoryRouter initialEntries={['/auth/login']}>
        <Routes>
          <Route path="/auth/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    )

    // Verify step 1 title is visible
    expect(screen.getByText('Enter your email, username, or phone')).not.toBeNull()

    // Type identity
    const input = screen.getByPlaceholderText('iamroshandamor@gmail.com')
    fireEvent.change(input, { target: { value: 'iamroshandamor@gmail.com' } })

    // Click Continue
    const btn = screen.getByRole('button', { name: 'Continue' })
    fireEvent.click(btn)

    // Wait for step transition
    await waitFor(() => {
      expect(authService.verifyIdentity).toHaveBeenCalledWith('iamroshandamor@gmail.com')
    })

    // Verify step 2 password title is visible
    expect(screen.getByText('Enter your password')).not.toBeNull()
  })
})
