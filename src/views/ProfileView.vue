<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'
import { fmtPace } from '@/utils/formatters'
import { tier } from '@/utils/helpers'
import { computeAchievements } from '@/utils/shared-helpers'
import Avatar from '@/components/Avatar.vue'

const DEFAULT_PROFILE_COVER_URL = 'https://images.unsplash.com/photo-1502810190503-8303352d0dd1?w=900&h=500&fit=crop'

const router = useRouter()
const { toast } = useToast()
const { confirm } = useModal()

const loading = ref(true)
const profile = ref(null)
const runs = ref([])
const user = ref(null)
const myRegs = ref([])
const myClubs = ref([])

const totalM = computed(() => runs.value.reduce((s, r) => s + (r.distance_m || 0), 0))
const totalS = computed(() => runs.value.reduce((s, r) => s + (r.duration_s || 0), 0))
const totalKm = computed(() => totalM.value / 1000)
const avgPace = computed(() => totalM.value ? Math.round((totalS.value * 1000) / totalM.value) : null)
const t = computed(() => tier(totalM.value))

const ownedClubs = computed(() => (myClubs.value || []).filter(c => c.owner_id === user.value?.id))
const isOrganizer = computed(() => ownedClubs.value.length > 0)
const handle = computed(() => user.value?.email ? '@' + user.value.email.split('@')[0] : '')
const upcomingCount = computed(() => (myRegs.value || []).length)
const achievements = computed(() => computeAchievements(runs.value))
const unlockedCount = computed(() => achievements.value.filter(a => a.unlocked).length)
const profileCoverUrl = computed(() => profile.value?.cover_url || DEFAULT_PROFILE_COVER_URL)

async function handleLogout() {
  if (!await confirm({ title: 'Log out of RunLink?', message: 'You can sign back in anytime.', confirmText: 'Log out', danger: true })) return
  await api.signOut()
  toast('Logged out')
}

function scrollToAchievements() {
  document.getElementById('achievements-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(async () => {
  try {
    const [p, r, u, reg, clubs] = await Promise.all([
      api.getMyProfile(),
      api.listMyRuns({ limit: 500 }),
      api.getCurrentUser(),
      api.listMyRegistrations({ timeframe: 'upcoming' }).catch(() => []),
      api.listClubs({ mineOnly: true }).catch(() => []),
    ])
    profile.value = p
    runs.value = r
    user.value = u
    myRegs.value = reg
    myClubs.value = clubs
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <div v-if="loading" class="card"><div class="skeleton" style="height:300px;border-radius:10px"></div></div>

    <template v-else>
      <!-- Dark hero banner -->
      <section class="profile-hero" :style="`--profile-cover-image:url('${profileCoverUrl}')`">
        <div class="hero-top">
          <div aria-hidden="true"></div>
          <div class="hero-actions">
            <button class="icon-btn" aria-label="Settings" @click="router.push('/profile/edit')">
              <i class="fa-solid fa-gear"></i>
            </button>
          </div>
        </div>

        <div class="profile-identity">
          <div class="av-wrap">
            <Avatar :profile="profile" size="lg" />
            <button class="edit" aria-label="Edit profile" @click="router.push('/profile/edit')">
              <i class="fa-solid fa-pen"></i>
            </button>
          </div>
          <div class="info">
            <h2>{{ profile?.display_name || 'Runner' }}</h2>
            <div class="bio">{{ profile?.bio || 'Tell your crew a little about you…' }}</div>
            <div class="chips">
              <span v-if="handle" class="chip">{{ handle }}</span>
              <span class="chip">{{ t.emoji }} {{ t.name }}</span>
              <span v-if="isOrganizer" class="chip"><i class="fa-solid fa-bolt"></i> Organizer</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Stats strip -->
      <div class="profile-stats-strip">
        <div class="stat-tile">
          <div class="v">{{ totalKm.toFixed(1) }}</div>
          <div class="l">Total km</div>
        </div>
        <div class="stat-tile">
          <div class="v">{{ runs.length }}</div>
          <div class="l">Runs</div>
        </div>
        <div class="stat-tile">
          <div class="v">{{ fmtPace(avgPace) }}</div>
          <div class="l">Avg pace</div>
        </div>
      </div>

      <!-- Quick action tiles -->
      <div class="tile-grid">
        <button class="tile" @click="router.push('/stats')">
          <span class="ico"><i class="fa-solid fa-chart-line"></i></span>
          <span class="lbl">Stats report</span>
        </button>
        <button class="tile" @click="scrollToAchievements">
          <span class="ico"><i class="fa-solid fa-medal"></i></span>
          <span class="lbl">Achievements</span>
        </button>
        <button class="tile" @click="router.push('/my-activities')">
          <span class="ico"><i class="fa-solid fa-flag-checkered"></i></span>
          <span class="lbl">My activities</span>
          <span v-if="upcomingCount" class="badge">{{ upcomingCount }}</span>
        </button>
        <button class="tile" @click="router.push('/clubs')">
          <span class="ico"><i class="fa-solid fa-people-group"></i></span>
          <span class="lbl">Clubs</span>
        </button>
      </div>

      <!-- Achievements -->
      <div class="section-title" style="margin-top:18px">
        <h2 id="achievements-anchor">Achievements</h2>
        <span class="count">{{ unlockedCount }} / {{ achievements.length }}</span>
      </div>
      <div class="ach-row">
        <div v-for="a in achievements" :key="a.key" :class="['ach-card', { locked: !a.unlocked }]" :title="a.name">
          <div :class="['ach-medal', a.unlocked ? a.medal : 'locked']">
            <i :class="`fa-solid ${a.unlocked ? a.icon : 'fa-lock'}`"></i>
          </div>
          <div class="name">{{ a.name }}</div>
          <div class="sub">{{ a.sub || '' }}</div>
        </div>
      </div>

      <!-- Organizer tools -->
      <template v-if="isOrganizer">
        <div class="section-title"><h2>Organizer tools</h2></div>
        <div class="pro-list">
          <button class="row" @click="router.push('/organizer/dashboard')">
            <i class="lead" style="background: #0EA5E9;"><i class="fa-solid fa-chart-simple"></i></i>
            <div class="meta">
              <div class="t">Activity dashboard</div>
              <div class="s">{{ ownedClubs.length }} club{{ ownedClubs.length > 1 ? 's' : '' }} · registration & check-in stats</div>
            </div>
            <i class="fa-solid fa-chevron-right chev"></i>
          </button>
          <button class="row" @click="ownedClubs.length === 1 ? router.push(`/club/${ownedClubs[0].id}/publish`) : router.push('/community')">
            <i class="lead" style="background: var(--brand);"><i class="fa-solid fa-plus"></i></i>
            <div class="meta">
              <div class="t">Publish activity</div>
              <div class="s">Create a new club activity with route upload</div>
            </div>
            <i class="fa-solid fa-chevron-right chev"></i>
          </button>
          <button class="row" @click="ownedClubs.length === 1 ? router.push(`/club/${ownedClubs[0].id}/manage`) : router.push('/clubs')">
            <i class="lead" style="background: #8B5CF6;"><i class="fa-solid fa-user-gear"></i></i>
            <div class="meta">
              <div class="t">Manage club</div>
              <div class="s">{{ ownedClubs.length }} club{{ ownedClubs.length > 1 ? 's' : '' }} · co-organizers · transfer · delete</div>
            </div>
            <i class="fa-solid fa-chevron-right chev"></i>
          </button>
        </div>
      </template>

      <!-- Preferences -->
      <div class="section-title"><h2>Preferences</h2></div>
      <div class="pro-list">
        <button class="row" @click="router.push('/profile/edit')">
          <i class="lead" style="background: var(--brand);"><i class="fa-solid fa-user-pen"></i></i>
          <div class="meta">
            <div class="t">Edit profile</div>
            <div class="s">Display name · bio · avatar</div>
          </div>
          <i class="fa-solid fa-chevron-right chev"></i>
        </button>
        <button class="row danger" @click="handleLogout">
          <i class="lead" style="background: var(--danger);"><i class="fa-solid fa-arrow-right-from-bracket"></i></i>
          <div class="meta"><div class="t">Log out</div></div>
          <i class="fa-solid fa-chevron-right chev"></i>
        </button>
      </div>

      <div style="height:24px"></div>
    </template>
  </div>
</template>
