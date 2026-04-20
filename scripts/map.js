/**
 * Leaflet helpers.
 *
 * Leaflet is loaded from a CDN as a classic script tag so it exposes a
 * global `L`. We deliberately don't import it via ESM to keep the
 * no-build promise — use `whenLeafletReady()` before touching `L`.
 */
import { haversineMeters } from './geofence.js';

export const DEFAULT_CENTER = [31.2304, 121.4737]; // Shanghai Bund

/** Tile layers — CARTO's basemaps are CORS-friendly and free for dev use. */
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
};

/** Resolves once the Leaflet global is available. */
export function whenLeafletReady({ timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window.L) { clearInterval(iv); resolve(window.L); }
      else if (Date.now() - t0 > timeoutMs) {
        clearInterval(iv);
        reject(new Error('Leaflet failed to load (CDN blocked?)'));
      }
    }, 60);
  });
}

/** Create a base map with the OSM tile layer.
 *  `theme` picks a tile set: 'light' (default, OSM standard) or 'dark' (CARTO Dark Matter).
 *  `zoomControl` / `attributionControl` expose Leaflet's built-in map controls. */
export async function createMap(el, {
  center = DEFAULT_CENTER,
  zoom = 13,
  theme = 'light',
  zoomControl = true,
  attributionControl = true,
} = {}) {
  const L = await whenLeafletReady();
  const map = L.map(el, { zoomControl, attributionControl }).setView(center, zoom);
  const tiles = TILES[theme] || TILES.light;
  const tileOptions = {
    attribution: tiles.attr,
    maxZoom: tiles.maxZoom,
  };
  if (tiles.subdomains) tileOptions.subdomains = tiles.subdomains;
  L.tileLayer(tiles.url, tileOptions).addTo(map);
  // Size fix: Leaflet miscalculates if the element was hidden during init.
  requestAnimationFrame(() => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 250);
  return map;
}

export async function addRouteGeoJson(map, geojson, {
  color = '#F97316',
  weight = 4,
  opacity = 0.92,
  fit = true,
  fitPadding = [24, 24],
} = {}) {
  if (!geojson) return null;
  const L = await whenLeafletReady();
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
  }).addTo(map);
  if (fit) {
    const bounds = layer.getBounds?.();
    if (bounds?.isValid?.()) map.fitBounds(bounds, { padding: fitPadding });
  }
  return layer;
}

/* ==================================================================
   Meetup picker (for organizer publishing an activity)
   ================================================================== */

export async function meetupPicker(el, { lat, lng, radius = 50, onChange } = {}) {
  const L = await whenLeafletReady();
  const hasInitial = lat != null && lng != null;
  const start = hasInitial ? [lat, lng] : DEFAULT_CENTER;

  const map = await createMap(el, { center: start, zoom: hasInitial ? 16 : 13 });
  let selected = hasInitial ? L.latLng(lat, lng) : null;
  let marker = null;
  let circle = null;

  function ensureVisuals(latlng) {
    if (!marker) {
      marker = L.marker(latlng, {
        draggable: true,
        title: 'Drag me to set the meetup point',
      }).addTo(map);
      marker.on('dragend', () => emit(marker.getLatLng()));
    }
    if (!circle) {
      circle = L.circle(latlng, {
        radius,
        color: '#F97316',
        weight: 2,
        fillColor: '#F97316',
        fillOpacity: 0.14,
      }).addTo(map);
    }
  }

  function emit(latlng) {
    selected = L.latLng(latlng.lat, latlng.lng);
    ensureVisuals(selected);
    marker.setLatLng(selected);
    circle.setLatLng(selected);
    onChange?.({ lat: selected.lat, lng: selected.lng });
  }

  if (selected) ensureVisuals(selected);
  map.on('click', (ev) => emit(ev.latlng));

  // Locate button: bind externally via `locate()`.
  return {
    map, marker, circle,
    getLatLng()         { return selected ? { lat: selected.lat, lng: selected.lng } : null; },
    setLatLng({ lat, lng }, { zoom = 16 } = {}) {
      const ll = L.latLng(lat, lng);
      emit(ll);
      map.setView(ll, zoom);
    },
    setRadius(r)        { circle?.setRadius(r); },
    locate() {
      return new Promise((resolve, reject) => {
        if (!('geolocation' in navigator)) return reject(new Error('Geolocation unsupported'));
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            this.setLatLng(p);
            resolve(p);
          },
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 8000 },
        );
      });
    },
  };
}

/* ==================================================================
   Run recorder — draws live trail while `watchPosition` streams fixes.
   ================================================================== */

export async function runRecorder(el, { meetup = null, radius = 50, theme = 'dark', routeGeoJson = null } = {}) {
  const L = await whenLeafletReady();
  const center = meetup ? [meetup.lat, meetup.lng] : DEFAULT_CENTER;

  const map = await createMap(el, {
    center, zoom: 16, theme,
    zoomControl: false, attributionControl: false,
  });

  if (meetup) {
    L.marker(center, { title: 'Meetup' }).addTo(map);
    L.circle(center, {
      radius,
      color: '#22C55E', weight: 1, dashArray: '4 4',
      fillColor: '#22C55E', fillOpacity: 0.08,
    }).addTo(map);
  }

  const routeLayer = routeGeoJson
    ? await addRouteGeoJson(map, routeGeoJson, {
        color: theme === 'dark' ? '#FB923C' : '#F97316',
        weight: 5,
        opacity: 0.88,
        fit: true,
        fitPadding: [28, 28],
      })
    : null;

  const trail = L.polyline([], {
    color: '#F97316', weight: 5, opacity: 0.92,
    lineJoin: 'round', lineCap: 'round',
  }).addTo(map);

  const me = L.circleMarker(center, {
    radius: 8, weight: 3, color: '#fff',
    fillColor: '#F97316', fillOpacity: 1,
  }).addTo(map);

  const points = []; // {lat, lng, ts, accuracy}
  let watchId = null;
  let firstFix = true;

  function push(lat, lng, accuracy) {
    const latlng = L.latLng(lat, lng);
    points.push({ lat, lng, ts: Date.now(), accuracy });
    trail.addLatLng(latlng);
    me.setLatLng(latlng);
    if (firstFix) {
      firstFix = false;
      map.setView(latlng, 17);
    } else {
      map.panTo(latlng, { animate: true, duration: 0.5 });
    }
  }

  return {
    map, trail, me, routeLayer,

    /** Re-centre the map on the latest fix (or meetup if none yet). */
    recenter() {
      const last = points[points.length - 1];
      const ll = last ? [last.lat, last.lng] : center;
      map.setView(ll, Math.max(map.getZoom(), 16), { animate: true });
    },

    zoomIn()  { map.setZoom(map.getZoom() + 1); },
    zoomOut() { map.setZoom(map.getZoom() - 1); },

    start({ onError } = {}) {
      if (!('geolocation' in navigator)) throw new Error('Geolocation unsupported');
      watchId = navigator.geolocation.watchPosition(
        (pos) => push(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        (err) => onError?.(err),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
      );
    },

    stop() {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    },

    getPoints() { return points.slice(); },

    getDistanceMeters() {
      let d = 0;
      for (let i = 1; i < points.length; i++) {
        d += haversineMeters(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
      }
      return d;
    },

    /** "lat,lng;lat,lng;..." — compact enough for the `runs.polyline` text column. */
    getPolyline() {
      return points.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(';');
    },

    /**
     * Simulate a position somewhere near `center` — used as a fallback
     * when the device has no geolocation (e.g. desktop). Adds a jittery
     * ~3.1 m step every call.
     */
    simulateStep(prev) {
      const base = prev ?? (points[points.length - 1] ?? { lat: center[0], lng: center[1] });
      const jitterLat = (Math.random() - 0.5) * 0.00004;
      const jitterLng = (Math.random() - 0.5) * 0.00004;
      const nextLat = base.lat + 0.00003 + jitterLat;
      const nextLng = base.lng + 0.00003 + jitterLng;
      push(nextLat, nextLng, 999);
    },
  };
}
