import { create } from 'zustand'

interface LayoutState {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  minWidth: number
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarOpen: true, // Sidebar is always visible and never collapses per rules
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  minWidth: 1000,
}))
