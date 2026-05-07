<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'
import { useCheckinFlow } from '@/composables/useCheckinFlow'
import { fmtDate, fmtTime, fmtDistance, fmtPace } from '@/utils/formatters'
import { esc } from '@/utils/helpers'
import { CHECK_IN_RADIUS_M, EMOJI_PRESET } from '@/utils/shared-helpers'
import { createMap, addRouteGeoJson } from '@/utils/map'
import L from 'leaflet'
import Avatar from '@/components/Avatar.vue'

const route = useRoute()
const router = useRouter()
const { toast } = useToast()
const { confirm } = useModal()
const { runCheckinFlow } = useCheckinFlow()

const loading = ref(true)
const activity = ref(null)
const user = ref(null)
const reg = ref(null)
const counts = ref({ total: 0, byGroup: new Map() })

const selectedGroup = ref('')
const registering = ref(false)
const cancellingReg = ref(false)

// Reflections
const reflections = ref([])
const myEmoji = ref(null)
const reflNote = ref('')
const reflCountLive = ref(0)
const regGroupMap = ref(new Map())

let mapInstance = null

const isPast = computed(() => activity.value && new Date(activity.value.end_at) < new Date())
const isOwner = computed(() => activity.value?.club?.owner_id === user.value?.id)
const isCheckedIn = computed(() => reg.value?.status === 'checked_in' || reg.value?.status === 'late')
const isFull = computed(() => {
  const cap = activity.value?.total_cap
  return cap != null && counts.value.total >= cap
})
const registered = computed(() => !!reg.value && reg.value.status !== 'cancelled')
const canCancelReg = computed(() => reg.value?.status === 'registered' && new Date() < new Date(activity.value?.start_at))
const canPostReflection = computed(() => reg.value && (reg.value.status === 'checked_in' || reg.value.status === 'late'))

const stateChip = computed(() => {
  if (!activity.value) return { text: '', cls: '' }
  if (activity.value.status === 'cancelled') return { text: 'Cancelled', cls: 'danger' }
  if (isPast.value) return { text: 'Completed', cls: 'success' }
  if (isCheckedIn.value) return { text: `Checked in${reg.value?.status === 'late' ? ' · Late' : ''}`, cls: 'success' }
  if (registered.value) return { text: 'Registered', cls: 'brand' }
  if (isFull.value) return { text: 'Full', cls: 'danger' }
  return { text: 'Open', cls: 'accent' }
})

const coverBg = computed(() => {
  if (activity.value?.cover_url) return `url('${activity.value.cover_url}') center/cover`
  return 'linear-gradient(135deg,#F97316,#FB923C)'
})

const hasRouteImage = computed(() => activity.value?.route_file_kind === 'image' && activity.value?.route_file_url)
const hasRouteGeo = computed(() => !!activity.value?.route_geojson)

const sortedReflections = computed(() => {
  const uid = user.value?.id
  return [
    ...reflections.value.filter(r => r.user_id === uid),
    ...reflections.value.filter(r => r.user_id !== uid),
  ]
})

const emojiCounts = computed(() => {
  const c = Object.fromEntries(EMOJI_PRESET.map(e => [e, 0]))
  for (const r of reflections.value) {
    if (c[r.emoji] != null) c[r.emoji] += 1
  }
  return c
})

function groupUsed(name) {
  return counts.value.byGroup.get(name) ?? 0
}

function getReflectionGroup(userId) {
  return regGroupMap.value.get(userId) || null
}

function groupFull(g) {
  return g.cap != null && groupUsed(g.name) >= g.cap
}

async function loadData() {
  loading.value = true
  try {
    const id = route.params.id
    const [a, u, r, c] = await Promise.all([
      api.getActivity(id),
      api.getCurrentUser(),
      api.getMyRegistration(id),
      api.getRegistrationCounts(id).catch(() => ({ total: 0, byGroup: new Map() })),
    ])
    activity.value = a
    user.value = u
    reg.value = r
    counts.value = c
    if (a?.groups?.length && !selectedGroup.value) {
      selectedGroup.value = a.groups[0].name
    }
    if (a) await loadReflections()
  } finally {
    loading.value = false
    nextTick(initMap)
  }
}

async function loadReflections() {
  try {
    const [refls, regs] = await Promise.all([
      api.listActivityReflections(activity.value.id),
      api.listActivityRegistrations(activity.value.id).catch(() => []),
    ])
    reflections.value = refls
    const map = new Map()
    for (const r of regs) {
      if (r.user_id && r.group_name) map.set(r.user_id, r.group_name)
    }
    regGroupMap.value = map
    const existing = refls.find(r => r.user_id === user.value?.id)
    myEmoji.value = existing?.emoji || null
    reflNote.value = existing?.note || ''
    reflCountLive.value = reflNote.value.length
  } catch { reflections.value = [] }
}

async function initMap() {
  const el = document.getElementById('meetup-preview')
  if (!el || !activity.value?.meetup_lat) return
  try {
    const center = [activity.value.meetup_lat, activity.value.meetup_lng]
    mapInstance = await createMap(el, { center, zoom: 16 })
    L.marker(center, { title: activity.value.meetup_name || 'Meetup' }).addTo(mapInstance)
    L.circle(center, {
      radius: CHECK_IN_RADIUS_M,
      color: '#F97316', weight: 2, fillColor: '#F97316', fillOpacity: 0.14,
    }).addTo(mapInstance)
    if (activity.value.route_geojson) {
      await addRouteGeoJson(mapInstance, activity.value.route_geojson, {
        color: '#F97316', weight: 4, opacity: 0.9, fit: true, fitPadding: [24, 24],
      })
    }
  } catch { /* non-fatal */ }
}

async function handleRegister() {
  registering.value = true
  try {
    await api.register({ activityId: activity.value.id, groupName: selectedGroup.value || null })
    toast('Registered. See you there!', { kind: 'success' })
    await loadData()
  } catch (err) { toast(err.message, { kind: 'error' }) }
  finally { registering.value = false }
}

async function handleCancelReg() {
  if (!await confirm({ title: 'Cancel registration?', message: "You'll lose your spot. You can register again while capacity lasts.", confirmText: 'Yes, cancel', danger: true })) return
  cancellingReg.value = true
  try {
    await api.cancelRegistration(activity.value.id)
    toast('Registration cancelled', { kind: 'info' })
    await loadData()
  } catch (err) { toast(err.message, { kind: 'error' }) }
  finally { cancellingReg.value = false }
}

async function handleCancelActivity() {
  if (!await confirm({ title: 'Cancel this activity?', message: "All registrations will be notified. You can't undo this.", confirmText: 'Cancel activity', danger: true })) return
  try {
    await api.cancelActivity(activity.value.id)
    toast('Activity cancelled', { kind: 'success' })
    router.push('/discover')
  } catch (err) { toast(err.message, { kind: 'error' }) }
}

async function handleCheckin() {
  await runCheckinFlow(activity.value)
  await loadData()
}

async function toggleEmoji(emoji) {
  if (!canPostReflection.value) return
  const existing = reflections.value.find(r => r.user_id === user.value?.id)
  try {
    if (existing && existing.emoji === emoji) {
      const { supabase } = await import('@/lib/supabase')
      await supabase.from('reflections').delete().eq('activity_id', activity.value.id).eq('user_id', user.value.id)
    } else {
      await api.upsertReflection({
        activityId: activity.value.id,
        emoji,
        note: existing?.note || reflNote.value.trim(),
      })
    }
    await loadReflections()
  } catch (err) { toast(err.message, { kind: 'error' }) }
}

async function saveReflection() {
  const emoji = myEmoji.value || '💪'
  try {
    await api.upsertReflection({
      activityId: activity.value.id,
      emoji,
      note: reflNote.value.trim() || null,
    })
    toast('Reflection saved', { kind: 'success' })
    await loadReflections()
  } catch (err) { toast(err.message, { kind: 'error' }) }
}

onMounted(loadData)
onUnmounted(() => {
  if (mapInstance) { mapInstance.remove(); mapInstance = null }
})
</script>

<template>
  <div>
    <van-nav-bar title="Activity" left-arrow @click-left="router.back()" />

    <div v-if="loading"><div class="skeleton" style="height:220px;border-radius:18px"></div></div>

    <template v-else-if="activity">
      <article class="card" style="padding:0;overflow:hidden">
        <div :style="`aspect-ratio:2.2;background:${coverBg};position:relative`">
          <span v-if="registered && !isPast" class="chip success" style="position:absolute;top:12px;right:12px;box-shadow:var(--shadow-sm)">
            <i class="fa-solid fa-circle-check"></i> Registered
          </span>
        </div>
        <div style="padding:18px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <span :class="['chip', stateChip.cls]">{{ stateChip.text }}</span>
            <span v-if="activity.club" class="chip ghost"><i class="fa-regular fa-flag"></i>{{ activity.club.name }}</span>
            <span v-if="isOwner" class="chip brand"><i class="fa-solid fa-shield"></i>Organizer</span>
            <span v-if="activity.total_cap != null" class="chip ghost"><i class="fa-solid fa-users"></i>{{ counts.total }}/{{ activity.total_cap }}</span>
          </div>
          <h2 style="margin:0 0 8px;font-family:var(--font-display);color:var(--ink-900);font-size:26px;line-height:1.15">{{ activity.title }}</h2>
          <p style="color:var(--ink-700);font-size:14px;line-height:1.6;margin:0 0 14px">{{ activity.description || '' }}</p>

          <div class="stat-grid" style="margin-bottom:14px">
            <div class="stat"><div class="v">{{ new Date(activity.start_at).toLocaleDateString('en',{month:'short',day:'numeric'}) }}</div><div class="l">Date</div></div>
            <div class="stat"><div class="v">{{ fmtTime(activity.start_at) }}</div><div class="l">Start</div></div>
            <div class="stat"><div class="v">{{ fmtTime(activity.end_at) }}</div><div class="l">End</div></div>
          </div>

          <!-- Meetup card -->
          <div class="card card-compact" style="margin-top:0">
            <div style="font-weight:700"><i class="fa-solid fa-location-dot" style="color:var(--brand)"></i> {{ activity.meetup_name || 'Meetup' }}</div>
            <div style="color:var(--ink-500);font-size:12px;margin-top:4px">
              Check-in radius <b>{{ CHECK_IN_RADIUS_M }} m</b>
              <template v-if="activity.checkin_window_start"> · window {{ fmtTime(activity.checkin_window_start) }} → {{ fmtTime(activity.checkin_window_end || activity.start_at) }}</template>
            </div>
            <div id="meetup-preview" class="leaflet-map" style="margin-top:10px;height:180px"></div>
            <template v-if="registered && !isPast">
              <div v-if="isCheckedIn" class="chip success" style="margin-top:10px;display:inline-flex">
                <i class="fa-solid fa-circle-check"></i> Checked in{{ reg?.status === 'late' ? ' · Late' : '' }}
              </div>
            </template>
          </div>

          <!-- Route image -->
          <div v-if="hasRouteImage" class="card card-compact" style="margin-top:12px">
            <div style="font-weight:700"><i class="fa-solid fa-route" style="color:var(--brand)"></i> Route map</div>
            <div style="color:var(--ink-500);font-size:12px;margin-top:4px">
              Uploaded by the organizer{{ activity.route_file_name ? ` · ${activity.route_file_name}` : '' }}
            </div>
            <img :src="activity.route_file_url" alt="Route map" style="width:100%;margin-top:10px;border-radius:14px;border:1px solid var(--ink-100);display:block" />
          </div>

          <!-- Route geo -->
          <div v-if="hasRouteGeo" class="card card-compact" style="margin-top:12px">
            <div style="font-weight:700"><i class="fa-solid fa-route" style="color:var(--brand)"></i> Route file</div>
            <div style="color:var(--ink-500);font-size:12px;margin-top:4px">
              {{ activity.route_file_name || 'Uploaded route' }} · rendered directly on the map
            </div>
            <a v-if="activity.route_file_url" :href="activity.route_file_url" target="_blank" rel="noopener" style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;color:var(--brand);font-size:13px;font-weight:700;text-decoration:none">
              <i class="fa-solid fa-download"></i> Download source file
            </a>
          </div>

          <!-- Action area -->
          <div style="margin-top:18px">
            <!-- Cancelled -->
            <div v-if="activity.status === 'cancelled'" class="empty">
              <i class="fa-solid fa-ban"></i><h3>This activity was cancelled</h3><p>Keep an eye on your club for the next one.</p>
            </div>

            <!-- Past or checked-in: reflections -->
            <template v-else-if="isPast || isCheckedIn">
              <div class="section-title"><h2>Reflections</h2><span class="count">{{ reflections.length }}</span></div>
              <div class="emoji-row" role="group" aria-label="React">
                <button v-for="e in EMOJI_PRESET" :key="e" type="button"
                  :class="{ selected: myEmoji === e }" :disabled="!canPostReflection"
                  @click="toggleEmoji(e)" :aria-label="`React ${e}`">
                  <span>{{ e }}</span>
                  <span class="count">{{ emojiCounts[e] }}</span>
                </button>
              </div>
              <div v-if="!canPostReflection" class="card card-compact" style="background:var(--ink-50)">
                <i class="fa-regular fa-comment-dots" style="color:var(--ink-400)"></i>
                <span style="color:var(--ink-500);font-size:13px">Check in on Discover → My registrations to react and post a reflection.</span>
              </div>
              <template v-if="canPostReflection">
                <div class="field" style="margin-top:10px;margin-bottom:8px">
                  <label>Share how it felt (optional, ≤ 200 chars)</label>
                  <textarea v-model="reflNote" maxlength="200" placeholder="Pace, weather, the post-run coffee…" @input="reflCountLive = reflNote.length"></textarea>
                  <div class="hint">{{ reflCountLive }} / 200</div>
                </div>
                <button class="btn block" @click="saveReflection">
                  <i class="fa-solid fa-paper-plane"></i> {{ reflNote ? 'Update reflection' : 'Post reflection' }}
                </button>
              </template>
              <div style="margin-top:12px">
                <div v-for="r in sortedReflections" :key="r.id" class="card card-compact" :style="r.user_id === user?.id ? 'border-color: rgba(249,115,22,0.3)' : ''">
                  <div style="display:flex;align-items:center;gap:10px">
                    <Avatar :profile="r.user" size="sm" />
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;align-items:center;gap:6px">
                        <span style="font-weight:700;color:var(--ink-900)">{{ r.user?.display_name || 'Runner' }}</span>
                        <span v-if="r.user_id === user?.id" class="chip brand" style="padding:0 6px;font-size:10px">You</span>
                        <span v-if="getReflectionGroup(r.user_id)" class="chip ghost" style="padding:0 6px;font-size:10px">{{ getReflectionGroup(r.user_id) }}</span>
                      </div>
                      <div style="color:var(--ink-500);font-size:12px">{{ fmtDate(r.created_at) }}</div>
                    </div>
                    <div style="font-size:22px">{{ r.emoji }}</div>
                  </div>
                  <p v-if="r.note" style="margin:8px 0 0;color:var(--ink-700);font-size:13.5px;line-height:1.5">{{ r.note }}</p>
                </div>
                <div v-if="!sortedReflections.length" class="empty">
                  <i class="fa-regular fa-comment-dots"></i><h3>Be the first to share</h3><p>How did this activity feel?</p>
                </div>
              </div>
            </template>

            <!-- Not registered -->
            <template v-else-if="!registered">
              <div v-if="isFull" class="empty" style="margin-bottom:12px">
                <i class="fa-solid fa-users"></i><h3>This activity is full</h3><p>Cancellations release seats on a first-come basis.</p>
              </div>
              <form @submit.prevent="handleRegister">
                <div v-if="activity.groups?.length" style="margin-bottom:12px">
                  <div style="font-weight:700;color:var(--ink-900);margin-bottom:8px">Pick a group</div>
                  <label v-for="(g, i) in activity.groups" :key="g.name" class="card card-compact"
                    style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-top:8px">
                    <input type="radio" name="group" :value="g.name" v-model="selectedGroup" :disabled="groupFull(g)" style="accent-color:var(--brand)" />
                    <div style="flex:1">
                      <div style="font-weight:700;color:var(--ink-900)">{{ g.name }}</div>
                      <div v-if="g.cap != null" style="color:var(--ink-500);font-size:12px">{{ groupUsed(g.name) }}/{{ g.cap }}{{ groupFull(g) ? ' · Full' : '' }}</div>
                    </div>
                    <span v-if="groupFull(g)" class="chip danger">Full</span>
                  </label>
                </div>
                <button class="btn block lg" type="submit" :disabled="isFull || registering">
                  <i class="fa-solid fa-right-to-bracket"></i> {{ registering ? 'Registering…' : 'Register' }}
                </button>
              </form>
            </template>

            <!-- Registered (info-only per PRD 4.2.b) -->
            <template v-else>
              <div class="card card-compact" :style="`background:${isCheckedIn ? 'var(--accent-soft)' : 'var(--brand-soft)'};border-color:${isCheckedIn ? 'rgba(34,197,94,0.35)' : 'rgba(249,115,22,0.35)'}`">
                <div :style="`color:${isCheckedIn ? 'var(--accent-dark)' : 'var(--brand-dark)'};font-weight:700`">
                  <i class="fa-solid fa-circle-check"></i>
                  <template v-if="isCheckedIn">You're checked in{{ reg?.status === 'late' ? ' · Late' : '' }}.</template>
                  <template v-else>You're registered{{ reg?.group_name ? ` in ${reg.group_name}` : '' }}.</template>
                </div>
                <div style="color:var(--ink-500);font-size:12.5px;margin-top:6px">
                  <template v-if="isCheckedIn">Check in and run from My registrations.</template>
                  <template v-else>Check in happens on Discover — open My registrations when you arrive.</template>
                </div>
              </div>
              <button class="btn block" style="margin-top:12px" @click="router.push('/my-activities')">
                <i class="fa-regular fa-calendar"></i> View in My registrations
              </button>
              <button v-if="canCancelReg" class="btn ghost block" style="margin-top:8px" :disabled="cancellingReg" @click="handleCancelReg">
                <i class="fa-solid fa-ban"></i> {{ cancellingReg ? 'Cancelling…' : 'Cancel registration' }}
              </button>
            </template>
          </div>
        </div>
      </article>

      <!-- Organizer tools -->
      <template v-if="isOwner && activity.status !== 'cancelled'">
        <div class="section-title"><h2>Organizer tools</h2></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="btn ghost" @click="router.push(`/activity/${activity.id}/dashboard`)"><i class="fa-solid fa-chart-simple"></i> Dashboard</button>
          <button class="btn ghost" @click="handleCancelActivity"><i class="fa-solid fa-ban"></i> Cancel activity</button>
        </div>
      </template>
    </template>

    <div v-else class="empty">
      <i class="fa-solid fa-circle-exclamation"></i><h3>Not found</h3><p>This activity no longer exists.</p>
    </div>
  </div>
</template>
