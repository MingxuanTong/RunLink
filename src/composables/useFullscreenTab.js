export function useFullscreenTab() {
  function enterFullscreen() {
    document.body.classList.add('run-fullscreen')
  }
  function exitFullscreen() {
    document.body.classList.remove('run-fullscreen')
  }

  return { enterFullscreen, exitFullscreen }
}
