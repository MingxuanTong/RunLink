<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { getPublishDraft, clearPublishDraft } from '@/utils/publishDraft'
import { CHECK_IN_RADIUS_M } from '@/utils/shared-helpers'
import { fmtDate, fmtTime } from '@/utils/formatters'
import { createMap, addRouteGeoJson } from '@/utils/map'
import L from 'leaflet'
import Avatar from '@/components/Avatar.vue'

const router = useRouter()
const { toast } = useToast()

const draft = ref(null)
const publishing = ref(false)
let mapInstance = null

const coverBg = computed(() => {
  if (draft.value?.coverPreview) return `url('${draft.value.coverPreview}') center/cover`
  return 'linear-gradient(135deg,#F97316,#FB923C)'
})

const hasRouteImage = computed(() => draft.value?.routePreview && draft.value.routePreview !== 'vector')
const hasRouteGeo = computed(() => draft.value?.routeUpload?.geojson || draft.value?.routePreview === 'vector')
const missingSelectedFiles = computed(() => {
  if (!draft.value) return false
  const missingCover = !!draft.value.coverPreview && !draft.value.coverFile
  const missingRoute = !!draft.value.routePreview && !draft.value.routeUpload?.file
  return missingCover || missingRoute
})

function goBack() {
  router.back()
}

async function initMap() {
  const el = document.getElementById('publish-preview-map')
  if (!el || !draft.value?.meetup?.lat) return
  try {
    const center = [draft.value.meetup.lat, draft.value.meetup.lng]
    mapInstance = await createMap(el, { center, zoom: 16 })
    L.marker(center, { title: draft.value.meetupName || 'Meetup' }).addTo(mapInstance)
    L.circle(center, {
      radius: CHECK_IN_RADIUS_M,
      color: '#F97316', weight: 2, fillColor: '#F97316', fillOpacity: 0.14,
    }).addTo(mapInstance)
    if (draft.value.routeUpload?.geojson) {
      await addRouteGeoJson(mapInstance, draft.value.routeUpload.geojson, {
        color: '#F97316', weight: 4, opacity: 0.9, fit: true, fitPadding: [24, 24],
      })
    }
  } catch {
    mapInstance = null
  }
}

async function confirmPublish() {
  if (!draft.value || publishing.value) return
  if (missingSelectedFiles.value) {
    toast('Please go back and reselect the cover or route file before publishing.', { kind: 'warn' })
    return
  }
  publishing.value = true
  try {
    const coverUpload = draft.value.coverFile
      ? await api.uploadActivityAsset(draft.value.coverFile, { folder: 'covers' })
      : null
    const routeAsset = draft.value.routeUpload?.file
      ? await api.uploadActivityAsset(draft.value.routeUpload.file, { folder: 'routes' })
      : null

    const activity = await api.createActivity({
      club_id: draft.value.clubId,
      title: draft.value.title,
      description: draft.value.description || null,
      cover_url: coverUpload?.publicUrl || null,
      start_at: draft.value.startAtIso,
      end_at: draft.value.endAtIso,
      checkin_window_start: draft.value.checkinStartIso,
      checkin_window_end: draft.value.checkinEndIso,
      meetup_name: draft.value.meetupName || null,
      meetup_lat: draft.value.meetup.lat,
      meetup_lng: draft.value.meetup.lng,
      geofence_m: CHECK_IN_RADIUS_M,
      total_cap: draft.value.totalCap,
      route_file_url: routeAsset?.publicUrl || null,
      route_file_name: routeAsset?.name || null,
      route_file_kind: draft.value.routeUpload?.kind || null,
      route_geojson: draft.value.routeUpload?.geojson || null,
      groups: draft.value.groups,
      status: 'published',
    })

    clearPublishDraft()
    toast('Activity published!', { kind: 'success' })
    router.replace(`/activity/${activity.id}`)
  } catch (err) {
    toast(err.message, { kind: 'error' })
  } finally {
    publishing.value = false
  }
}

onMounted(() => {
  draft.value = getPublishDraft()
  if (!draft.value) return
  nextTick(initMap)
})

onUnmounted(() => {
  if (mapInstance) {
    mapInstance.remove()
    mapInstance = null
  }
})
</script>

<template>
  <div>
    <van-nav-bar title="Preview activity" left-arrow @click-left="goBack" />

    <div v-if="!draft" class="empty">
      <i class="fa-regular fa-eye-slash"></i>
      <h3>Preview unavailable</h3>
      <p>Go back to the publish form and generate a fresh preview.</p>
      <button class="btn ghost" type="button" @click="router.push('/community')">Back to Community</button>
    </div>

    <template v-else>
      <div class="card" style="margin-bottom:12px;background:var(--brand-soft);border-color:rgba(249,115,22,0.22)">
        <div style="font-weight:700;color:var(--brand-dark);margin-bottom:6px">
          <i class="fa-regular fa-eye"></i> Runner-side preview
        </div>
        <div style="color:var(--ink-700);font-size:13px;line-height:1.55">
          Review the activity card, meetup, route, check-in window, and groups exactly before publishing.
        </div>
      </div>

      <div v-if="missingSelectedFiles" class="card" style="margin-bottom:12px;background:#FEF3C7;border-color:#FCD34D">
        <div style="font-weight:700;color:#92400E;margin-bottom:6px">
          <i class="fa-solid fa-triangle-exclamation"></i> File reselect needed
        </div>
        <div style="color:#78350F;font-size:13px;line-height:1.55">
          This preview was restored after a refresh, so the original cover or route file is no longer attached. Go back to edit and select those files again before publishing.
        </div>
      </div>

      <article class="card" style="padding:0;overflow:hidden">
        <div :style="`aspect-ratio:2.2;background:${coverBg};position:relative`"></div>
        <div style="padding:18px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <span class="chip accent">Open</span>
            <span v-if="draft.club" class="chip ghost"><i class="fa-regular fa-flag"></i>{{ draft.club.name }}</span>
            <span class="chip brand"><i class="fa-solid fa-shield"></i>Preview only</span>
            <span v-if="draft.totalCap != null" class="chip ghost"><i class="fa-solid fa-users"></i>0/{{ draft.totalCap }}</span>
          </div>

          <h2 style="margin:0 0 8px;font-family:var(--font-display);color:var(--ink-900);font-size:26px;line-height:1.15">
            {{ draft.title }}
          </h2>
          <p style="color:var(--ink-700);font-size:14px;line-height:1.6;margin:0 0 14px">
            {{ draft.description || 'No description added yet.' }}
          </p>

          <div class="stat-grid" style="margin-bottom:14px">
            <div class="stat"><div class="v">{{ new Date(draft.startAtIso).toLocaleDateString('en', { month: 'short', day: 'numeric' }) }}</div><div class="l">Date</div></div>
            <div class="stat"><div class="v">{{ fmtTime(draft.startAtIso) }}</div><div class="l">Start</div></div>
            <div class="stat"><div class="v">{{ fmtTime(draft.endAtIso) }}</div><div class="l">End</div></div>
          </div>

          <div class="card card-compact" style="margin-top:0">
            <div style="display:flex;align-items:center;gap:10px">
              <Avatar :profile="draft.club" size="sm" />
              <div style="min-width:0;flex:1">
                <div style="font-weight:700;color:var(--ink-900)">
                  <i class="fa-solid fa-location-dot" style="color:var(--brand)"></i> {{ draft.meetupName || 'Meetup' }}
                </div>
                <div style="color:var(--ink-500);font-size:12px;margin-top:4px">
                  Check-in radius <b>{{ CHECK_IN_RADIUS_M }} m</b>
                  <template v-if="draft.checkinStartIso">
                    · window {{ fmtTime(draft.checkinStartIso) }} -> {{ fmtTime(draft.checkinEndIso || draft.startAtIso) }}
                  </template>
                </div>
              </div>
            </div>
            <div id="publish-preview-map" class="leaflet-map" style="margin-top:10px;height:180px"></div>
          </div>

          <div v-if="hasRouteImage" class="card card-compact" style="margin-top:12px">
            <div style="font-weight:700"><i class="fa-solid fa-route" style="color:var(--brand)"></i> Route map</div>
            <div style="color:var(--ink-500);font-size:12px;margin-top:4px">
              Uploaded by the organizer{{ draft.routePreviewFileName ? ` · ${draft.routePreviewFileName}` : '' }}
            </div>
            <img :src="draft.routePreview" alt="Route map preview" style="width:100%;margin-top:10px;border-radius:14px;border:1px solid var(--ink-100);display:block" />
          </div>

          <div v-if="hasRouteGeo" class="card card-compact" style="margin-top:12px">
            <div style="font-weight:700"><i class="fa-solid fa-route" style="color:var(--brand)"></i> Route file</div>
            <div style="color:var(--ink-500);font-size:12px;margin-top:4px">
              {{ draft.routePreviewFileName || 'Uploaded route' }} · rendered directly on the map
            </div>
          </div>

          <div v-if="draft.groups?.length" style="margin-top:18px">
            <div class="section-title" style="margin:0 0 10px">
              <h2>Groups</h2>
              <span class="count">{{ draft.groups.length }}</span>
            </div>
            <div
              v-for="group in draft.groups"
              :key="group.name"
              class="card card-compact"
              style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px"
            >
              <div>
                <div style="font-weight:700;color:var(--ink-900)">{{ group.name }}</div>
                <div style="color:var(--ink-500);font-size:12px">
                  <template v-if="group.cap != null">0 / {{ group.cap }} seats reserved</template>
                  <template v-else>Unlimited seats in this group</template>
                </div>
              </div>
              <span class="chip ghost">Available</span>
            </div>
          </div>
        </div>
      </article>

      <div class="card" style="margin-top:14px">
        <div style="font-weight:700;color:var(--ink-900);margin-bottom:8px">Pre-publish checklist</div>
        <div style="display:grid;gap:8px;color:var(--ink-700);font-size:13px;line-height:1.55">
          <div><i class="fa-solid fa-circle-check" style="color:var(--accent)"></i> Time, meetup, and route reflect the runner-facing experience.</div>
          <div><i class="fa-solid fa-circle-check" style="color:var(--accent)"></i> Check-in window appears before runners arrive.</div>
          <div><i class="fa-solid fa-circle-check" style="color:var(--accent)"></i> Groups and capacity look correct before publishing.</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
        <button class="btn ghost" type="button" @click="goBack">
          <i class="fa-solid fa-pen"></i> Back to edit
        </button>
        <button class="btn" type="button" :disabled="publishing || missingSelectedFiles" @click="confirmPublish">
          <i class="fa-solid fa-bullhorn"></i> {{ publishing ? 'Publishing...' : 'Confirm publish' }}
        </button>
      </div>
    </template>
  </div>
</template>
