import { showToast, showSuccessToast, showFailToast } from 'vant'

export function useToast() {
  return {
    toast(message, { kind = 'info', duration } = {}) {
      const opts = duration ? { duration } : {}
      switch (kind) {
        case 'success': return showSuccessToast({ message, className: 'toast--success', ...opts })
        case 'error':   return showFailToast({ message, className: 'toast--error', ...opts })
        case 'warn':    return showToast({ message, icon: 'warning', className: 'toast--warn', ...opts })
        default:        return showToast({ message, icon: 'info', className: 'toast--info', ...opts })
      }
    },
    showSuccess: showSuccessToast,
    showError: showFailToast,
  }
}
