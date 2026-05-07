<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { fmtTime } from '@/utils/formatters'

const router = useRouter()

const loading = ref(true)
const activities = ref([])
const ownedClubs = ref([])

const totalActivities = computed(() => activities.value.length)
const totalRegistered = computed(() => activities.value.reduce((s, a) => s + (a._registered || 0), 0))
const totalCheckedIn = computed(() => activities.value.reduce((s, a) => s + (a._checkedIn || 0), 0))
const upcomingCount = computed(() => activities.value.filter(a =>
  new Date(a.end_at) >= new Date() && a.status !== 'cancelled').length)

const clubMap = computed(() => {
  const map = new Map()
  for (const club of ownedClubs.value) map.set(club.id, { club, activities: [] })
  for (const a of activities.value) {
    const entry = map.get(a.club_id)
    if (entry) entry.activities.push(a)
  }
  return [...map.values()].filter(e => e.activities.length > 0)
})

function activityDateStr(a) {
  if (!a.start_at) return ''
  return new Date(a.start_at).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + fmtTime(a.start_at)
}

async function loadData() {
  loading.value = true
  try {
    const user = await api.getCurrentUser()
    const myClubs = await api.listClubs({ mineOnly: true }).catch(() => [])
    ownedClubs.value = (myClubs || []).filter(c => c.owner_id === user?.id)

    if (!ownedClubs.value.length) { loading.value = false; return }

    const acts = await api.listOrganizerActivities()
    activities.value = await Promise.all(acts.map(async a => {
      const regs = await api.listActivityRegistrations(a.id).catch(() => [])
      const active = regs.filter(r => r.status !== 'cancelled')
      return {
        ...a,
        _registered: active.length,
        _checkedIn: active.filter(r => ['checked_in', 'completed', 'no_run_recorded'].includes(r.status)).length,
        _late: active.filter(r => r.status === 'late').length,
        _noShow: active.filter(r => r.status === 'registered' && new Date() > new Date(a.end_at)).length,
      }
    }))
  } finally { loading.value = false }
}

onMounted(loadData)
</script>

<template>
  <div>
    <van-nav-bar title="Activity dashboard" left-arrow @click-left="router.back()" />

    <div v-if="loading"><div class="skeleton" style="height:300px;border-radius:10px"></div></div>

    <template v-else-if="ownedClubs.length">
      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">
        <div class="org-stat">
          <div class="v">{{ totalActivities }}</div>
          <div class="l">Activities</div>
        </div>
        <div class="org-stat">
          <div class="v">{{ totalRegistered }}</div>
          <div class="l">Registered</div>
        </div>
        <div class="org-stat">
          <div class="v">{{ totalCheckedIn }}</div>
          <div class="l">Checked in</div>
        </div>
      </div>

      <div v-if="upcomingCount" style="margin-bottom:16px;font-size:14px;color:var(--ink-500)">
        <i class="fa-solid fa-clock" style="margin-right:4px"></i> {{ upcomingCount }} upcoming
      </div>

      <!-- Per-club sections -->
      <div v-for="{ club, activities: acts } in clubMap" :key="club.id" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <img v-if="club.crest_url" :src="club.crest_url" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid var(--line)" />
          <div v-else style="width:28px;height:28px;border-radius:50%;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--ink-400);border:1px solid var(--line)">
            <i class="fa-solid fa-people-group"></i>
          </div>
          <div style="font-family:var(--font-display);font-size:17px;font-weight:700;color:var(--ink-900)">{{ club.name }}</div>
        </div>
        <div v-for="a in acts" :key="a.id" class="card" style="padding:14px 16px;margin-bottom:8px;cursor:pointer" @click="router.push(`/activity/${a.id}/dashboard`)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <div style="font-weight:600;font-size:15px;color:var(--ink-900)">{{ a.title }}</div>
              <div v-if="a.start_at" style="font-size:13px;color:var(--ink-500);margin-top:2px">{{ activityDateStr(a) }}</div>
            </div>
            <span :class="['org-status', a.status]">{{ a.status }}</span>
          </div>
          <div style="display:flex;gap:16px;margin-top:10px">
            <span style="font-size:13px;color:var(--ink-600)"><strong style="color:var(--ink-900)">{{ a._registered }}</strong> reg{{ a.total_cap ? ` / ${a.total_cap}` : '' }}</span>
            <span style="font-size:13px;color:var(--ink-600)"><strong style="color:var(--ink-900)">{{ a._checkedIn }}</strong> in</span>
            <span v-if="a._late" style="font-size:13px;color:var(--ink-600)"><strong style="color:var(--ink-900)">{{ a._late }}</strong> late</span>
            <span v-if="a._noShow" style="font-size:13px;color:var(--ink-600)"><strong style="color:var(--ink-900)">{{ a._noShow }}</strong> no-show</span>
          </div>
        </div>
      </div>

      <div v-if="!totalActivities" class="empty" style="padding:40px 20px">
        <i class="fa-solid fa-calendar-xmark" style="font-size:32px;color:var(--ink-300)"></i>
        <h3>No activities yet</h3><p>Publish your first club activity to see stats here.</p>
      </div>
    </template>

    <div v-else class="empty">
      <h3>Not authorized</h3><p>Only organizers can view this dashboard.</p>
    </div>
  </div>
</template>

<style scoped>
.org-stat {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 16px 12px;
  text-align: center;
}
.org-stat .v {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 700;
  color: var(--ink-900);
}
.org-stat .l {
  font-size: 12px;
  color: var(--ink-500);
  margin-top: 4px;
}
.org-status {
  padding: 4px 10px;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.org-status.published { background: #FFF7ED; color: #9A3412; }
.org-status.completed { background: #F1F5F9; color: #334155; }
.org-status.cancelled { background: #FEF2F2; color: #991B1B; }
.org-status.draft { background: #F5F3FF; color: #5B21B6; }
</style>
