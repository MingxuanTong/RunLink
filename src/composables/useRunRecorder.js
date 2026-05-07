import { ref, onUnmounted } from 'vue'
import { runRecorder } from '@/utils/map'

export function useRunRecorder() {
  const recorder = ref(null)

  function createRecorder(el, options) {
    recorder.value = runRecorder(el, options)
    return recorder.value
  }

  function start(opts) {
    return recorder.value?.start(opts)
  }

  function stop() {
    recorder.value?.stop()
  }

  function recenter() {
    recorder.value?.recenter()
  }

  function zoomIn() {
    recorder.value?.zoomIn()
  }

  function zoomOut() {
    recorder.value?.zoomOut()
  }

  function simulateStep() {
    recorder.value?.simulateStep()
  }

  function getDistanceMeters() {
    return recorder.value?.getDistanceMeters() ?? 0
  }

  function getPoints() {
    return recorder.value?.getPoints() ?? []
  }

  function getPolyline() {
    return recorder.value?.getPolyline() ?? ''
  }

  function getMap() {
    return recorder.value?.map ?? null
  }

  onUnmounted(() => {
    recorder.value?.stop()
  })

  return {
    recorder,
    createRecorder,
    start, stop, recenter, zoomIn, zoomOut,
    simulateStep, getDistanceMeters, getPoints, getPolyline, getMap,
  }
}
