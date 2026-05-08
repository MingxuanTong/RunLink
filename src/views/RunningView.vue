<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/composables/useToast'
import { useRunRecorder } from '@/composables/useRunRecorder'
import { fmtDistance, fmtDuration, fmtPace, fmtTime } from '@/utils/formatters'
import { esc } from '@/utils/helpers'
import { CHECK_IN_RADIUS_M } from '@/utils/shared-helpers'
import { createMap, addRouteGeoJson } from '@/utils/map'
import { useFullscreenTab } from '@/composables/useFullscreenTab'
import L from 'leaflet'
import Avatar from '@/components/Avatar.vue'

const router = useRouter()
const { toast } = useToast()
const { enterFullscreen, exitFullscreen } = useFullscreenTab()

// --- Phase: preview / recording / none ---
const phase = ref('loading') // loading | preview | recording | none

// --- Activity link ---
const pickable = ref([])
const linkedActivity = ref(null)
const showRoutePicker = ref(false)

// --- Preview map state ---
let previewMap = null

// --- Recording state ---
const runStartedAt = ref(null)
const runDurationS = ref(0)
const runDistanceM = ref(0)
const runPaused = ref(false)
const useMock = ref(false)
const endHoldMs = 1200
const endHoldProgress = ref(0)
const endHoldActive = ref(false)
const gpsStatus = ref('Locating…')

const { recorder, createRecorder, start: startGPS, stop: stopRecorder, recenter, zoomIn, zoomOut, simulateStep, getDistanceMeters, getPoints, getPolyline } = useRunRecorder()

let timer = null
let endHoldTimer = null
let endHoldInterval = null
let crewChannel = null
let crewMarkers = new Map()
const crewMembers = ref([])
const crewExpanded = ref(false)
const user = ref(null)

// --- Crew demo mode ---
const crewDemo = ref(false)
let crewDemoInterval = null
let demoRouteCoords = null // array of [lng, lat] from the route GeoJSON
const MOCK_CREW = [
  { user_id: 'demo-alex',  user: { display_name: 'Alex Chen',   avatar_url: null } },
  { user_id: 'demo-sam',   user: { display_name: 'Sam Rivera',  avatar_url: null } },
  { user_id: 'demo-jordan',user: { display_name: 'Jordan Lee',  avatar_url: null } },
  { user_id: 'demo-morgan',user: { display_name: 'Morgan Wu',   avatar_url: null } },
  { user_id: 'demo-taylor',user: { display_name: 'Taylor Kim',  avatar_url: null } },
]
// Each crew member has a routeIndex (position along the route) and pace offset
const mockCrewState = new Map()

// --- Preview stats ---
const previewDistance = ref('0.00')
const previewPace = ref("—'—\"")
const previewDuration = ref('0:00')
const previewCal = ref('—')

// --- Recording computed ---
const runDistanceDisplay = computed(() => fmtDistance(runDistanceM.value))
const runDurationDisplay = computed(() => fmtDuration(runDurationS.value))
const runPaceDisplay = computed(() => {
  if (runDistanceM.value <= 50) return "—'—\""
  return fmtPace(Math.round((runDurationS.value * 1000) / runDistanceM.value))
})
const runCalDisplay = computed(() => {
  if (runDistanceM.value <= 0) return '—'
  return String(Math.round(runDistanceM.value * 0.06))
})

async function loadPreview() {
  phase.value = 'loading'
  try {
    const regs = await api.listMyRegistrations({ timeframe: 'upcoming' })
    pickable.value = regs
      .filter(r => (r.status === 'checked_in' || r.status === 'late') && r.activity)
      .map(r => r.activity)
    if (!linkedActivity.value && pickable.value.length) {
      linkedActivity.value = pickable.value[0]
    }
    phase.value = 'preview'
    nextTick(initPreviewMap)
  } catch { phase.value = 'preview' }
}

async function initPreviewMap() {
  const el = document.getElementById('run-map')
  if (!el) return
  try {
    const activity = linkedActivity.value
    const center = activity?.meetup_lat ? [activity.meetup_lat, activity.meetup_lng] : undefined
    previewMap = await createMap(el, {
      center, zoom: center ? 16 : 13, theme: 'dark',
      zoomControl: false, attributionControl: false,
    })
    if (activity?.meetup_lat) {
      L.marker(center, { title: activity.meetup_name || 'Meetup' })
        .addTo(previewMap).bindPopup(activity.meetup_name || 'Meetup')
      L.circle(center, {
        radius: CHECK_IN_RADIUS_M,
        color: '#22C55E', weight: 1.5, dashArray: '4 4',
        fillColor: '#22C55E', fillOpacity: 0.10,
      }).addTo(previewMap)
    } else {
      try {
        const pos = await new Promise((r, j) => navigator.geolocation.getCurrentPosition(
          p => r({ lat: p.coords.latitude, lng: p.coords.longitude }), j,
          { enableHighAccuracy: false, timeout: 5000 }))
        previewMap.setView([pos.lat, pos.lng], 15)
        L.circleMarker([pos.lat, pos.lng], {
          radius: 7, color: '#fff', weight: 2, fillColor: '#F97316', fillOpacity: 1,
        }).addTo(previewMap)
      } catch { /* keep default */ }
    }
    if (activity?.route_geojson) {
      await addRouteGeoJson(previewMap, activity.route_geojson, {
        color: '#FB923C', weight: 5, opacity: 0.9, fit: true, fitPadding: [28, 28],
      })
    }
  } catch (err) {
    el.innerHTML = `<div class="empty" style="border:0;background:transparent;color:rgba(255,255,255,0.7)"><i class="fa-solid fa-map"></i><p>${esc(err.message)}</p></div>`
  }
}

function probeGps() {
  if (!('geolocation' in navigator)) { gpsStatus.value = 'GPS unavailable'; return }
  navigator.geolocation.getCurrentPosition(
    () => { gpsStatus.value = 'GPS ready' },
    () => { gpsStatus.value = 'GPS waiting…' },
    { enableHighAccuracy: false, timeout: 4000 },
  )
}

function pickRoute(a) {
  linkedActivity.value = a
  showRoutePicker.value = false
  if (previewMap) { previewMap.remove(); previewMap = null }
  nextTick(initPreviewMap)
}

function clearRoute() {
  linkedActivity.value = null
  if (previewMap) { previewMap.remove(); previewMap = null }
  nextTick(initPreviewMap)
}

async function startCrewDemo() {
  // Fetch the 西浦落日跑 route from Supabase
  let routeGeoJson = null
  let center = { lat: 31.2781, lng: 120.7377 } // fallback: first point of route
  try {
    const { data } = await supabase
      .from('activities')
      .select('route_geojson')
      .eq('title', '西浦落日跑')
      .not('route_geojson', 'is', null)
      .limit(1)
      .single()
    if (data?.route_geojson) {
      routeGeoJson = data.route_geojson
      const coords = routeGeoJson?.features?.[0]?.geometry?.coordinates
      if (coords?.length) {
        demoRouteCoords = coords
        center = { lat: coords[0][1], lng: coords[0][0] }
      }
    }
  } catch { /* use fallback center */ }

  // Create a fake linked activity with the real route
  crewDemo.value = true
  linkedActivity.value = {
    id: 'demo-activity',
    title: '西浦落日跑',
    club: { name: 'XJTLU Running', display_name: 'XJTLU Running' },
    meetup_lat: center.lat,
    meetup_lng: center.lng,
    meetup_name: '文星广场',
    start_at: new Date().toISOString(),
    group_name: null,
    route_geojson: routeGeoJson,
  }
  // Initialize mock crew — each starts near the route beginning with different paces
  MOCK_CREW.forEach((m, i) => {
    mockCrewState.set(m.user_id, {
      routeIndex: 0,          // current position along the route
      paceOffset: (i - 2) * 3, // stagger: -6, -3, 0, +3, +6 steps different
      jitterLat: 0,           // small lateral offset to avoid overlap
      jitterLng: 0,
    })
    // Spread initial positions slightly
    const st = mockCrewState.get(m.user_id)
    st.jitterLat = (Math.random() - 0.5) * 0.00008
    st.jitterLng = (Math.random() - 0.5) * 0.00008
  })
  nextTick(() => startRun())
}

async function locatePreview() {
  if (!previewMap) return
  try {
    const pos = await new Promise((r, j) => navigator.geolocation.getCurrentPosition(
      p => r({ lat: p.coords.latitude, lng: p.coords.longitude }), j,
      { enableHighAccuracy: true, timeout: 7000 }))
    previewMap.setView([pos.lat, pos.lng], 16, { animate: true })
  } catch { toast('Could not locate you.', { kind: 'warn' }) }
}

// --- Start run ---
async function startRun() {
  if (previewMap) { previewMap.remove(); previewMap = null }
  phase.value = 'recording'
  enterFullscreen()
  runStartedAt.value = new Date()
  runDurationS.value = 0
  runDistanceM.value = 0
  runPaused.value = false
  useMock.value = false

  await nextTick()

  const activity = linkedActivity.value
  const meetup = activity?.meetup_lat != null
    ? { lat: activity.meetup_lat, lng: activity.meetup_lng } : null

  // Realtime crew broadcast (or demo mock)
  if (activity) {
    if (crewDemo.value) {
      user.value = { id: 'demo-you' }
      crewMembers.value = [
        { user_id: 'demo-you', user: { display_name: 'You' } },
        ...MOCK_CREW,
      ]
      crewExpanded.value = true
    } else {
      try {
        user.value = await api.getCurrentUser()
        crewChannel = api.createRunChannel(activity.id)
        api.onCrewPosition(crewChannel, ({ userId, lat, lng }) => {
          updateCrewMarker(userId, lat, lng)
        })
      } catch { /* non-fatal */ }
    }
  }

  // Create recorder
  const mapEl = document.getElementById('run-map')
  try {
    createRecorder(mapEl, {
      meetup,
      radius: CHECK_IN_RADIUS_M,
      theme: 'dark',
      routeGeoJson: activity?.route_geojson || null,
      onPositionUpdate: !crewDemo.value && activity && crewChannel && user.value ? ({ lat, lng }) => {
        if (!runPaused.value) {
          api.broadcastPosition(crewChannel, { userId: user.value.id, lat, lng })
        }
      } : undefined,
    })
  } catch { toast('Map failed to load — recording a time-only run.', { kind: 'warn' }) }

  // Error handler for recorder
  let simulateNoticeShown = false
  const switchToMock = (reason) => {
    if (useMock.value) return
    useMock.value = true
    if (!simulateNoticeShown) {
      simulateNoticeShown = true
      toast(`${reason} — simulating the run.`, { kind: 'warn' })
    }
  }

  try {
    recorder.value?.start({
      onError: (err) => {
        if (getPoints().length === 0) {
          switchToMock(
            err?.code === 1 ? 'Location permission denied'
            : err?.code === 3 ? 'Location timed out'
            : 'Location unavailable'
          )
        }
      },
    })
  } catch (err) { switchToMock(err.message || 'No GPS') }

  // Timer
  timer = setInterval(() => {
    if (runPaused.value) return
    runDurationS.value += 1

    if (useMock.value) {
      simulateStep()
      runDistanceM.value = getDistanceMeters() ?? (runDistanceM.value + 3.2)
    } else {
      runDistanceM.value = getDistanceMeters()
      if (runDurationS.value >= 12 && getPoints().length === 0) {
        switchToMock('No GPS fix after 12 s')
      }
    }

    // Demo crew movement — every 2 seconds, advance each crew member along the route
    if (crewDemo.value && runDurationS.value % 2 === 0 && demoRouteCoords) {
      const map = recorder.value?.map
      if (map) {
        const maxIdx = demoRouteCoords.length - 1
        mockCrewState.forEach((state, id) => {
          // Advance along route: base 3 steps + pace offset
          const advance = Math.max(1, 3 + state.paceOffset + Math.floor(Math.random() * 2))
          state.routeIndex = Math.min(maxIdx, state.routeIndex + advance)
          const pt = demoRouteCoords[state.routeIndex]
          // Small jitter to avoid stacking, refresh each move
          state.jitterLat += (Math.random() - 0.5) * 0.00003
          state.jitterLng += (Math.random() - 0.5) * 0.00003
          // Clamp jitter to ~3m
          state.jitterLat = Math.max(-0.00003, Math.min(0.00003, state.jitterLat))
          state.jitterLng = Math.max(-0.00003, Math.min(0.00003, state.jitterLng))
          updateCrewMarker(id, pt[1] + state.jitterLat, pt[0] + state.jitterLng)
        })
      }
    }
  }, 1000)

  // Crew polling (skip in demo — members already set)
  if (activity && !crewDemo.value) refreshCrew()
}

function getCrewMemberName(userId) {
  const member = crewMembers.value.find(m => m.user_id === userId)
  return member?.user?.display_name || 'Runner'
}

function updateCrewMarker(userId, lat, lng) {
  const map = recorder.value?.map
  if (!map) return
  let entry = crewMarkers.get(userId)
  if (!entry) {
    const name = getCrewMemberName(userId)
    const marker = L.circleMarker([lat, lng], {
      radius: 7, weight: 2, color: '#fff',
      fillColor: '#3B82F6', fillOpacity: 1,
    }).addTo(map)
    marker.bindTooltip(name, {
      permanent: true,
      direction: 'top',
      offset: [0, -10],
      className: 'crew-marker-label',
    })
    entry = { marker, timeout: null }
    crewMarkers.set(userId, entry)
  } else {
    entry.marker.setLatLng([lat, lng])
  }
  if (entry.timeout) clearTimeout(entry.timeout)
  entry.timeout = setTimeout(() => {
    map.removeLayer(entry.marker)
    crewMarkers.delete(userId)
  }, 60000)
}

let crewRefreshInterval = null
async function refreshCrew() {
  const activity = linkedActivity.value
  if (!activity) return
  try {
    const members = await api.listCrewMembers({
      activityId: activity.id,
      groupName: activity.group_name || null,
    })
    crewMembers.value = members
  } catch { /* silent */ }
  crewRefreshInterval = setTimeout(refreshCrew, 30000)
}

function togglePause() {
  runPaused.value = !runPaused.value
  toast(runPaused.value ? 'Paused' : 'Resumed', { kind: 'info' })
}

function markLap() {
  toast(`Lap @ ${fmtDistance(runDistanceM.value)}`, { kind: 'info' })
}

function resetEndHold() {
  endHoldActive.value = false
  endHoldProgress.value = 0
  if (endHoldTimer) {
    clearTimeout(endHoldTimer)
    endHoldTimer = null
  }
  if (endHoldInterval) {
    clearInterval(endHoldInterval)
    endHoldInterval = null
  }
}

function startEndHold() {
  if (endHoldActive.value) return
  endHoldActive.value = true
  endHoldProgress.value = 0
  const startedAt = Date.now()

  endHoldInterval = setInterval(() => {
    endHoldProgress.value = Math.min((Date.now() - startedAt) / endHoldMs, 1)
  }, 16)

  endHoldTimer = setTimeout(async () => {
    resetEndHold()
    await stopRun()
  }, endHoldMs)
}

function cancelEndHold() {
  if (!endHoldActive.value) return
  resetEndHold()
}

async function stopRun() {
  resetEndHold()
  if (timer) { clearInterval(timer); timer = null }
  if (crewRefreshInterval) { clearTimeout(crewRefreshInterval); crewRefreshInterval = null }
  if (crewDemoInterval) { clearInterval(crewDemoInterval); crewDemoInterval = null }
  stopRecorder()
  if (crewChannel) { api.removeRunChannel(crewChannel); crewChannel = null }
  crewMarkers.forEach(entry => {
    if (entry.timeout) clearTimeout(entry.timeout)
    recorder.value?.map?.removeLayer(entry.marker)
  })
  crewMarkers.clear()
  mockCrewState.clear()
  demoRouteCoords = null
  crewDemo.value = false
  exitFullscreen()

  const snap = {
    distance_m: runDistanceM.value,
    duration_s: runDurationS.value,
    startedAt: runStartedAt.value,
    activity: linkedActivity.value,
  }

  if (snap.distance_m < 100) {
    toast('Run too short, discarded.', { kind: 'warn' })
    phase.value = 'preview'
    nextTick(() => { initPreviewMap(); probeGps() })
    return
  }

  try {
    await api.saveRun({
      activityId: snap.activity?.id ?? null,
      distance_m: Math.round(snap.distance_m),
      duration_s: snap.duration_s,
      started_at: snap.startedAt.toISOString(),
      ended_at: new Date().toISOString(),
      polyline: getPolyline() || null,
    })
    toast(`Saved: ${fmtDistance(snap.distance_m)} in ${fmtDuration(snap.duration_s)}`, { kind: 'success' })
  } catch (err) {
    toast('Save failed: ' + err.message, { kind: 'error' })
  }
  router.push('/stats')
}

onMounted(loadPreview)
onUnmounted(() => {
  resetEndHold()
  exitFullscreen()
  if (timer) clearInterval(timer)
  if (crewRefreshInterval) clearTimeout(crewRefreshInterval)
  if (crewDemoInterval) clearInterval(crewDemoInterval)
  if (previewMap) { previewMap.remove(); previewMap = null }
  if (crewChannel) api.removeRunChannel(crewChannel)
  crewMarkers.forEach(entry => {
    if (entry.timeout) clearTimeout(entry.timeout)
  })
  crewMarkers.clear()
  mockCrewState.clear()
  demoRouteCoords = null
  stopRecorder()
})
</script>

<template>
  <div>
    <!-- Loading -->
    <div v-if="phase === 'loading'" style="padding:40px;text-align:center">
      <div class="skeleton" style="height:300px;border-radius:10px"></div>
    </div>

    <!-- ===================== PREVIEW PHASE ===================== -->
    <div v-else-if="phase === 'preview'" class="run-fullbleed">
      <div id="run-map" class="run-map" aria-label="Map of the meetup"></div>

      <!-- Top bar -->
      <div class="run-topbar">
        <div aria-hidden="true"></div>
        <button class="route-square" :class="{ 'has-route': !!linkedActivity }"
          @click="showRoutePicker = true" title="Activity route" aria-label="Activity route">
          <i class="fa-solid fa-route"></i>
          <span v-if="linkedActivity" class="route-dot" aria-hidden="true"></span>
        </button>
      </div>

      <!-- Activity summary -->
      <div v-if="linkedActivity" class="activity-summary glass">
        <Avatar :profile="linkedActivity.club" size="sm" />
        <div style="min-width:0;flex:1">
          <div class="title">{{ linkedActivity.title }}</div>
          <div class="sub">{{ linkedActivity.club?.name || '' }}{{ linkedActivity.club?.name ? ' · ' : '' }}{{ fmtTime(linkedActivity.start_at) }}</div>
        </div>
        <button class="x" @click="clearRoute" aria-label="Clear linked activity">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <!-- Map FABs -->
      <div class="map-fabs">
        <button class="map-fab primary" @click="locatePreview" aria-label="Locate me">
          <i class="fa-solid fa-location-crosshairs"></i>
        </button>
        <button class="map-fab" @click="previewMap?.setZoom((previewMap?.getZoom()||13)+1)" aria-label="Zoom in">
          <i class="fa-solid fa-plus"></i>
        </button>
        <button class="map-fab" @click="previewMap?.setZoom((previewMap?.getZoom()||13)-1)" aria-label="Zoom out">
          <i class="fa-solid fa-minus"></i>
        </button>
      </div>

      <!-- Start panel -->
      <div class="start-panel glass">
        <div class="stats-row">
          <div class="stat-tile">
            <div class="stat-value">{{ previewDistance }}</div>
            <div class="stat-label">Kilometers</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value">{{ previewPace }}</div>
            <div class="stat-label">Avg Pace</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value">{{ previewDuration }}</div>
            <div class="stat-label">Duration</div>
          </div>
        </div>

        <button class="big-start" @click="startRun" aria-label="Start run">START</button>

        <button class="crew-demo-btn" @click="startCrewDemo" aria-label="Start crew run demo">
          <i class="fa-solid fa-users"></i> Crew Run Demo
        </button>

        <div class="status-strip">
          <span><i class="fa-solid fa-circle-dot ok"></i><span>{{ gpsStatus }}</span></span>
          <span>
            <router-link to="/my-activities" style="color:rgba(255,255,255,0.78);text-decoration:none;margin-right:12px">
              <i class="fa-regular fa-calendar"></i> Activities
            </router-link>
            <router-link to="/stats" style="color:rgba(255,255,255,0.78);text-decoration:none">
              <i class="fa-solid fa-chart-simple"></i> Stats
            </router-link>
          </span>
        </div>
      </div>

      <div class="run-attr">
        &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a>
        &middot; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>
      </div>
    </div>

    <!-- ===================== RECORDING PHASE ===================== -->
    <div v-else-if="phase === 'recording'" class="run-fullbleed">
      <div id="run-map" class="run-map" aria-label="Live running map"></div>

      <!-- Top bar -->
      <div class="run-topbar">
        <h1 class="run-title">
          <span class="rec-dot"><span class="dot"></span> Recording</span>
          <span v-if="useMock" class="sim-chip"><i class="fa-solid fa-flask"></i> Sim GPS</span>
        </h1>
        <button class="route-square locked" disabled aria-label="Activity route (locked during run)">
          <i class="fa-solid fa-route"></i>
          <span v-if="linkedActivity" class="lock"><i class="fa-solid fa-lock"></i></span>
        </button>
      </div>

      <!-- Activity summary -->
      <div v-if="linkedActivity" class="activity-summary glass">
        <Avatar :profile="linkedActivity.club" size="sm" />
        <div style="min-width:0;flex:1">
          <div class="title">{{ linkedActivity.title }}</div>
          <div class="sub">{{ linkedActivity.club?.name || '' }}{{ linkedActivity.club?.name ? ' · ' : '' }}Route locked for this session</div>
        </div>
      </div>

      <!-- Crew strip -->
      <div v-if="linkedActivity" class="crew-strip">
        <div class="crew-strip-toggle" @click="crewExpanded = !crewExpanded">
          <i class="fa-solid fa-users"></i>
          <span>{{ crewMembers.length }} runner{{ crewMembers.length !== 1 ? 's' : '' }}</span>
          <i class="fa-solid fa-chevron-down crew-chevron" :class="{ open: crewExpanded }"></i>
        </div>
        <div v-if="crewExpanded" class="crew-strip-list">
          <div v-for="m in crewMembers" :key="m.user_id"
            class="crew-avatar" :class="{ you: m.user_id === user?.id }"
            @click="m.user_id !== user?.id && toast(`You cheered for ${m.user?.display_name || 'Runner'}!`, { kind: 'success' })">
            <Avatar :profile="m.user" size="sm" />
            <span v-if="m.user_id === user?.id" class="crew-you-tag">you</span>
          </div>
        </div>
      </div>

      <!-- Map FABs -->
      <div class="map-fabs">
        <button class="map-fab primary" @click="recenter" aria-label="Recenter">
          <i class="fa-solid fa-location-crosshairs"></i>
        </button>
        <button class="map-fab" @click="zoomIn" aria-label="Zoom in">
          <i class="fa-solid fa-plus"></i>
        </button>
        <button class="map-fab" @click="zoomOut" aria-label="Zoom out">
          <i class="fa-solid fa-minus"></i>
        </button>
      </div>

      <div class="resilience-hint">
        <i class="fa-solid fa-shield-halved"></i>
        Recording in background · your distance is saved even if the tab freezes
      </div>

      <!-- Recording panel -->
      <div class="rec-panel glass">
        <div class="rec-distance">
          <span>{{ runDistanceDisplay }}</span>
          <small>Kilometers</small>
        </div>
        <div class="rec-mid">
          <div class="stat-tile">
            <div class="stat-value">{{ runPaceDisplay }}</div>
            <div class="stat-label">Avg Pace</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value">{{ runDurationDisplay }}</div>
            <div class="stat-label">Duration</div>
          </div>
          <div class="stat-tile">
            <div class="stat-value">{{ runCalDisplay }}</div>
            <div class="stat-label">Kcal</div>
          </div>
        </div>
        <div class="rec-ctrl">
          <button class="ctrl-btn" @click="togglePause" :aria-label="runPaused ? 'Resume' : 'Pause'" :title="runPaused ? 'Resume' : 'Pause'">
            <i :class="`fa-solid fa-${runPaused ? 'play' : 'pause'}`"></i>
          </button>
          <button
            class="end-btn"
            :class="{ holding: endHoldActive }"
            :style="{ '--hold-progress': endHoldProgress }"
            type="button"
            aria-label="Hold to finish and save the run"
            @pointerdown="startEndHold"
            @pointerup="cancelEndHold"
            @pointerleave="cancelEndHold"
            @pointercancel="cancelEndHold"
          >
            {{ endHoldActive ? 'HOLD...' : 'HOLD TO END' }}
          </button>
          <button class="ctrl-btn" @click="markLap" aria-label="Mark a lap" title="Mark a lap">
            <i class="fa-solid fa-flag"></i>
          </button>
        </div>
      </div>

      <div class="run-attr">
        &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a>
        &middot; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>
      </div>
    </div>

    <!-- ===================== ROUTE PICKER MODAL ===================== -->
    <van-popup v-model:show="showRoutePicker" position="bottom" round style="padding:20px">
      <h3>Pick activity route</h3>
      <p>Only activities you've checked in for show up here. Free run = no activity route.</p>
      <button class="btn ghost block" style="margin-bottom:10px" @click="pickRoute(null)">
        <i class="fa-solid fa-shoe-prints"></i> None · free run
      </button>
      <template v-if="pickable.length">
        <button v-for="a in pickable" :key="a.id" class="card interactive" style="display:block;width:100%;text-align:left;border:0"
          @click="pickRoute(a)">
          <div style="display:flex;gap:10px;align-items:center">
            <Avatar :profile="a.club" size="sm" />
            <div style="flex:1">
              <div style="font-weight:700;color:var(--ink-900)">{{ a.title }}</div>
              <div style="color:var(--ink-500);font-size:12px">{{ a.club?.name || '' }} · {{ fmtTime(a.start_at) }}</div>
            </div>
            <i class="fa-solid fa-chevron-right" style="color:var(--ink-400)"></i>
          </div>
        </button>
      </template>
      <div v-else class="empty" style="margin-top:6px">
        <i class="fa-regular fa-calendar-check"></i>
        <p>No checked-in activities yet.<br>Check in from Discover to unlock.</p>
      </div>
      <div class="actions" style="margin-top:14px">
        <button class="btn ghost" @click="showRoutePicker = false">Close</button>
      </div>
    </van-popup>
  </div>
</template>
