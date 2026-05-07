import { validateCheckin } from '@/utils/geofence'
import * as api from '@/api'
import { useToast } from './useToast'
import { useModal } from './useModal'

export function useCheckinFlow() {
  const { toast } = useToast()
  const { confirm } = useModal()

  async function startCheckin(activity) {
    if (!activity) return toast('Activity not found', { kind: 'error' })

    const now = new Date()
    if (activity.checkin_window_start && now < new Date(activity.checkin_window_start)) {
      return toast("Check-in window hasn't opened yet.", { kind: 'warn' })
    }
    if (activity.checkin_window_end && now > new Date(activity.checkin_window_end)) {
      return toast('Check-in window is closed.', { kind: 'warn' })
    }

    toast('Locating you…')
    let result
    try {
      result = await validateCheckin(activity)
    } catch (err) {
      return showGpsFallback(activity, {
        reason: 'gps_error',
        accuracy: null,
        errorMessage: err?.message || 'Unable to get location',
      })
    }

    if (result.ok) {
      try {
        const reg = await api.checkIn({
          activityId: activity.id, method: 'gps',
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

    return showGpsFallback(activity, result)
  }

  async function showGpsFallback(activity, result = {}) {
    const reason = result?.reason || 'unknown'
    const allowManual = reason !== 'no_meetup'

    if (!allowManual) {
      toast('Meetup point not configured', { kind: 'error' })
      return { success: false }
    }

    const confirmed = await confirm({
      title: "Confirm you're at the meetup",
      message: `We couldn't verify the 50 m geofence. Tap confirm to do a manual check-in.`,
      confirmText: "I'm at the meetup",
      danger: true,
    })

    if (confirmed) {
      try {
        await api.checkIn({ activityId: activity.id, method: 'fallback' })
        toast('Manual check-in recorded', { kind: 'success' })
        return { success: true }
      } catch (err) {
        toast(err.message, { kind: 'error' })
        return { success: false }
      }
    }

    return { success: false }
  }

  return { startCheckin, runCheckinFlow: startCheckin }
}
