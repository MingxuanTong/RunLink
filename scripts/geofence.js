/**
 * Geofence utilities.
 *
 * Haversine formula → great-circle distance in metres, which is the
 * standard for GPS-grade proximity checks at club-meetup scale (< 1 km).
 */

const R = 6_371_000;

function toRad(d) { return (d * Math.PI) / 180; }

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Request current position with a bounded timeout, returning a stable
 * object shape { lat, lng, accuracy }. Rejects with an Error carrying
 * `code` (e.g. 'permission_denied', 'timeout', 'unavailable').
 */
export function getCurrentPosition({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(Object.assign(new Error('Geolocation unsupported'), { code: 'unavailable' }));
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => {
        const map = { 1: 'permission_denied', 2: 'unavailable', 3: 'timeout' };
        reject(Object.assign(new Error(err.message), { code: map[err.code] || 'unknown' }));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10_000 }
    );
  });
}

/**
 * Validate a check-in attempt against an activity's meetup point.
 * Returns one of:
 *   { ok: true,  distance, accuracy, lat, lng }         — within radius
 *   { ok: false, reason: 'too_far', distance, radius }
 *   { ok: false, reason: 'low_accuracy', accuracy }
 */
export async function validateCheckin(activity, { accuracyThreshold = 80 } = {}) {
  if (activity.meetup_lat == null || activity.meetup_lng == null) {
    return { ok: false, reason: 'no_meetup' };
  }
  const pos = await getCurrentPosition();
  if (pos.accuracy > accuracyThreshold) {
    return { ok: false, reason: 'low_accuracy', accuracy: pos.accuracy, ...pos };
  }
  const distance = haversineMeters(pos.lat, pos.lng, activity.meetup_lat, activity.meetup_lng);
  const radius = activity.geofence_m ?? 50;
  if (distance > radius) {
    return { ok: false, reason: 'too_far', distance, radius, ...pos };
  }
  return { ok: true, distance, ...pos };
}
