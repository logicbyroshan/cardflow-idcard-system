export const storageService = {
  getItem: <T>(key: string): T | null => {
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : null
    } catch (e) {
      console.error(`Error reading key ${key} from storage`, e)
      return null
    }
  },

  setItem: <T>(key: string, value: T): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
      console.error(`Error writing key ${key} to storage`, e)
    }
  },

  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key)
    } catch (e) {
      console.error(`Error removing key ${key} from storage`, e)
    }
  },

  clear: (): void => {
    try {
      localStorage.clear()
    } catch (e) {
      console.error(`Error clearing storage`, e)
    }
  }
}
