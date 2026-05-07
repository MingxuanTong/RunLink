import { fmtDate } from './formatters'

export const CHECK_IN_RADIUS_M = 50
export const EMOJI_PRESET = ['💪', '🔥', '😎', '😅', '🎉', '👍', '❤️']
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const DEFAULT_PROFILE_COVER_URL = 'https://images.unsplash.com/photo-1502810190503-8303352d0dd1?w=900&h=500&fit=crop'

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`Could not read ${file?.name || 'file'}`))
    reader.readAsDataURL(file)
  })
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`Could not read ${file?.name || 'file'}`))
    reader.readAsText(file)
  })
}

export function normalizeRouteGeoJson(raw) {
  if (!raw) throw new Error('Route file is empty')
  if (raw.type === 'FeatureCollection') return raw
  if (raw.type === 'Feature') return { type: 'FeatureCollection', features: [raw] }
  if (raw.type === 'LineString' || raw.type === 'MultiLineString') {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: raw }],
    }
  }
  throw new Error('Route file must contain a GeoJSON LineString, MultiLineString, Feature, or FeatureCollection')
}

export function parseGpxToGeoJson(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error('Invalid GPX file')

  const readPoints = (selector) => [...xml.querySelectorAll(selector)]
    .map((pt) => [Number(pt.getAttribute('lon')), Number(pt.getAttribute('lat'))])
    .filter(([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng))

  const trackSegments = [...xml.querySelectorAll('trkseg')]
    .map((seg) => readPoints('trkseg trkpt'))
    .filter((coords) => coords.length >= 2)

  if (trackSegments.length > 1) {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { source: 'gpx' },
        geometry: { type: 'MultiLineString', coordinates: trackSegments },
      }],
    }
  }

  if (trackSegments.length === 1) {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { source: 'gpx' },
        geometry: { type: 'LineString', coordinates: trackSegments[0] },
      }],
    }
  }

  const routePoints = readPoints('rte rtept')
  if (routePoints.length >= 2) {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { source: 'gpx' },
        geometry: { type: 'LineString', coordinates: routePoints },
      }],
    }
  }

  throw new Error('GPX file does not contain a route or track with at least 2 points')
}

export async function parseRouteFile(file) {
  const lower = (file?.name || '').toLowerCase()
  const mime = file?.type || ''
  if (/\.gpx$/.test(lower) || mime === 'application/gpx+xml' || mime === 'application/xml' || mime === 'text/xml') {
    return { kind: 'gpx', geojson: parseGpxToGeoJson(await readFileAsText(file)) }
  }
  if (/\.geojson$|\.json$/.test(lower) || mime === 'application/geo+json' || mime === 'application/json') {
    return { kind: 'geojson', geojson: normalizeRouteGeoJson(JSON.parse(await readFileAsText(file))) }
  }
  return { kind: 'image', geojson: null }
}

export function registrationStatus(reg, activity) {
  if (!reg) return null
  if (reg.status === 'cancelled') return 'cancelled'
  const now = new Date()
  const past = new Date(activity.end_at) < now
  const checkedIn = reg.status === 'checked_in' || reg.status === 'late'
  if (past && checkedIn) return 'completed_maybe'
  if (past && !checkedIn) return 'missed'
  if (checkedIn) return reg.status === 'late' ? 'late' : 'checked_in'
  const winStart = activity.checkin_window_start ? new Date(activity.checkin_window_start) : null
  const winEnd = activity.checkin_window_end ? new Date(activity.checkin_window_end) : null
  if (winStart && winEnd && now >= winStart && now <= winEnd) return 'checkin_open'
  if (new Date(activity.start_at) <= now) return 'live'
  return 'upcoming'
}

export function computeAchievements(runs) {
  const totalKm = runs.reduce((s, r) => s + (r.distance_m || 0), 0) / 1000
  const byDate = (pred) => runs
    .filter(pred)
    .sort((a, b) => new Date(a.started_at) - new Date(b.started_at))[0]

  const first10K = byDate(r => (r.distance_m || 0) >= 10000)
  const first5K  = byDate(r => (r.distance_m || 0) >= 5000)
  const halfM    = byDate(r => (r.distance_m || 0) >= 21097)
  const sub25_5K = byDate(r => (r.distance_m || 0) >= 5000 && (r.duration_s || 0) <= 25 * 60)
  const subFive  = byDate(r => r.avg_pace_s_per_km && r.avg_pace_s_per_km <= 300)
  const nightRun = byDate(r => {
    const h = new Date(r.started_at).getHours()
    return h >= 20 || h < 6
  })

  const days = [...new Set(runs.map(r => fmtDate(r.started_at, { withTime: false })))]
  const streak = Math.min(days.length, 7)

  const fmt = (d) => d ? fmtDate(d.started_at, { withTime: false }) : 'Locked'

  return [
    { key: 'first-run', name: 'First run', sub: runs.length ? fmt(runs[runs.length - 1]) : 'Locked',
      medal: 'emerald', icon: 'fa-shoe-prints', unlocked: runs.length >= 1 },
    { key: 'first-5k', name: 'First 5K', sub: fmt(first5K),
      medal: 'bronze', icon: 'fa-person-running', unlocked: !!first5K },
    { key: 'first-10k', name: 'First 10K', sub: fmt(first10K),
      medal: '', icon: 'fa-crown', unlocked: !!first10K },
    { key: 'sub-25-5k', name: 'Sub-25′ 5K', sub: fmt(sub25_5K),
      medal: 'emerald', icon: 'fa-bolt', unlocked: !!sub25_5K },
    { key: 'sub-five', name: 'Sub-5′ pace', sub: fmt(subFive),
      medal: 'sky', icon: 'fa-gauge-high', unlocked: !!subFive },
    { key: 'half-m', name: 'Half-marathon', sub: fmt(halfM),
      medal: 'ruby', icon: 'fa-medal', unlocked: !!halfM },
    { key: 'km-50', name: '50 km total', sub: `${totalKm.toFixed(1)} km`,
      medal: 'silver', icon: 'fa-mountain', unlocked: totalKm >= 50 },
    { key: 'km-100', name: '100 km total', sub: `${totalKm.toFixed(1)} km`,
      medal: '', icon: 'fa-trophy', unlocked: totalKm >= 100 },
    { key: 'night', name: 'Night runner', sub: fmt(nightRun),
      medal: 'silver', icon: 'fa-moon', unlocked: !!nightRun },
    { key: 'streak', name: `Streak ${streak}`, sub: streak ? 'Active' : 'Locked',
      medal: 'bronze', icon: 'fa-fire', unlocked: streak >= 2 },
  ]
}

export async function supabaseHelperMemberships(userId) {
  const { supabase } = await import('@/lib/supabase')
  const { data } = await supabase.from('club_members').select('club_id').eq('user_id', userId)
  return (data ?? []).map(m => m.club_id)
}
