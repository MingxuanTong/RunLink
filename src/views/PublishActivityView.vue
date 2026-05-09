<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { useMeetupPicker } from '@/composables/useMeetupPicker'
import { parseRouteFile, MAX_UPLOAD_BYTES, CHECK_IN_RADIUS_M } from '@/utils/shared-helpers'
import { getCurrentPosition } from '@/utils/geofence'
import { addRouteGeoJson } from '@/utils/map'
import { esc } from '@/utils/helpers'
import { getPublishDraft, setPublishDraft } from '@/utils/publishDraft'
import Avatar from '@/components/Avatar.vue'

const route = useRoute()
const router = useRouter()
const { toast } = useToast()

const clubId = route.params.clubId
const loading = ref(true)
const club = ref(null)

// Form fields
const title = ref('')
const description = ref('')
const startAt = ref('')
const endAt = ref('')
const checkinStart = ref('')
const checkinEnd = ref('')
const meetupName = ref('')
const totalCap = ref('')

// Groups
const groupRows = ref([
  { name: '5K Chill', cap: '' },
  { name: '5K Push', cap: '' },
])

// File handling
const coverPreview = ref('')
const routePreview = ref('')
const routePreviewFileName = ref('')
let coverFile = null
let routeUpload = null

// Map picker
const { picker, init: initPicker, setLatLng, locate: pickerLocate } = useMeetupPicker()
const meetupSelected = ref(false)

function addGroup() {
  groupRows.value.push({ name: '', cap: '' })
}
function removeGroup(i) {
  groupRows.value.splice(i, 1)
}

function hydrateFromDraft(draft) {
  if (!draft || draft.clubId !== clubId) return
  title.value = draft.title || ''
  description.value = draft.description || ''
  startAt.value = draft.startAtIso ? draft.startAtIso.slice(0, 16) : ''
  endAt.value = draft.endAtIso ? draft.endAtIso.slice(0, 16) : ''
  checkinStart.value = draft.checkinStartIso ? draft.checkinStartIso.slice(0, 16) : ''
  checkinEnd.value = draft.checkinEndIso ? draft.checkinEndIso.slice(0, 16) : ''
  meetupName.value = draft.meetupName || ''
  totalCap.value = draft.totalCap != null ? String(draft.totalCap) : ''
  groupRows.value = draft.groups?.length
    ? draft.groups.map((g) => ({ name: g.name || '', cap: g.cap != null ? String(g.cap) : '' }))
    : [{ name: '5K Chill', cap: '' }, { name: '5K Push', cap: '' }]
  coverPreview.value = draft.coverPreview || ''
  routePreview.value = draft.routePreview || ''
  routePreviewFileName.value = draft.routePreviewFileName || ''
  routeUpload = draft.routeUpload || null
  if (draft.meetup?.lat != null && draft.meetup?.lng != null) {
    meetupSelected.value = true
    nextTick(() => setLatLng(draft.meetup))
  }
}

function onCoverChange(e) {
  const file = e.target.files?.[0]
  if (!file) { coverFile = null; coverPreview.value = ''; return }
  if (file.size > MAX_UPLOAD_BYTES) {
    toast('Please keep uploads under 10 MB.', { kind: 'warn' })
    e.target.value = ''
    return
  }
  coverFile = file
  coverPreview.value = URL.createObjectURL(file)
}

async function onRouteChange(e) {
  const file = e.target.files?.[0]
  routeUpload = null
  routePreview.value = ''
  routePreviewFileName.value = ''
  if (!file) return
  if (file.size > MAX_UPLOAD_BYTES) {
    toast('Please keep uploads under 10 MB.', { kind: 'warn' })
    e.target.value = ''
    return
  }
  try {
    const parsed = await parseRouteFile(file)
    routeUpload = { file, kind: parsed.kind, geojson: parsed.geojson }

    if (parsed.kind === 'image') {
      routePreview.value = URL.createObjectURL(file)
    } else {
      routePreview.value = 'vector'
      routePreviewFileName.value = file.name
      if (picker.value?.map && parsed.geojson) {
        await addRouteGeoJson(picker.value.map, parsed.geojson, {
          color: '#F97316', weight: 4, opacity: 0.88, fit: true, fitPadding: [24, 24],
        })
      }
    }
  } catch (err) {
    toast(err.message || 'Could not parse route file', { kind: 'error' })
  }
}

async function useMyLocation() {
  try {
    await pickerLocate()
    toast('Centered on your current location.', { kind: 'success' })
  } catch {
    try {
      const pos = await getCurrentPosition()
      setLatLng(pos)
      toast('Centered on your current location.', { kind: 'success' })
    } catch (err2) { toast(err2.message || 'Could not get location', { kind: 'error' }) }
  }
}

async function handlePreview() {
  const s = startAt.value ? new Date(startAt.value) : null
  const e = endAt.value ? new Date(endAt.value) : null
  const cs = checkinStart.value ? new Date(checkinStart.value) : null
  const ce = checkinEnd.value ? new Date(checkinEnd.value) : null

  if (!s || Number.isNaN(s.getTime()) || !e || Number.isNaN(e.getTime())) {
    toast('Please provide valid start and end time.', { kind: 'warn' }); return
  }
  if (e <= s) { toast('End time must be later than start time.', { kind: 'warn' }); return }
  if (cs && Number.isNaN(cs.getTime())) { toast('Check-in open time is invalid.', { kind: 'warn' }); return }
  if (ce && Number.isNaN(ce.getTime())) { toast('Check-in close time is invalid.', { kind: 'warn' }); return }
  if (cs && ce && ce < cs) { toast('Check-in close time must be later than check-in open time.', { kind: 'warn' }); return }
  if (ce && ce > e) { toast('Check-in close time cannot be later than activity end time.', { kind: 'warn' }); return }
  if (!meetupSelected.value) { toast('Tap the map to set the meetup point.', { kind: 'warn' }); return }

  const groups = groupRows.value
    .map(g => ({ name: g.name.trim(), cap: g.cap ? Number(g.cap) : null }))
    .filter(g => g.name)

  const meetup = picker.value?.getLatLng()
  setPublishDraft({
    clubId,
    club: club.value,
    title: title.value.trim(),
    description: description.value.trim(),
    startAtIso: s.toISOString(),
    endAtIso: e.toISOString(),
    checkinStartIso: cs ? cs.toISOString() : null,
    checkinEndIso: ce ? ce.toISOString() : null,
    meetupName: meetupName.value.trim(),
    meetup: { lat: meetup?.lat, lng: meetup?.lng },
    totalCap: totalCap.value ? Number(totalCap.value) : null,
    groups,
    coverFile,
    coverPreview: coverPreview.value || '',
    routeUpload,
    routePreview: routePreview.value || '',
    routePreviewFileName: routePreviewFileName.value || '',
  })
  router.push(`/club/${clubId}/publish/preview`)
}

onMounted(async () => {
  try {
    club.value = await api.getClub(clubId)
  } finally { loading.value = false }
  hydrateFromDraft(getPublishDraft())
  nextTick(() => {
    const el = document.getElementById('meetup-map')
    if (el) {
      initPicker(el, {
        radius: CHECK_IN_RADIUS_M,
        onChange: ({ lat, lng }) => { meetupSelected.value = true },
      })
      const draft = getPublishDraft()
      if (draft?.clubId === clubId && draft.meetup?.lat != null && draft.meetup?.lng != null) {
        nextTick(() => setLatLng(draft.meetup))
      }
    }
  })
})
</script>

<template>
  <div>
    <van-nav-bar title="Publish activity" left-arrow @click-left="router.back()" />

    <div v-if="loading"><div class="skeleton" style="height:300px;border-radius:10px"></div></div>

    <template v-else-if="club">
      <div class="card"><b>{{ club.name }}</b> · timezone <span class="chip ghost">{{ club.timezone }}</span></div>

      <div class="card" style="margin-top:12px">
        <div class="field">
          <label>Title</label>
          <input v-model="title" required maxlength="80" placeholder="Sunset Bund 5K" />
        </div>
        <div class="field">
          <label>Description</label>
          <textarea v-model="description" placeholder="Route, pace, who this is for."></textarea>
        </div>
        <div class="field">
          <label>Cover image</label>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="onCoverChange" />
          <div class="hint">Upload a JPG / PNG / WebP / GIF cover image.</div>
          <div v-if="coverPreview" class="card card-compact" style="margin-top:8px">
            <div style="font-weight:700;color:var(--ink-900);margin-bottom:8px">Cover preview</div>
            <img :src="coverPreview" alt="Cover preview" style="width:100%;aspect-ratio:2.2;object-fit:cover;border-radius:14px;border:1px solid var(--ink-100);display:block" />
          </div>
        </div>
        <div class="field">
          <label>Route map file (optional)</label>
          <input type="file" accept=".gpx,.geojson,.json,image/png,image/jpeg,image/webp,image/gif,application/gpx+xml,application/geo+json,application/json" @change="onRouteChange" />
          <div class="hint">Upload a route image, GPX, or GeoJSON file.</div>
          <div v-if="routePreview" class="card card-compact" style="margin-top:8px">
            <div style="font-weight:700;color:var(--ink-900);margin-bottom:8px">Route preview</div>
            <img v-if="routePreview !== 'vector'" :src="routePreview" alt="Route map preview" style="width:100%;object-fit:cover;border-radius:14px;border:1px solid var(--ink-100);display:block" />
            <div v-else style="display:flex;gap:8px;align-items:flex-start;color:var(--ink-700);font-size:13px;line-height:1.5">
              <i class="fa-solid fa-route" style="color:var(--brand);margin-top:2px"></i>
              <div>
                <div style="font-weight:700;color:var(--ink-900)">{{ routePreviewFileName }}</div>
                <div>Vector route parsed successfully. It will be uploaded to Supabase Storage and drawn on the meetup map.</div>
              </div>
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="field"><label>Start</label><input type="datetime-local" v-model="startAt" required /></div>
          <div class="field"><label>End</label><input type="datetime-local" v-model="endAt" required /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="field"><label>Check-in opens</label><input type="datetime-local" v-model="checkinStart" /></div>
          <div class="field"><label>Check-in closes</label><input type="datetime-local" v-model="checkinEnd" /></div>
        </div>

        <div class="field">
          <label>Meetup point</label>
          <div id="meetup-map" class="leaflet-map"></div>
          <div class="hint">
            <i class="fa-solid fa-circle-info"></i>
            Tap the map or drag the pin to set the exact meetup.
            Runners can check in while within <b>{{ CHECK_IN_RADIUS_M }} m</b> of this point.
          </div>
          <button type="button" class="ghost-btn" style="margin-top:8px;width:100%" @click="useMyLocation">
            <i class="fa-solid fa-location-crosshairs"></i> Center on my current location
          </button>
          <div class="hint" style="margin-top:8px">
            <template v-if="meetupSelected">
              <i class="fa-solid fa-circle-check" style="color:var(--accent)"></i> Meetup point selected on the map.
            </template>
            <template v-else>
              <i class="fa-regular fa-hand-pointer"></i> No meetup point selected yet.
            </template>
          </div>
        </div>

        <div class="field"><label>Meetup name</label><input v-model="meetupName" placeholder="Bund Lighthouse" /></div>

        <div class="field">
          <label>Total capacity (optional)</label>
          <input v-model="totalCap" type="number" min="1" placeholder="Blank = unlimited" />
          <div class="hint">When reached, the activity shows Full and new registrations are blocked.</div>
        </div>

        <div class="field">
          <label>Groups</label>
          <div v-for="(g, i) in groupRows" :key="i" class="card card-compact" style="display:grid;grid-template-columns:1fr 80px auto;gap:6px;margin-bottom:6px;align-items:center">
            <input v-model="g.name" placeholder="Group name (e.g. 5K Chill)" />
            <input v-model="g.cap" placeholder="cap" type="number" min="1" />
            <button class="icon-btn neutral" type="button" @click="removeGroup(i)" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <button type="button" class="ghost-btn" style="margin-top:6px;width:100%" @click="addGroup">
            <i class="fa-solid fa-plus"></i> Add group
          </button>
          <div class="hint">Each group has a pace / goal. Optional per-group capacity.</div>
        </div>

        <button class="btn block" type="button" @click="handlePreview"><i class="fa-regular fa-eye"></i> Preview before publish</button>
      </div>
    </template>

    <div v-else class="empty"><h3>Club not found</h3></div>
  </div>
</template>
