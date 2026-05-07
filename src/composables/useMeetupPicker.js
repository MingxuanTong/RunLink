import { ref } from 'vue'
import { meetupPicker } from '@/utils/map'

export function useMeetupPicker() {
  const picker = ref(null)

  function init(el, options) {
    picker.value = meetupPicker(el, options)
    return picker.value
  }

  function setLatLng(coords) {
    picker.value?.setLatLng(coords)
  }

  function setRadius(r) {
    picker.value?.setRadius(r)
  }

  async function locate() {
    return picker.value?.locate()
  }

  function getLatLng() {
    return picker.value?.getLatLng() ?? null
  }

  return { picker, init, setLatLng, setRadius, locate, getLatLng }
}
