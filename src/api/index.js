/**
 * Thin data layer over the Supabase client.
 *
 * All functions return Promises that resolve with typed data
 * (matching the Postgres schema) or reject with the underlying error.
 */
import { supabase } from '@/lib/supabase'

/* =========================================================== Auth */

export async function signUp({ email, password, displayName }) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: displayName || email.split('@')[0] } },
  })
  if (error) throw error
  return data
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

let _cachedUser = null
let _cachedUserTs = 0
const USER_CACHE_TTL = 30_000

export async function getCurrentUser() {
  if (_cachedUser && Date.now() - _cachedUserTs < USER_CACHE_TTL) return _cachedUser
  const { data } = await supabase.auth.getUser()
  _cachedUser = data.user ?? null
  _cachedUserTs = Date.now()
  return _cachedUser
}

export function invalidateUserCache() {
  _cachedUser = null
  _cachedUserTs = 0
}

export function onAuthStateChange(cb) {
  return supabase.auth.onAuthStateChange((event, session) => cb(event, session))
}

/* ======================================================== Profile */

export async function getMyProfile() {
  const user = await getCurrentUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function updateMyProfile(patch) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

/* ========================================================== Clubs */

export async function listClubs({ mineOnly = false } = {}) {
  const user = await getCurrentUser()
  if (mineOnly && !user) return []
  if (!mineOnly) {
    const { data, error } = await supabase
      .from('clubs').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  }
  const [{ data: memberClubs, error: mErr }, { data: ownedClubs, error: oErr }] = await Promise.all([
    supabase.from('clubs')
      .select('*, club_members!inner(user_id)')
      .eq('club_members.user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase.from('clubs')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false }),
  ])
  if (mErr) throw mErr
  if (oErr) throw oErr
  const seen = new Set()
  const result = []
  for (const c of [...(memberClubs ?? []), ...(ownedClubs ?? [])]) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    delete c.club_members
    result.push(c)
  }
  return result
}

export async function getClub(clubId) {
  const { data, error } = await supabase
    .from('clubs').select('*').eq('id', clubId).maybeSingle()
  if (error) throw error
  return data
}

export async function createClub({ name, description, timezone = 'Asia/Shanghai', visibility = 'public', crest_url }) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('clubs')
    .insert({ name, description, timezone, visibility, crest_url, owner_id: user.id })
    .select('*').single()
  if (error) throw error
  return data
}

export async function joinClub(clubId) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('club_members')
    .insert({ club_id: clubId, user_id: user.id, role: 'member' })
  if (error && error.code !== '23505') throw error
}

export async function leaveClub(clubId) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('club_members').delete()
    .eq('club_id', clubId).eq('user_id', user.id)
  if (error) throw error
}

export async function transferClubOwnership({ clubId, newOwnerId }) {
  const user = await getCurrentUser()
  const { error } = await supabase
    .from('clubs').update({ owner_id: newOwnerId })
    .eq('id', clubId).eq('owner_id', user.id)
  if (error) throw error
  await supabase.from('club_members')
    .update({ role: 'member' })
    .eq('club_id', clubId).eq('user_id', user.id)
}

export async function deleteClub(clubId) {
  const { error } = await supabase.rpc('delete_owned_club', { p_club_id: clubId })
  if (error) throw error
}

export async function setMemberRole({ clubId, userId, role }) {
  const { error } = await supabase
    .from('club_members')
    .update({ role })
    .eq('club_id', clubId).eq('user_id', userId)
  if (error) throw error
}

export async function listClubMembers(clubId) {
  const { data, error } = await supabase
    .from('club_members')
    .select('role, joined_at, profile:profiles(id, display_name, avatar_url)')
    .eq('club_id', clubId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/* ===================================================== Activities */

export async function listActivities({ clubId, status, timeframe, limit = 50 } = {}) {
  let q = supabase
    .from('activities')
    .select('*, club:clubs(id, name, crest_url, timezone)')
    .order('start_at', { ascending: true })
    .limit(limit)
  if (clubId) q = q.eq('club_id', clubId)
  if (status) q = q.eq('status', status)
  if (timeframe === 'upcoming') q = q.gte('end_at', new Date().toISOString())
  if (timeframe === 'past')     q = q.lt('end_at',  new Date().toISOString())
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function getActivity(activityId) {
  const { data, error } = await supabase
    .from('activities')
    .select('*, club:clubs(id, name, crest_url, timezone, owner_id)')
    .eq('id', activityId).maybeSingle()
  if (error) throw error
  return data
}

export async function createActivity(payload) {
  const user = await getCurrentUser()
  const { data, error } = await supabase
    .from('activities')
    .insert({ ...payload, created_by: user.id })
    .select('*').single()
  if (error) throw error
  return data
}

export async function uploadActivityAsset(file, { folder = 'misc' } = {}) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')
  if (!file) throw new Error('No file selected')

  const lowerName = (file.name || '').toLowerCase().trim()
  const browserType = (file.type || '').trim()
  const byExtension =
    /\.gpx$/.test(lowerName) ? 'application/gpx+xml' :
    /\.geojson$/.test(lowerName) ? 'application/geo+json' :
    /\.json$/.test(lowerName) ? 'application/json' :
    /\.png$/.test(lowerName) ? 'image/png' :
    /\.(jpg|jpeg)$/.test(lowerName) ? 'image/jpeg' :
    /\.webp$/.test(lowerName) ? 'image/webp' :
    /\.gif$/.test(lowerName) ? 'image/gif' :
    null
  const genericBrowserType = !browserType ||
    browserType === 'application/octet-stream' ||
    browserType === 'text/plain'
  const inferredType =
    (byExtension && genericBrowserType) ? byExtension :
    browserType || byExtension || 'application/octet-stream'

  const safeName = (file.name || 'upload.bin')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const extMatch = lowerName.match(/(\.[a-z0-9]+)$/)
  const normalizedName = (!safeName || safeName.startsWith('.'))
    ? `upload${extMatch?.[1] || '.bin'}`
    : safeName
  const path = `${user.id}/${folder}/${Date.now()}-${normalizedName}`

  const uploadBody = new File([file], file.name || 'upload.bin', {
    type: inferredType,
    lastModified: file instanceof File ? file.lastModified : Date.now(),
  })

  const { error: uploadError } = await supabase
    .storage
    .from('activity-assets')
    .upload(path, uploadBody, {
      cacheControl: '3600',
      upsert: false,
      contentType: inferredType,
    })
  if (uploadError) throw uploadError

  const { data } = supabase
    .storage
    .from('activity-assets')
    .getPublicUrl(path)

  return {
    path,
    publicUrl: data.publicUrl,
    name: file.name || 'upload.bin',
    mimeType: inferredType,
  }
}

export async function updateActivity(activityId, patch) {
  const { data, error } = await supabase
    .from('activities').update(patch).eq('id', activityId)
    .select('*').single()
  if (error) throw error
  return data
}

export async function cancelActivity(activityId) {
  return updateActivity(activityId, { status: 'cancelled' })
}

/* =========================================== Organizer Activities */

export async function listOrganizerActivities() {
  const user = await getCurrentUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('activities')
    .select('*, club:clubs!inner(id, name, crest_url, owner_id)')
    .eq('club.owner_id', user.id)
    .order('start_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/* =================================================== Registrations */

export async function listMyRegistrations({ timeframe } = {}) {
  const user = await getCurrentUser()
  if (!user) return []
  let q = supabase
    .from('registrations')
    .select('*, activity:activities!inner(*, club:clubs(id, name, crest_url))')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  const now = new Date().toISOString()
  if (timeframe === 'upcoming') q = q.gte('activity.end_at', now)
  if (timeframe === 'past')     q = q.lt('activity.end_at', now)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function getMyRegistration(activityId) {
  const user = await getCurrentUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('activity_id', activityId).eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function register({ activityId, groupName }) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')

  const [{ data: a }, { data: existing }] = await Promise.all([
    supabase.from('activities').select('total_cap, groups').eq('id', activityId).maybeSingle(),
    supabase.from('registrations').select('group_name, status').eq('activity_id', activityId).neq('status', 'cancelled'),
  ])
  if (a) {
    const totalCount = existing?.length ?? 0
    if (a.total_cap != null && totalCount >= a.total_cap) {
      throw new Error('This activity is full.')
    }
    const cap = (Array.isArray(a.groups) ? a.groups : [])
      .find(g => g?.name === groupName)?.cap
    if (cap != null) {
      const groupCount = (existing ?? []).filter(r => r.group_name === groupName).length
      if (groupCount >= cap) throw new Error(`Group "${groupName}" is full.`)
    }
  }

  const { data, error } = await supabase
    .from('registrations')
    .insert({ activity_id: activityId, user_id: user.id, group_name: groupName, status: 'registered' })
    .select('*').single()
  if (error) throw error
  return data
}

export async function getRegistrationCounts(activityId) {
  const { data } = await supabase
    .from('registrations')
    .select('group_name, status')
    .eq('activity_id', activityId)
    .neq('status', 'cancelled')
  const rows = data ?? []
  const byGroup = new Map()
  for (const r of rows) {
    byGroup.set(r.group_name || '', (byGroup.get(r.group_name || '') ?? 0) + 1)
  }
  return { total: rows.length, byGroup }
}

export async function cancelRegistration(activityId) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('registrations')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('activity_id', activityId).eq('user_id', user.id)
  if (error) throw error
}

export async function checkIn({ activityId, method, lat, lng, accuracy, targetUserId = null }) {
  const user = await getCurrentUser()

  let status = 'checked_in'
  const { data: act } = await supabase
    .from('activities')
    .select('start_at')
    .eq('id', activityId).maybeSingle()
  if (act?.start_at && new Date() > new Date(act.start_at)) {
    status = 'late'
  }

  const { data, error } = await supabase
    .from('registrations')
    .update({
      status,
      checkin_method: method,
      checkin_ts: new Date().toISOString(),
      checkin_lat: lat ?? null,
      checkin_lng: lng ?? null,
      checkin_accuracy: accuracy != null ? Math.round(accuracy) : null,
    })
    .eq('activity_id', activityId)
    .eq('user_id', targetUserId || user.id)
    .select('*').single()
  if (error) throw error
  return data
}

export async function manualCheckIn({ activityId, userId }) {
  return checkIn({ activityId, method: 'fallback', targetUserId: userId })
}

export async function listActivityRegistrations(activityId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('*, user:profiles(id, display_name, avatar_url)')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/* ============================================================ Runs */

export async function myRunsByActivity() {
  const user = await getCurrentUser()
  if (!user) return new Map()
  const { data } = await supabase
    .from('runs').select('activity_id')
    .eq('user_id', user.id)
    .not('activity_id', 'is', null)
  const map = new Map()
  for (const r of data ?? []) map.set(r.activity_id, (map.get(r.activity_id) ?? 0) + 1)
  return map
}

export async function listMyRuns({ limit = 50 } = {}) {
  const user = await getCurrentUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('runs').select('*')
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function saveRun({ activityId = null, distance_m, duration_s, started_at, ended_at, polyline }) {
  const user = await getCurrentUser()
  const avg_pace = distance_m > 0 ? Math.round((duration_s * 1000) / distance_m) : null
  const { data, error } = await supabase
    .from('runs')
    .insert({
      user_id: user.id,
      activity_id: activityId,
      distance_m, duration_s,
      avg_pace_s_per_km: avg_pace,
      started_at, ended_at, polyline,
    })
    .select('*').single()
  if (error) throw error
  return data
}

export async function listLeaderboard({ clubId, month }) {
  const m = month ?? new Date().toISOString().slice(0, 7) + '-01'
  const monthStart = new Date(m + 'T00:00:00Z').toISOString()
  const { data, error } = await supabase
    .from('v_monthly_mileage')
    .select('*')
    .eq('club_id', clubId)
    .eq('month', monthStart)
    .order('total_distance_m', { ascending: false })
  if (error) throw error
  return data ?? []
}

/* ===================================================== Challenges */

export async function listChallenges({ clubId }) {
  const { data, error } = await supabase
    .from('v_challenge_progress')
    .select('*')
    .eq('club_id', clubId)
    .order('end_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createChallenge({ clubId, title, goalType, goalValue, startAt, endAt }) {
  const user = await getCurrentUser()
  if (!user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('club_challenges')
    .insert({
      club_id: clubId,
      author_id: user.id,
      title,
      goal_type: goalType,
      goal_value: goalValue,
      start_at: startAt,
      end_at: endAt,
    })
    .select('*').single()
  if (error) throw error
  return data
}

export async function deleteChallenge(challengeId) {
  const { error } = await supabase
    .from('club_challenges').delete().eq('id', challengeId)
  if (error) throw error
}

/* ======================================================= Crew */

export async function listCrewMembers({ activityId, groupName }) {
  let q = supabase
    .from('registrations')
    .select('user_id, group_name, status, user:profiles(id, display_name, avatar_url)')
    .eq('activity_id', activityId)
    .in('status', ['checked_in', 'late'])
  if (groupName) q = q.eq('group_name', groupName)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

/* ==================================================== Reflections */

export async function getMyReflection(activityId) {
  const user = await getCurrentUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('reflections').select('*')
    .eq('activity_id', activityId).eq('user_id', user.id).maybeSingle()
  if (error) throw error
  return data
}

export async function upsertReflection({ activityId, emoji, note }) {
  const user = await getCurrentUser()
  const { data, error } = await supabase
    .from('reflections')
    .upsert(
      { activity_id: activityId, user_id: user.id, emoji, note },
      { onConflict: 'activity_id,user_id' }
    )
    .select('*').single()
  if (error) throw error
  return data
}

export async function listActivityReflections(activityId) {
  const { data, error } = await supabase
    .from('reflections')
    .select('*, user:profiles(display_name, avatar_url)')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/* ======================================================= Realtime */

export function subscribeToNewRegistrations(handler) {
  const channel = supabase
    .channel('public:registrations:new')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'registrations' },
      (payload) => handler(payload.new))
    .subscribe()
  return () => supabase.removeChannel(channel)
}

/* ===================================================== Live GPS Broadcast */

export function createRunChannel(activityId) {
  return supabase.channel(`run:${activityId}`, {
    config: { broadcast: { self: false } },
  })
}

export function onCrewPosition(channel, handler) {
  channel
    .on('broadcast', { event: 'gps' }, (payload) => handler(payload.payload))
    .subscribe()
}

export function broadcastPosition(channel, { userId, lat, lng }) {
  channel.send({
    type: 'broadcast',
    event: 'gps',
    payload: { userId, lat, lng, ts: Date.now() },
  })
}

export function removeRunChannel(channel) {
  supabase.removeChannel(channel)
}
