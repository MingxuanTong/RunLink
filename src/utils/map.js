/**
 * Leaflet helpers — now using npm Leaflet directly.
 */
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { haversineMeters } from './geofence'

// Fix Leaflet default marker icons (broken when using npm import)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

export const DEFAULT_CENTER = [31.2304, 121.4737] // Shanghai Bund

const TILES = {
  light: {
    url:  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  dark: {
    url:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
    subdomains: 'abcd',
  },
}

export function createMap(el, {
  center = DEFAULT_CENTER,
  zoom = 13,
  theme = 'light',
  zoomControl = true,
  attributionControl = true,
} = {}) {
  const map = L.map(el, { zoomControl, attributionControl }).setView(center, zoom)
  const tiles = TILES[theme] || TILES.light
  const tileOptions = {
    attribution: tiles.attr,
    maxZoom: tiles.maxZoom,
  }
  if (tiles.subdomains) tileOptions.subdomains = tiles.subdomains
  L.tileLayer(tiles.url, tileOptions).addTo(map)
  requestAnimationFrame(() => map.invalidateSize())
  setTimeout(() => map.invalidateSize(), 250)
  return map
}

export function addRouteGeoJson(map, geojson, {
  color = '#F97316',
  weight = 4,
  opacity = 0.92,
  fit = true,
  fitPadding = [24, 24],
} = {}) {
  if (!geojson) return null
  const layer = L.geoJSON(geojson, {
    style: () => ({
      color,
      weight,
      opacity,
      lineJoin: 'round',
      lineCap: 'round',
    }),
    pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
      radius: 4,
      color: '#fff',
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
    }),
  }).addTo(map)
  if (fit) {
    const bounds = layer.getBounds?.()
    if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: fitPadding })
  }
  return layer
}

/* ==================================================================
   Meetup picker (for organizer publishing an activity)
   ================================================================== */

export function meetupPicker(el, { lat, lng, radius = 50, onChange } = {}) {
  const hasInitial = lat != null && lng != null
  const start = hasInitial ? [lat, lng] : DEFAULT_CENTER

  const map = createMap(el, { center: start, zoom: hasInitial ? 16 : 13 })
  let selected = hasInitial ? L.latLng(lat, lng) : null
  let marker = null
  let circle = null

  function ensureVisuals(latlng) {
    if (!marker) {
      marker = L.marker(latlng, {
        draggable: true,
        title: 'Drag me to set the meetup point',
      }).addTo(map)
      marker.on('dragend', () => emit(marker.getLatLng()))
    }
    if (!circle) {
      circle = L.circle(latlng, {
        radius,
        color: '#F97316',
        weight: 2,
        fillColor: '#F97316',
        fillOpacity: 0.14,
      }).addTo(map)
    }
  }

  function emit(latlng) {
    selected = L.latLng(latlng.lat, latlng.lng)
    ensureVisuals(selected)
    marker.setLatLng(selected)
    circle.setLatLng(selected)
    onChange?.({ lat: selected.lat, lng: selected.lng })
  }

  if (selected) ensureVisuals(selected)
  map.on('click', (ev) => emit(ev.latlng))

  return {
    map, marker, circle,
    getLatLng()         { return selected ? { lat: selected.lat, lng: selected.lng } : null },
    setLatLng({ lat, lng }, { zoom = 16 } = {}) {
      const ll = L.latLng(lat, lng)
      emit(ll)
      map.setView(ll, zoom)
    },
    setRadius(r)        { circle?.setRadius(r) },
    locate() {
      return new Promise((resolve, reject) => {
        if (!('geolocation' in navigator)) return reject(new Error('Geolocation unsupported'))
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
            this.setLatLng(p)
            resolve(p)
          },
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 8000 },
        )
      })
    },
  }
}

/* ==================================================================
   Run recorder — draws live trail while `watchPosition` streams fixes.
   ================================================================== */

export function runRecorder(el, { meetup = null, radius = 50, theme = 'dark', routeGeoJson = null, onPositionUpdate = null } = {}) {
  const center = meetup ? [meetup.lat, meetup.lng] : DEFAULT_CENTER

  const map = createMap(el, {
    center, zoom: 16, theme,
    zoomControl: false, attributionControl: false,
  })

  if (meetup) {
    L.marker(center, { title: 'Meetup' }).addTo(map)
    L.circle(center, {
      radius,
      color: '#22C55E', weight: 1, dashArray: '4 4',
      fillColor: '#22C55E', fillOpacity: 0.08,
    }).addTo(map)
  }

  const routeLayer = routeGeoJson
    ? addRouteGeoJson(map, routeGeoJson, {
        color: theme === 'dark' ? '#FB923C' : '#F97316',
        weight: 5,
        opacity: 0.88,
        fit: true,
        fitPadding: [28, 28],
      })
    : null

  const trail = L.polyline([], {
    color: '#F97316', weight: 5, opacity: 0.92,
    lineJoin: 'round', lineCap: 'round',
  }).addTo(map)

  const me = L.circleMarker(center, {
    radius: 8, weight: 3, color: '#fff',
    fillColor: '#F97316', fillOpacity: 1,
  }).addTo(map)

  const points = []
  let watchId = null
  let firstFix = true
  let rejectedCount = 0

  const MAX_SPEED_MPS = 11
  const MIN_DISTANCE_M = 2
  const MAX_ACCURACY_M = 50
  const SMOOTH_ALPHA = 0.6
  let smoothLat = null, smoothLng = null

  function commitPoint(lat, lng, accuracy) {
    const latlng = L.latLng(lat, lng)
    points.push({ lat, lng, ts: Date.now(), accuracy })
    trail.addLatLng(latlng)
    me.setLatLng(latlng)
    if (firstFix) {
      firstFix = false
      map.setView(latlng, 17)
    } else {
      map.panTo(latlng, { animate: true, duration: 0.5 })
    }
    onPositionUpdate?.({ lat, lng, accuracy, ts: Date.now() })
  }

  function push(lat, lng, accuracy) {
    if (accuracy > MAX_ACCURACY_M) { rejectedCount++; return }

    if (points.length === 0) {
      smoothLat = lat; smoothLng = lng
      commitPoint(lat, lng, accuracy)
      return
    }

    const last = points[points.length - 1]
    const dt = (Date.now() - last.ts) / 1000
    const rawDist = haversineMeters(last.lat, last.lng, lat, lng)
    if (dt > 0 && rawDist / dt > MAX_SPEED_MPS) { rejectedCount++; return }

    const alpha = Math.min(1, (MAX_ACCURACY_M / accuracy) * SMOOTH_ALPHA)
    smoothLat = smoothLat * (1 - alpha) + lat * alpha
    smoothLng = smoothLng * (1 - alpha) + lng * alpha

    const smoothDist = haversineMeters(last.lat, last.lng, smoothLat, smoothLng)
    if (smoothDist < MIN_DISTANCE_M) { rejectedCount++; return }

    commitPoint(smoothLat, smoothLng, accuracy)
  }

  return {
    map, trail, me, routeLayer,

    recenter() {
      const last = points[points.length - 1]
      const ll = last ? [last.lat, last.lng] : center
      map.setView(ll, Math.max(map.getZoom(), 16), { animate: true })
    },

    zoomIn()  { map.setZoom(map.getZoom() + 1) },
    zoomOut() { map.setZoom(map.getZoom() - 1) },

    start({ onError } = {}) {
      if (!('geolocation' in navigator)) throw new Error('Geolocation unsupported')
      watchId = navigator.geolocation.watchPosition(
        (pos) => push(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        (err) => onError?.(err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      )
    },

    stop() {
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      watchId = null
    },

    getPoints() { return points.slice() },

    getFilterStats() {
      return { accepted: points.length, rejected: rejectedCount }
    },

    getDistanceMeters() {
      let d = 0
      for (let i = 1; i < points.length; i++) {
        d += haversineMeters(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng)
      }
      return d
    },

    getPolyline() {
      return points.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(';')
    },

    simulateStep(prev) {
      const base = prev ?? (points[points.length - 1] ?? { lat: center[0], lng: center[1] })
      const jitterLat = (Math.random() - 0.5) * 0.00004
      const jitterLng = (Math.random() - 0.5) * 0.00004
      const nextLat = base.lat + 0.00003 + jitterLat
      const nextLng = base.lng + 0.00003 + jitterLng
      commitPoint(nextLat, nextLng, 999)
    },
  }
}
