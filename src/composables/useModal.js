import { showConfirmDialog, showDialog } from 'vant'

export function useModal() {
  return {
    async confirm({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
      try {
        await showConfirmDialog({
          title,
          message,
          confirmButtonText: confirmText,
          cancelButtonText: cancelText,
          confirmButtonColor: danger ? '#EF4444' : '#F97316',
        })
        return true
      } catch {
        return false
      }
    },

    async alert({ title, message, confirmText = 'OK' } = {}) {
      await showDialog({ title, message, confirmButtonText: confirmText })
    },
  }
}
