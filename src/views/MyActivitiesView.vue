<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'
import ActivityCard from '@/components/ActivityCard.vue'

const router = useRouter()
const { toast } = useToast()
const { confirm } = useModal()
const loading = ref(true)
const activeTab = ref('upcoming')
const regs = ref([])
const runsByActivity = ref(new Map())

async function loadData() {
  loading.value = true
  try {
    const [regData, runsMap] = await Promise.all([
      api.listMyRegistrations({ timeframe: activeTab.value }),
      api.myRunsByActivity(),
    ])
    regs.value = regData
    runsByActivity.value = runsMap
  } finally {
    loading.value = false
  }
}

function setTab(tab) {
  activeTab.value = tab
  loadData()
}

function getBadge(r) {
  const a = r.activity
  if (!a) return ''
  const isPast = new Date(a.end_at) < new Date()
  const checkedIn = r.status === 'checked_in' || r.status === 'late'
  const hasRun = (runsByActivity.value.get?.(a.id) ?? 0) > 0

  if (r.status === 'cancelled') return 'Cancelled'
  if (isPast) {
    if (checkedIn && hasRun) return 'Completed'
    if (checkedIn) return 'Checked in · no run recorded'
    return 'Missed'
  }
  if (checkedIn) return `Checked in${r.status === 'late' ? ' · Late' : ''}`
  const now = new Date()
  const ws = a.checkin_window_start ? new Date(a.checkin_window_start) : null
  const we = a.checkin_window_end ? new Date(a.checkin_window_end) : null
  if (ws && we && now >= ws && now <= we) return 'Check-in open'
  if (now >= new Date(a.start_at)) return 'Live'
  return 'Upcoming'
}

function getBadgeClass(r) {
  const a = r.activity
  if (!a) return 'ghost'
  const isPast = new Date(a.end_at) < new Date()
  const checkedIn = r.status === 'checked_in' || r.status === 'late'
  const hasRun = (runsByActivity.value.get?.(a.id) ?? 0) > 0

  if (r.status === 'cancelled') return 'danger'
  if (isPast) {
    if (checkedIn && hasRun) return 'success'
    if (checkedIn) return 'ghost'
    return 'warn'
  }
  if (checkedIn) return 'success'
  const now = new Date()
  const ws = a.checkin_window_start ? new Date(a.checkin_window_start) : null
  const we = a.checkin_window_end ? new Date(a.checkin_window_end) : null
  if (ws && we && now >= ws && now <= we) return 'brand'
  return 'ghost'
}

function isCheckedIn(r) {
  return r.status === 'checked_in' || r.status === 'late'
}

function canCancel(r) {
  return r.status === 'registered' && r.activity && new Date() < new Date(r.activity.start_at)
}

function hasRunFor(r) {
  return (runsByActivity.value.get?.(r.activity_id) ?? 0) > 0
}

async function handleCancel(r) {
  if (!await confirm({
    title: 'Cancel this registration?',
    message: 'Your seat will be released. You can register again while capacity lasts.',
    confirmText: 'Cancel registration',
    danger: true,
  })) return
  try {
    await api.cancelRegistration(r.activity_id)
    toast('Registration cancelled')
    await loadData()
  } catch (err) {
    toast(err.message, { kind: 'error' })
  }
}

onMounted(loadData)
</script>

<template>
  <div>
    <van-nav-bar title="My activities" left-arrow @click-left="router.back()" />

    <div class="tabs-pill">
      <button :class="['pill-tab', { active: activeTab === 'upcoming' }]" @click="setTab('upcoming')">Upcoming</button>
      <button :class="['pill-tab', { active: activeTab === 'past' }]" @click="setTab('past')">Past</button>
    </div>

    <div v-if="loading">
      <div v-for="n in 3" :key="n" class="card"><div class="skeleton" style="height:72px;border-radius:10px"></div></div>
    </div>

    <template v-else-if="regs.length">
      <div v-for="r in regs" :key="r.activity_id" style="margin-bottom:4px">
        <ActivityCard :activity="r.activity">
          <template #badge>
            <span :class="['chip', getBadgeClass(r)]">{{ getBadge(r) }}</span>
          </template>
          <template #actions>
            <div style="display:flex;gap:8px;padding:8px 14px 14px;flex-wrap:wrap">
              <button v-if="isCheckedIn(r)" class="btn sm" @click.stop="router.push('/running')">
                <i class="fa-solid fa-person-running"></i> Go run
              </button>
              <button v-if="isCheckedIn(r) && !hasRunFor(r)" class="btn ghost sm" @click.stop="router.push(`/activity/${r.activity_id}`)">
                <i class="fa-solid fa-pen"></i> Write reflection
              </button>
              <button v-if="canCancel(r)" class="btn ghost sm" @click.stop="handleCancel(r)">
                <i class="fa-solid fa-ban"></i> Cancel
              </button>
            </div>
          </template>
        </ActivityCard>
      </div>
    </template>

    <div v-else class="empty">
      <i class="fa-regular fa-calendar"></i>
      <h3>{{ activeTab === 'upcoming' ? 'No upcoming activities' : 'Nothing here yet' }}</h3>
      <p>{{ activeTab === 'upcoming' ? 'Discover one on Discover.' : 'Your first finished activity will show up here.' }}</p>
      <button v-if="activeTab === 'upcoming'" class="btn" @click="router.push('/discover')">Browse activities</button>
    </div>
  </div>
</template>
