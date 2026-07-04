import { useNotificationStore } from '@/stores/notificationStore'

export const notificationService = {
  notifySuccess: (title: string, message: string): void => {
    useNotificationStore.getState().addNotification({
      title,
      message,
      type: 'success',
    })
  },

  notifyError: (title: string, message: string): void => {
    useNotificationStore.getState().addNotification({
      title,
      message,
      type: 'error',
    })
  },

  notifyWarning: (title: string, message: string): void => {
    useNotificationStore.getState().addNotification({
      title,
      message,
      type: 'warning',
    })
  },

  notifyInfo: (title: string, message: string): void => {
    useNotificationStore.getState().addNotification({
      title,
      message,
      type: 'info',
    })
  }
}
