import { useEffect } from 'react'

export interface ShortcutConfig {
  key: string // e.g. 's', 'k', 'escape'
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  action: () => void
  description: string
}

let shortcutRegistry: ShortcutConfig[] = []

export const registerShortcut = (config: ShortcutConfig) => {
  shortcutRegistry.push(config)
  return () => {
    shortcutRegistry = shortcutRegistry.filter((s) => s !== config)
  }
}

export const getRegisteredShortcuts = () => [...shortcutRegistry]

export const useShortcuts = (shortcuts: ShortcutConfig[]) => {
  useEffect(() => {
    const unsubscribes = shortcuts.map((s) => registerShortcut(s))

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events in inputs/textarea unless they are Escape or custom overrides
      const activeEl = document.activeElement
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.getAttribute('contenteditable') === 'true'
      )

      for (const s of shortcutRegistry) {
        const keyMatch = e.key.toLowerCase() === s.key.toLowerCase()
        
        // Escape is allowed even in inputs
        if (isInput && s.key.toLowerCase() !== 'escape') {
          continue
        }

        const ctrlMatch = !s.ctrlKey || (e.ctrlKey || e.metaKey)
        const shiftMatch = !s.shiftKey || e.shiftKey
        const altMatch = !s.altKey || e.altKey

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault()
          s.action()
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      unsubscribes.forEach((unsub) => unsub())
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [shortcuts])
}
