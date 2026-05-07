<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'
import { fmtDistance } from '@/utils/formatters'
import { tier } from '@/utils/helpers'
import { computeAchievements } from '@/utils/shared-helpers'
import ActivityCard from '@/components/ActivityCard.vue'
import Avatar from '@/components/Avatar.vue'

const route = useRoute()
const router = useRouter()
const { toast } = useToast()
const { confirm } = useModal()

const loading = ref(true)
const clubs = ref([])
const activeClub = ref(null)
const user = ref(null)
const activities = ref([])
const leaderboard = ref([])
const lastMonthLeaderboard = ref([])
const showLastMonth = ref(false)
const challenges = ref([])
const members = ref([])

const isOwner = computed(() => activeClub.value?.owner_id === user.value?.id)

const showOverflow = ref(false)
const overflowActions = computed(() => {
  if (isOwner.value) return []
  return [{ name: 'Leave club', className: 'leave-action' }]
})

async function onOverflowSelect(action) {
  if (action.name === 'Leave club') await handleLeave()
}

async function handleLeave() {
  if (!await confirm({
    title: 'Leave this club?',
    message: "Your past runs and achievements are kept. You can rejoin anytime by registering for an activity or tapping Join on the club page.",
    confirmText: 'Leave',
    danger: true,
  })) return
  try {
    await api.leaveClub(activeClub.value.id)
    toast('Left the club')
    await loadData()
  } catch (err) {
    toast(err.message, { kind: 'error' })
  }
}

async function loadData() {
  loading.value = true
  try {
    const [c, u] = await Promise.all([
      api.listClubs({ mineOnly: true }),
      api.getCurrentUser(),
    ])
    clubs.value = c
    user.value = u

    if (!c.length) { loading.value = false; return }

    // Pick active club from query or first
    const queryClub = route.query.club
    activeClub.value = c.find(cl => cl.id === queryClub) || c[0]

    const now = new Date()
    const thisMonth = now.toISOString().slice(0, 7) + '-01'
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10)

    const [acts, lb, lbLast, ch, mem] = await Promise.all([
      api.listActivities({ clubId: activeClub.value.id, timeframe: 'upcoming' }),
      api.listLeaderboard({ clubId: activeClub.value.id, month: thisMonth }),
      api.listLeaderboard({ clubId: activeClub.value.id, month: lastMonth }),
      api.listChallenges({ clubId: activeClub.value.id }),
      api.listClubMembers(activeClub.value.id),
    ])

    // Deduplicate activities
    const seen = new Set()
    activities.value = acts.filter(a => {
      const key = `${a.club_id}|${a.title}|${a.start_at}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    leaderboard.value = lb
    lastMonthLeaderboard.value = lbLast
    challenges.value = ch
    members.value = mem
  } finally {
    loading.value = false
  }
}

const lastMonthMap = computed(() => {
  const map = new Map()
  for (const r of lastMonthLeaderboard.value) map.set(r.user_id, r.total_distance_m)
  return map
})

const displayLeaderboard = computed(() =>
  showLastMonth.value ? lastMonthLeaderboard.value : leaderboard.value
)

const activeChallenges = computed(() =>
  challenges.value.filter(c => !c.achieved_at && !c.is_expired)
)

function challengePct(c) {
  return c.goal_value > 0 ? Math.min(100, Math.round(c.current_value / c.goal_value * 100)) : 0
}

function challengeGoalLabel(c) {
  return c.goal_type === 'distance_total'
    ? `${(c.current_value / 1000).toFixed(1)} / ${(c.goal_value / 1000).toFixed(0)} km`
    : `${c.current_value} / ${c.goal_value} runners`
}

function challengeDaysLeft(c) {
  return Math.max(0, Math.ceil((new Date(c.end_at).getTime() - Date.now()) / 86400000))
}

async function deleteChallenge(ch) {
  if (!await confirm({ title: 'Delete this challenge?', message: 'This cannot be undone.', confirmText: 'Delete', danger: true })) return
  try {
    await api.deleteChallenge(ch.challenge_id)
    toast('Challenge deleted')
    await loadData()
  } catch (err) {
    toast(err.message, { kind: 'error' })
  }
}

const showChallengeForm = ref(false)
const challengeTitle = ref('')
const challengeGoalType = ref('distance_total')
const challengeGoalValue = ref('')
const creatingChallenge = ref(false)

async function handleCreateChallenge() {
  if (!challengeTitle.value.trim() || !challengeGoalValue.value) return
  creatingChallenge.value = true
  try {
    const now = new Date()
    const startAt = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const endAt = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
    await api.createChallenge({
      clubId: activeClub.value.id,
      title: challengeTitle.value.trim(),
      goalType: challengeGoalType.value,
      goalValue: Number(challengeGoalValue.value),
      startAt,
      endAt,
    })
    toast('Challenge created!', { kind: 'success' })
    showChallengeForm.value = false
    challengeTitle.value = ''
    challengeGoalValue.value = ''
    await loadData()
  } catch (err) {
    toast(err.message, { kind: 'error' })
  } finally {
    creatingChallenge.value = false
  }
}

watch(() => route.query.club, () => {
  if (route.query.club && clubs.value.length) loadData()
})

onMounted(loadData)
</script>

<template>
  <div>
    <!-- Empty state -->
    <div v-if="!loading && !clubs.length" class="empty" style="margin-top:20px">
      <i class="fa-solid fa-people-group"></i>
      <h3>Find your people</h3>
      <p>Join a public club or create your own to unlock activities, albums, and monthly rankings.</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn" @click="router.push('/clubs')">Browse nearby clubs</button>
        <button class="btn ghost" @click="router.push('/clubs')">Create your own</button>
      </div>
    </div>

    <div v-else-if="loading" class="card"><div class="skeleton" style="height:300px;border-radius:10px"></div></div>

    <template v-else-if="activeClub">
      <!-- Club header -->
      <div class="club-header">
        <div class="crest" :style="`background-image:url('${activeClub.crest_url || ''}')`"></div>
        <div style="flex:1;min-width:0">
          <div class="name">{{ activeClub.name }}</div>
          <div class="sub">{{ activeClub.description || '' }}</div>
        </div>
        <button v-if="!isOwner" class="icon-btn neutral" @click="showOverflow = true" title="More options" aria-label="More options">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>
        <button class="icon-btn neutral" @click="router.push('/clubs')" title="Switch club" aria-label="Switch club">
          <i class="fa-solid fa-repeat"></i>
        </button>
      </div>

      <van-action-sheet
        v-model:show="showOverflow"
        :actions="overflowActions"
        cancel-text="Cancel"
        @select="onOverflowSelect"
      />

      <!-- Activities -->
      <div class="section-title">
        <h2>Activities</h2>
        <button v-if="isOwner" class="link" @click="router.push(`/club/${activeClub.id}/publish`)">＋ New</button>
      </div>
      <div v-if="activities.length">
        <ActivityCard v-for="a in activities" :key="a.id" :activity="a" />
      </div>
      <div v-else class="empty"><i class="fa-regular fa-calendar"></i><p>No upcoming activities in this club.</p></div>

      <!-- Leaderboard -->
      <div class="section-title">
        <h2>Monthly mileage</h2>
        <button class="link" @click="showLastMonth = !showLastMonth">
          {{ showLastMonth ? 'This month' : 'Last month' }}
        </button>
      </div>
      <div v-if="displayLeaderboard.length">
        <div v-for="(r, i) in displayLeaderboard" :key="r.user_id" :class="['leader-row', { me: r.user_id === user?.id }]">
          <div :class="['rank', `rank-${Math.min(i + 1, 3)}`]">{{ i + 1 }}</div>
          <div class="who">
            <Avatar :profile="r" size="sm" />
            <div class="name">{{ r.display_name || 'Runner' }}{{ r.user_id === user?.id ? ' (you)' : '' }}</div>
            <span class="trophy" :title="tier(r.total_distance_m).name">{{ tier(r.total_distance_m).emoji }}</span>
          </div>
          <div style="text-align:right">
            <div class="dist">{{ (r.total_distance_m / 1000).toFixed(1) }} km</div>
            <div v-if="!showLastMonth && lastMonthMap.has(r.user_id)" style="font-size:11px;margin-top:2px" :style="`color:${r.total_distance_m >= lastMonthMap.get(r.user_id) ? 'var(--accent)' : 'var(--danger)'}`">
              {{ r.total_distance_m >= lastMonthMap.get(r.user_id) ? '+' : '' }}{{ ((r.total_distance_m - lastMonthMap.get(r.user_id)) / 1000).toFixed(1) }} vs last mo
            </div>
          </div>
        </div>
      </div>
      <div v-else class="empty"><i class="fa-solid fa-medal"></i><p>{{ showLastMonth ? 'No runs last month.' : 'No runs logged yet this month.' }}</p></div>

      <!-- Challenges -->
      <div class="section-title">
        <h2>Challenges</h2>
        <span class="count">{{ activeChallenges.length }} active</span>
        <button v-if="isOwner && !activeChallenges.length" class="link" @click="showChallengeForm = true">＋ New</button>
      </div>
      <div v-if="challenges.length">
        <div
          v-for="c in challenges" :key="c.challenge_id"
          :class="['card', 'challenge-card', { achieved: !!c.achieved_at, expired: c.is_expired && !c.achieved_at }]"
          @click="isOwner ? deleteChallenge(c) : null"
        >
          <div class="challenge-header">
            <div class="challenge-title">{{ c.title }}</div>
            <span v-if="c.achieved_at" class="chip accent"><i class="fa-solid fa-trophy"></i> Achieved</span>
            <span v-else-if="c.is_expired" class="chip">Expired</span>
            <span v-else class="chip info">{{ challengeDaysLeft(c) }}d left</span>
          </div>
          <div class="challenge-bar-wrap">
            <div class="challenge-bar" :style="`width:${challengePct(c)}%`"></div>
          </div>
          <div class="challenge-meta">
            <span>{{ challengeGoalLabel(c) }}</span>
            <span>{{ challengePct(c) }}%</span>
          </div>
        </div>
      </div>
      <div v-else class="empty"><i class="fa-solid fa-flag-checkered"></i><p>No challenges yet.</p></div>

      <!-- Challenge creation popup -->
      <van-popup v-model:show="showChallengeForm" position="bottom" round style="padding:20px">
        <h3>New monthly challenge</h3>
        <div class="field" style="margin-top:12px">
          <label>Title</label>
          <input v-model="challengeTitle" maxlength="60" placeholder="e.g. May Mileage Push" />
        </div>
        <div class="field" style="margin-top:10px">
          <label>Goal type</label>
          <div style="display:flex;gap:8px">
            <button :class="['btn sm', challengeGoalType === 'distance_total' ? '' : 'ghost']" @click="challengeGoalType = 'distance_total'">Distance (km)</button>
            <button :class="['btn sm', challengeGoalType === 'runner_count' ? '' : 'ghost']" @click="challengeGoalType = 'runner_count'">Runner count</button>
          </div>
        </div>
        <div class="field" style="margin-top:10px">
          <label>{{ challengeGoalType === 'distance_total' ? 'Target distance (km)' : 'Target runner count' }}</label>
          <input v-model="challengeGoalValue" type="number" min="1" :placeholder="challengeGoalType === 'distance_total' ? 'e.g. 500' : 'e.g. 10'" />
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn ghost block" @click="showChallengeForm = false">Cancel</button>
          <button class="btn block" :disabled="!challengeTitle.trim() || !challengeGoalValue || creatingChallenge" @click="handleCreateChallenge">
            {{ creatingChallenge ? 'Creating…' : 'Create challenge' }}
          </button>
        </div>
      </van-popup>

      <!-- Members -->
      <div class="section-title"><h2>Members</h2><span class="count">{{ members.length }}</span></div>
      <div class="card card-compact" style="display:flex;flex-wrap:wrap;gap:8px">
        <div v-for="m in members" :key="m.profile?.id" style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;background:var(--ink-100);border-radius:999px;max-width:180px">
          <Avatar :profile="m.profile" size="sm" />
          <span style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ m.profile?.display_name || 'Runner' }}</span>
          <span v-if="m.role !== 'member'" class="chip brand" style="padding:0 8px;font-size:10px;flex-shrink:0">{{ m.role.replace('_',' ') }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
