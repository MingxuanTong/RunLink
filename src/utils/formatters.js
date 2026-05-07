const MS_MIN = 60_000
const MS_HOUR = 3_600_000
const MS_DAY = 86_400_000

export function timeUntil(iso) {
  if (!iso) return ''
  const delta = new Date(iso).getTime() - Date.now()
  if (delta < 0) return 'started'
  const abs = Math.abs(delta)
  if (abs < MS_HOUR)  return `in ${Math.max(1, Math.round(abs / MS_MIN))} min`
  if (abs < MS_DAY)   return `in ${Math.round(abs / MS_HOUR)} h`
  const d = Math.round(abs / MS_DAY)
  return `in ${d} day${d === 1 ? '' : 's'}`
}

export function fmtDate(iso, { withTime = true } = {}) {
  if (!iso) return ''
  const d = new Date(iso)
  const date = d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
  if (!withTime) return date
  const time = d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

export function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function fmtDistance(m) {
  if (m == null) return '—'
  if (m >= 1000) return (m / 1000).toFixed(m % 1000 === 0 ? 0 : 2) + ' km'
  return `${Math.round(m)} m`
}

export function fmtDuration(sec) {
  if (sec == null) return '—'
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h) return `${h}h ${m.toString().padStart(2,'0')}m`
  return `${m}:${r.toString().padStart(2,'0')}`
}

export function fmtPace(sPerKm) {
  if (sPerKm == null) return '—'
  const m = Math.floor(sPerKm / 60)
  const s = Math.round(sPerKm % 60)
  return `${m}:${s.toString().padStart(2,'0')} /km`
}
