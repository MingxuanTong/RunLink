import { showToast, showSuccessToast, showFailToast } from 'vant'

export function useToast() {
  return {
    toast(message, { kind = 'info', duration } = {}) {
      const opts = duration ? { duration } : {}
      switch (kind) {
        case 'success': return showSuccessToast(message)
        case 'error':   return showFailToast(message)
        case 'warn':    return showToast({ message, icon: 'warning', ...opts })
        default:        return showToast({ message, icon: 'info', ...opts })
      }
    },
    showSuccess: showSuccessToast,
    showError: showFailToast,
  }
}
