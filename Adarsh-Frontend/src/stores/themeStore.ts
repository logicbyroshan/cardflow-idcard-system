import { create } from 'zustand'

interface ThemeState {
  theme: 'dark' // Hardcoded to dark only per guidelines
  setTheme: (theme: 'dark') => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),
}))
