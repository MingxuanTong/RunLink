import { ref } from 'vue'
import { getCurrentPosition } from '@/utils/geofence'

export function useGeolocation() {
  const position = ref(null)
  const error = ref(null)
  const loading = ref(false)

  async function locate(options) {
    loading.value = true
    error.value = null
    try {
      position.value = await getCurrentPosition(options)
      return position.value
    } catch (err) {
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  return { position, error, loading, locate }
}
