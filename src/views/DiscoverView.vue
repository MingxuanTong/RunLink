<script setup>
import { ref, computed, onMounted } from 'vue'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { haversineMeters, getCurrentPosition } from '@/utils/geofence'
import { supabaseHelperMemberships } from '@/utils/shared-helpers'
import ActivityCard from '@/components/ActivityCard.vue'
import RegCard from '@/components/RegCard.vue'
import FeaturedHero from '@/components/FeaturedHero.vue'
import RecCard from '@/components/RecCard.vue'

const { toast } = useToast()

const loading = ref(true)
const upcoming = ref([])
const regs = ref([])
const myClubIds = ref(new Set())
const searchQuery = ref('')
const discoverMode = ref('for-you')
const nearbyRows = ref(null)

const registeredIds = computed(() =>
  new Set(regs.value.filter(r => r.status !== 'cancelled').map(r => r.activity?.id).filter(Boolean))
)

const featured = computed(() => upcoming.value[0] || null)
const featuredKey = computed(() => featured.value ? featured.value.id : null)

const recs = computed(() => {
  const pool = upcoming.value.filter(a =>
    a.id !== featuredKey.value && !registeredIds.value.has(a.id)
  )
  return pool.slice(0, 5)
})

const pinnedIds = computed(() => {
  const ids = new Set()
  if (featured.value) ids.add(featured.value.id)
  recs.value.forEach(a => ids.add(a.id))
  return ids
})

const filteredUpcoming = computed(() => {
  let rows = upcoming.value.filter(a => !pinnedIds.value.has(a.id) && !registeredIds.value.has(a.id))

  const now = Date.now()
  const weekAhead = now + 7 * 86_400_000
  switch (discoverMode.value) {
    case 'for-you': {
      const mine = rows.filter(a => myClubIds.value.has(a.club_id))
      if (mine.length) rows = mine
      break
    }
    case 'this-week':
      rows = rows.filter(a => new Date(a.start_at).getTime() < weekAhead)
      break
    case 'beginner':
      rows = rows.filter(a => /beginner|chill|easy/i.test(`${a.description || ''} ${a.title || ''}`))
      break
    case 'trail':
      rows = rows.filter(a => /trail|mountain/i.test(`${a.description || ''} ${a.title || ''}`))
      break
    case 'nearby':
      rows = nearbyRows.value ?? []
      break
  }

  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    rows = rows.filter(a =>
      a.title?.toLowerCase().includes(q) ||
      a.club?.name?.toLowerCase().includes(q) ||
      a.meetup_name?.toLowerCase().includes(q)
    )
  }

  return rows
})

const activeRegs = computed(() => {
  const active = regs.value.filter(r => r.status !== 'cancelled')
  const now = new Date()
  const live = active.filter(r => {
    const a = r.activity
    if (!a) return false
    const wsOK = !a.checkin_window_start || new Date(a.checkin_window_start) <= now
    const weOK = !a.checkin_window_end || new Date(a.checkin_window_end) >= now
    return wsOK && weOK
  })
  return [...live, ...active.filter(r => !live.includes(r))].slice(0, 2)
})

function setFilter(mode) {
  discoverMode.value = mode
}

async function handleNearby() {
  discoverMode.value = 'nearby'
  nearbyRows.value = null
  try {
    const pos = await getCurrentPosition({ timeoutMs: 12_000 })
    const R = 15_000
    nearbyRows.value = upcoming.value
      .filter(a => a.meetup_lat != null && a.meetup_lng != null)
      .map(a => ({ a, d: haversineMeters(pos.lat, pos.lng, a.meetup_lat, a.meetup_lng) }))
      .filter(({ d }) => d <= R)
      .sort((x, y) => x.d - y.d)
      .map(({ a }) => a)
    if (!nearbyRows.value.length) {
      toast('No activities with a meetup pin within 15 km.')
    }
  } catch {
    toast('Could not read your location. Allow access or try again.', { kind: 'error' })
    nearbyRows.value = []
  }
}

function handleRefresh() {
  // Re-fetch data
  loadData()
}

async function loadData() {
  loading.value = true
  try {
    const [user, upcomingData, regsData] = await Promise.all([
      api.getCurrentUser(),
      api.listActivities({ timeframe: 'upcoming', status: 'published' }),
      api.listMyRegistrations({ timeframe: 'upcoming' }),
    ])
    const norm = (v) => String(v || '').trim().toLowerCase()
    const activityKey = (a) => [
      norm(a?.club_id), norm(a?.club?.name), norm(a?.title),
      norm(a?.start_at), norm(a?.meetup_name), norm(a?.meetup_lat), norm(a?.meetup_lng),
    ].join('||')
    const seenKeys = new Set()
    upcoming.value = upcomingData.filter((a) => {
      const key = activityKey(a)
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      return true
    })
    regs.value = regsData
    const memberships = await supabaseHelperMemberships(user.id)
    myClubIds.value = new Set(memberships || [])
  } catch (err) {
    toast(err.message, { kind: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div class="discover-view">
    <!-- Search -->
    <div class="search-pill" role="search">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input v-model="searchQuery" placeholder="Search clubs, activities, routes…" autocomplete="off" aria-label="Search clubs, activities, routes" />
    </div>

    <!-- Filter chips -->
    <div class="chip-row" role="tablist" aria-label="Filter">
      <button :class="['chip', discoverMode === 'for-you' ? 'brand' : 'ghost']" @click="setFilter('for-you')">
        <i class="fa-solid fa-fire"></i> For you
      </button>
      <button :class="['chip', discoverMode === 'nearby' ? 'brand' : 'ghost']" @click="handleNearby">
        <i class="fa-regular fa-compass"></i> Nearby
      </button>
      <button :class="['chip', discoverMode === 'this-week' ? 'brand' : 'ghost']" @click="setFilter('this-week')">
        <i class="fa-solid fa-calendar-week"></i> This week
      </button>
      <button :class="['chip', discoverMode === 'beginner' ? 'brand' : 'ghost']" @click="setFilter('beginner')">
        <i class="fa-solid fa-user-group"></i> Beginner
      </button>
      <button :class="['chip', discoverMode === 'trail' ? 'brand' : 'ghost']" @click="setFilter('trail')">
        <i class="fa-solid fa-mountain"></i> Trail
      </button>
    </div>

    <!-- My registrations -->
    <div class="section-title">
      <h2>My registrations</h2>
      <router-link class="link" to="/my-activities">See all <i class="fa-solid fa-chevron-right" style="font-size:10px"></i></router-link>
    </div>
    <div v-if="loading">
      <div v-for="n in 2" :key="n" class="card"><div class="skeleton" style="height:72px;border-radius:10px"></div></div>
    </div>
    <div v-else-if="activeRegs.length">
      <RegCard v-for="r in activeRegs" :key="r.activity_id" :registration="r" @refresh="handleRefresh" />
    </div>
    <div v-else class="empty">
      <i class="fa-regular fa-calendar-plus"></i>
      <h3>No upcoming registrations</h3>
      <p>Pick an activity below and tap Register.</p>
    </div>

    <!-- Featured activity -->
    <div class="section-title"><h2>Featured activity</h2></div>
    <FeaturedHero v-if="featured" :activity="featured" />
    <div v-else class="empty"><i class="fa-regular fa-star"></i><p>No featured activity yet.</p></div>

    <!-- Recommended -->
    <div class="section-title"><h2>Recommended for you</h2></div>
    <div v-if="recs.length" class="hscroll">
      <RecCard v-for="a in recs" :key="a.id" :activity="a" />
    </div>
    <div v-else class="empty" style="flex:1"><p>Check back later.</p></div>

    <!-- Upcoming activities -->
    <div class="section-title">
      <h2>Upcoming activities</h2>
      <span class="count">{{ filteredUpcoming.length }}</span>
    </div>
    <div v-if="filteredUpcoming.length" class="activity-grid">
      <ActivityCard v-for="a in filteredUpcoming" :key="a.id" :activity="a" />
    </div>
    <div v-else class="empty">
      <i class="fa-solid fa-clock"></i>
      <p>{{ searchQuery ? 'No matches for this filter and search.' : 'Nothing in this filter right now.' }}</p>
    </div>
  </div>
</template>
