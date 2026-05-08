import { ref } from 'vue'
import { validateCheckin } from '@/utils/geofence'
import * as api from '@/api'
import { useToast } from './useToast'
import { useModal } from './useModal'

export function useCheckinFlow() {
  const { toast } = useToast()
  const { confirm } = useModal()

  // Modal state
  const showModal = ref(false)
  const distance = ref(null)
  const radius = ref(50)
  const accuracy = ref(null)
  const failReason = ref('')
  const meetupName = ref('')
  const activity = ref(null)
  const checkingIn = ref(false)
  let onCheckedIn = null

  function setOnCheckedIn(fn) { onCheckedIn = fn }

  async function startCheckin(act) {
    if (!act) return toast('Activity not found', { kind: 'error' })

    const now = new Date()
    if (act.checkin_window_start && now < new Date(act.checkin_window_start)) {
      return toast("Check-in window hasn't opened yet.", { kind: 'warn' })
    }
    if (act.checkin_window_end && now > new Date(act.checkin_window_end)) {
      return toast('Check-in window is closed.', { kind: 'warn' })
    }

    toast('Locating you…')
    let result
    try {
      result = await validateCheckin(act)
    } catch (err) {
      distance.value = null
      accuracy.value = null
      failReason.value = 'gps_error'
      radius.value = act.geofence_m ?? 50
      meetupName.value = act.meetup_name || 'Meetup'
      activity.value = act
      showModal.value = true
      return { success: false, modal: true }
    }

    if (result.ok) {
      try {
        const reg = await api.checkIn({
          activityId: act.id, method: 'gps',
          lat: result.lat, lng: result.lng, accuracy: result.accuracy,
        })
        const isLate = reg.status === 'late'
        toast(`Checked in · ${Math.round(result.distance)} m from meetup${isLate ? ' · Late' : ''}`,
          { kind: 'success', duration: 3500 })
        return { success: true, reg, result }
      } catch (err) {
        toast(err.message, { kind: 'error' })
        return { success: false }
      }
    }

    // Out of range or low accuracy — open custom modal
    distance.value = result.distance ?? null
    accuracy.value = result.accuracy ?? null
    failReason.value = result.reason || 'unknown'
    radius.value = result.radius || act.geofence_m || 50
    meetupName.value = act.meetup_name || 'Meetup'
    activity.value = act
    showModal.value = true
    return { success: false, modal: true }
  }

  async function handleRetry() {
    if (!activity.value) return
    checkingIn.value = true
    try {
      const result = await validateCheckin(activity.value)
      if (result.ok) {
        showModal.value = false
        try {
          const reg = await api.checkIn({
            activityId: activity.value.id, method: 'gps',
            lat: result.lat, lng: result.lng, accuracy: result.accuracy,
          })
          const isLate = reg.status === 'late'
          toast(`Checked in · ${Math.round(result.distance)} m from meetup${isLate ? ' · Late' : ''}`,
            { kind: 'success', duration: 3500 })
          onCheckedIn?.()
          return { success: true, reg, result }
        } catch (err) {
          toast(err.message, { kind: 'error' })
          return { success: false }
        }
      }
      // Still out of range — update distance
      distance.value = result.distance ?? null
      accuracy.value = result.accuracy ?? null
      failReason.value = result.reason || 'unknown'
      toast('Still outside check-in range', { kind: 'warn' })
      return { success: false }
    } catch (err) {
      toast(err.message || 'Could not get your location', { kind: 'error' })
      return { success: false }
    } finally {
      checkingIn.value = false
    }
  }

  async function handleManualCheckin() {
    if (!activity.value) return
    if (failReason.value === 'no_meetup') {
      toast('Meetup point not configured', { kind: 'error' })
      return { success: false }
    }
    const confirmed = await confirm({
      title: 'Confirm manual check-in',
      message: 'This will record a check-in without GPS verification.',
      confirmText: 'Check in',
      danger: false,
    })
    if (!confirmed) return { success: false }
    try {
      const reg = await api.checkIn({ activityId: activity.value.id, method: 'fallback' })
      showModal.value = false
      toast('Manual check-in recorded', { kind: 'success' })
      onCheckedIn?.()
      return { success: true, reg }
    } catch (err) {
      toast(err.message, { kind: 'error' })
      return { success: false }
    }
  }

  function closeRangeModal() {
    showModal.value = false
  }

  return {
    startCheckin,
    runCheckinFlow: startCheckin,
    // Modal state
    showModal,
    distance,
    radius,
    accuracy,
    failReason,
    meetupName,
    activity,
    checkingIn,
    // Modal actions
    handleRetry,
    handleManualCheckin,
    closeRangeModal,
    setOnCheckedIn,
  }
}
