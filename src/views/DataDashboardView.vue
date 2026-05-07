<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'
import { fmtTime } from '@/utils/formatters'
import { esc } from '@/utils/helpers'
import Avatar from '@/components/Avatar.vue'

const route = useRoute()
const router = useRouter()
const { toast } = useToast()
const { confirm } = useModal()

const loading = ref(true)
const activity = ref(null)
const registrations = ref([])
const isOrganizer = ref(false)

const activeRegs = computed(() => registrations.value.filter(r => r.status !== 'cancelled'))
const cancelledCount = computed(() => registrations.value.filter(r => r.status === 'cancelled').length)
const checkedInCount = computed(() => activeRegs.value.filter(r =>
  ['checked_in', 'late', 'completed', 'no_run_recorded'].includes(r.status)).length)
const lateCount = computed(() => activeRegs.value.filter(r => r.status === 'late').length)
const noShowCount = computed(() => {
  if (!activity.value) return 0
  return activeRegs.value.filter(r =>
    r.status === 'registered' && new Date() > new Date(activity.value.end_at)).length
})

const windowOpen = computed(() => {
  if (!activity.value?.checkin_window_end) return true
  return new Date() < new Date(activity.value.checkin_window_end)
})

const groupStats = computed(() => {
  const groups = Array.isArray(activity.value?.groups) ? activity.value.groups : []
  return groups.map(g => {
    const count = registrations.value.filter(r => r.group_name === g.name && r.status !== 'cancelled').length
    return { ...g, count, cap: g.cap || null }
  })
})

const dateStr = computed(() => {
  if (!activity.value?.start_at) return ''
  const d = new Date(activity.value.start_at)
  return `${d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(activity.value.start_at)} · ${activity.value.meetup_place || 'TBD'}`
})

function statusBadge(status) {
  if (status === 'registered' && activity.value?.end_at && new Date() > new Date(activity.value.end_at)) {
    return { text: 'No-show', cls: 'no-show' }
  }
  if (status === 'checked_in' || status === 'completed' || status === 'no_run_recorded') return { text: 'Checked in', cls: 'checked-in' }
  if (status === 'late') return { text: 'Late', cls: 'late' }
  if (status === 'registered') return { text: 'Registered', cls: 'registered' }
  return { text: status, cls: 'registered' }
}

function groupPct(g) {
  return g.cap ? Math.min((g.count / g.cap) * 100, 100) : 0
}

async function manualCheckIn(userId) {
  if (!await confirm({
    title: 'Mark this runner as checked in?',
    message: 'Use this only if the runner is physically at the meetup but GPS failed for them.',
    confirmText: 'Mark in',
  })) return
  try {
    await api.manualCheckIn({ activityId: activity.value.id, userId })
    toast('Marked as checked in', { kind: 'success' })
    await loadData()
  } catch (err) { toast(err.message, { kind: 'error' }) }
}

async function loadData() {
  loading.value = true
  try {
    const activityId = route.params.activityId
    const [a, u] = await Promise.all([api.getActivity(activityId), api.getCurrentUser()])
    activity.value = a
    if (!a) return
    const members = await api.listClubMembers(a.club?.id)
    const myRole = members.find(m => m.profile?.id === u?.id)?.role
    isOrganizer.value = a.club?.owner_id === u?.id || myRole === 'co_organizer'
    if (!isOrganizer.value) return
    registrations.value = await api.listActivityRegistrations(activityId)
  } finally { loading.value = false }
}

onMounted(loadData)
</script>

<template>
  <div>
    <van-nav-bar title="Activity dashboard" left-arrow @click-left="router.back()" />

    <div v-if="loading"><div class="skeleton" style="height:300px;border-radius:10px"></div></div>

    <div v-else-if="!isOrganizer" class="empty">
      <h3>Not authorized</h3><p>Only organizers of this club can view the dashboard.</p>
    </div>

    <template v-else-if="activity">
      <div style="padding:8px 0 12px">
        <div style="font-family:var(--font-display);font-size:26px;font-weight:700;color:var(--ink-900);line-height:1.2">{{ activity.title }}</div>
        <div style="color:var(--ink-500);font-size:14px;margin-top:4px">{{ dateStr }}</div>
      </div>

      <!-- Stats row -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:8px;margin-top:16px">
        <div class="stat-card">
          <div class="stat-value">{{ activeRegs.length }}<small v-if="activity.total_cap" style="font-size:14px;color:var(--ink-500)">/{{ activity.total_cap }}</small></div>
          <div class="stat-label">Registered</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ checkedInCount }}</div>
          <div class="stat-label">Checked in</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ lateCount }}</div>
          <div class="stat-label">Late</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ cancelledCount }}</div>
          <div class="stat-label">Cancelled</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ noShowCount }}</div>
          <div class="stat-label">No-show</div>
        </div>
      </div>

      <!-- Group capacity -->
      <template v-if="groupStats.length">
        <div style="font-family:var(--font-display);font-size:17px;font-weight:700;color:var(--ink-900);margin:24px 0 12px">Group capacity</div>
        <div class="card" style="padding:8px 16px">
          <div v-for="(g, i) in groupStats" :key="g.name" style="padding:12px 0" :style="i < groupStats.length - 1 ? 'border-bottom:1px solid var(--line-2)' : ''">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="font-weight:600;font-size:14px;color:var(--ink-900)">{{ g.name }}{{ g.pace ? ` · ${g.pace}` : '' }}</div>
              <div style="font-size:14px;color:var(--ink-600);font-weight:500">{{ g.count }}{{ g.cap ? `/${g.cap}` : '' }}</div>
            </div>
            <div style="width:100%;height:6px;background:var(--line-2);border-radius:3px;overflow:hidden">
              <div :style="`height:100%;background:var(--ink-900);border-radius:3px;width:${groupPct(g)}%`"></div>
            </div>
          </div>
        </div>
      </template>

      <!-- Participants -->
      <div style="font-family:var(--font-display);font-size:17px;font-weight:700;color:var(--ink-900);margin:24px 0 12px">Participants</div>
      <div class="card" style="padding:0;overflow:hidden">
        <div v-if="!activeRegs.length" class="empty" style="padding:24px"><p>No participants yet.</p></div>
        <div v-for="r in activeRegs" :key="r.user_id" style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line-2)">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--surface-2);display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--line)">
            <img v-if="r.user?.avatar_url" :src="r.user.avatar_url" alt="" style="width:100%;height:100%;object-fit:cover" />
            <i v-else class="fa-solid fa-user"></i>
          </div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:15px;color:var(--ink-900)">{{ r.user?.display_name || 'Runner' }}</div>
            <div style="font-size:13px;color:var(--ink-500);margin-top:1px">{{ r.group_name || 'No group' }}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span v-if="r.checkin_method === 'manual_confirmed'" class="chip ghost" style="padding:2px 8px;font-size:10px">Self-confirmed</span>
            <span v-else-if="r.checkin_method === 'organizer_manual'" class="chip brand" style="padding:2px 8px;font-size:10px">Organizer marked</span>
            <span :class="['status-badge', statusBadge(r.status).cls]">{{ statusBadge(r.status).text }}</span>
            <button v-if="r.status === 'registered' && windowOpen" class="btn sm" style="padding:5px 10px;font-size:12px" @click="manualCheckIn(r.user_id)">Mark in</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stat-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 16px 8px;
  text-align: center;
}
.stat-value {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  color: var(--ink-900);
}
.stat-label {
  font-size: 12px;
  color: var(--ink-500);
  margin-top: 4px;
}
.status-badge {
  padding: 5px 12px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 500;
}
.status-badge.checked-in { background: #F1F5F9; color: #334155; }
.status-badge.late { background: #FEF3C7; color: #92400E; }
.status-badge.no-show { background: #1E293B; color: #F8FAFC; }
.status-badge.registered { background: #FFF7ED; color: #9A3412; }
</style>
