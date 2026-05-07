/** Safely escape a string for direct interpolation into innerHTML. */
export function esc(v) {
  if (v == null) return ''
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function initials(name) {
  if (!name) return 'R'
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export function tier(totalMeters) {
  const km = (totalMeters || 0) / 1000
  if (km >= 50)  return { name: 'Platinum', emoji: '🏆' }
  if (km >= 30)  return { name: 'Gold',     emoji: '🥇' }
  if (km >= 15)  return { name: 'Silver',   emoji: '🥈' }
  if (km >= 5)   return { name: 'Bronze',   emoji: '🥉' }
  return { name: 'Rookie', emoji: '👟' }
}
