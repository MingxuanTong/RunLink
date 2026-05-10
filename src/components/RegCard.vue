<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fmtTime } from '@/utils/formatters'
import { useCheckinFlow } from '@/composables/useCheckinFlow'
import { useModal } from '@/composables/useModal'
import CheckinRangeModal from './CheckinRangeModal.vue'
import { useToast } from '@/composables/useToast'
import * as api from '@/api'
import Avatar from './Avatar.vue'

const props = defineProps({
  registration: { type: Object, required: true },
})

const emit = defineEmits(['refresh'])
const router = useRouter()
const {
  startCheckin,
  showModal, distance, radius, accuracy, failReason, meetupName, activity: checkinActivity, checkingIn,
  handleRetry, handleManualCheckin, closeRangeModal, setOnCheckedIn,
} = useCheckinFlow()
setOnCheckedIn(() => emit('refresh'))
const { confirm } = useModal()
const { toast } = useToast()

const r = computed(() => props.registration)
const a = computed(() => r.value.activity)
const now = ref(new Date())

const checkedIn = computed(() => r.value.status === 'checked_in' || r.value.status === 'late')
const canCancel = computed(() => r.value.status === 'registered' && now.value < new Date(a.value.start_at))

const windowOpen = computed(() => {
  const ws = a.value.checkin_window_start ? new Date(a.value.checkin_window_start) : null
  const we = a.value.checkin_window_end ? new Date(a.value.checkin_window_end) : null
  return ws && we && now.value >= ws && now.value <= we
})

const windowLater = computed(() => {
  const ws = a.value.checkin_window_start ? new Date(a.value.checkin_window_start) : null
  return ws && now.value < ws
})

const minsUntilOpen = computed(() => {
  const ws = a.value.checkin_window_start ? new Date(a.value.checkin_window_start) : null
  return ws ? Math.max(1, Math.round((ws - now.value) / 60000)) : 0
})

async function handleCheckin() {
  const agreed = await confirm({
    title: 'Privacy note',
    message: 'Your location is used only to verify check-in near the meetup point. It is not posted publicly from this check-in action.',
    confirmText: 'Continue',
    cancelText: 'Cancel',
  })
  if (!agreed) return
  const act = await api.getActivity(a.value.id)
  const result = await startCheckin(act)
  if (!result?.modal) emit('refresh')
}

async function handleCancel() {
  if (!await confirm({
    title: 'Cancel this registration?',
    message: 'Your seat will be released. You can register again while capacity lasts.',
    danger: true, confirmText: 'Cancel registration',
  })) return
  try {
    await api.cancelRegistration(a.value.id)
    toast('Registration cancelled')
    emit('refresh')
  } catch (err) {
    toast(err.message, { kind: 'error' })
  }
}
</script>

<template>
  <div v-if="a" class="reg-card">
    <div class="top">
      <Avatar :profile="a.club" size="md" />
      <div style="flex:1; min-width:0;">
        <div class="title">{{ a.title }}</div>
        <div class="meta">
          <span class="chip"><i class="fa-regular fa-clock"></i> {{ fmtTime(a.start_at) }} → {{ fmtTime(a.end_at) }}</span>
          <span v-if="a.meetup_name" class="chip"><i class="fa-solid fa-location-dot"></i> {{ a.meetup_name }}</span>
          <span v-if="r.group_name" class="chip"><i class="fa-solid fa-people-group"></i> {{ r.group_name }}</span>
          <span v-if="checkedIn" class="chip success">
            <i class="fa-solid fa-check"></i> {{ r.status === 'late' ? 'Checked in · Late' : 'Checked in' }}
          </span>
        </div>
      </div>
      <button v-if="canCancel" class="overflow" title="More" @click="handleCancel">
        <i class="fa-solid fa-ellipsis"></i>
      </button>
    </div>

    <div v-if="windowOpen" class="checkin-hint">
      <i class="fa-solid fa-circle-dot"></i>
      Check-in open · {{ fmtTime(a.checkin_window_start) }} → {{ fmtTime(a.checkin_window_end) }} · auto-verifies your location in one tap
    </div>

    <div class="actions">
      <button v-if="checkedIn" class="btn sm block" @click="router.push('/running')">
        <i class="fa-solid fa-person-running"></i> Go run
      </button>
      <button v-else-if="windowOpen" class="btn cta sm block" @click="handleCheckin">
        <i class="fa-solid fa-location-crosshairs"></i> Map check-in
      </button>
      <button v-else-if="windowLater" class="btn sm block" disabled>
        <i class="fa-regular fa-clock"></i> Opens in {{ minsUntilOpen }} min
      </button>
      <button v-else class="btn cta sm block" @click="handleCheckin">
        <i class="fa-solid fa-location-crosshairs"></i> Map check-in
      </button>
      <button class="btn ghost sm block" @click="router.push(`/activity/${a.id}`)">View detail</button>
    </div>

    <CheckinRangeModal
      :show="showModal"
      :distance="distance"
      :radius="radius"
      :accuracy="accuracy"
      :reason="failReason"
      :meetup-name="meetupName"
      :activity="checkinActivity"
      :checking-in="checkingIn"
      @close="closeRangeModal"
      @retry="handleRetry"
      @manual-checkin="handleManualCheckin"
    />
  </div>
</template>
