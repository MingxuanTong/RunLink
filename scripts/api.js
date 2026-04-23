/**
 * Thin data layer over the Supabase client.
 *
 * All functions return Promises that resolve with typed data
 * (matching the Postgres schema) or reject with the underlying error.
 */
import { supabase } from './supabase.js';

/* =========================================================== Auth */

export async function signUp({ email, password, displayName }) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: displayName || email.split('@')[0] } },
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export function onAuthStateChange(cb) {
  return supabase.auth.onAuthStateChange((event, session) => cb(event, session));
}

/* ======================================================== Profile */

export async function getMyProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateMyProfile(patch) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/* ========================================================== Clubs */

export async function listClubs({ mineOnly = false } = {}) {
  const user = await getCurrentUser();
  if (mineOnly && !user) return [];
  let q = supabase.from('clubs').select('*').order('created_at', { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  if (!mineOnly) return data ?? [];
  const { data: memberships } = await supabase
    .from('club_members').select('club_id').eq('user_id', user.id);
  const mine = new Set((memberships ?? []).map(m => m.club_id));
  // Be resilient to historical data drift where the owner row in `club_members`
  // is missing: owners should still see/manage their own clubs.
  return (data ?? []).filter(c => mine.has(c.id) || c.owner_id === user.id);
}

export async function getClub(clubId) {
  const { data, error } = await supabase
    .from('clubs').select('*').eq('id', clubId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createClub({ name, description, timezone = 'Asia/Shanghai', visibility = 'public', crest_url }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('clubs')
    .insert({ name, description, timezone, visibility, crest_url, owner_id: user.id })
    .select('*').single();
  if (error) throw error;
  return data;
}

export async function joinClub(clubId) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('club_members')
    .insert({ club_id: clubId, user_id: user.id, role: 'member' });
  if (error && error.code !== '23505') throw error;
}

export async function leaveClub(clubId) {
  const user = await getCurrentUser();
  const { error } = await supabase
    .from('club_members').delete()
    .eq('club_id', clubId).eq('user_id', user.id);
  if (error) throw error;
}

/**
 * Transfer ownership of a club to another existing member.
 * The DB trigger `sync_club_owner_member` will promote the new row to
 * 'owner' and we manually demote the previous owner to 'member'.
 */
export async function transferClubOwnership({ clubId, newOwnerId }) {
  const user = await getCurrentUser();
  const { error } = await supabase
    .from('clubs').update({ owner_id: newOwnerId })
    .eq('id', clubId).eq('owner_id', user.id);
  if (error) throw error;
  await supabase.from('club_members')
    .update({ role: 'member' })
    .eq('club_id', clubId).eq('user_id', user.id);
}

/**
 * Delete a club (owner only). Uses RPC with SECURITY DEFINER so Postgres
 * can apply FK cascades (activities → registrations/reflections, runs unlink)
 * without RLS blocking deletes on other users' rows.
 */
export async function deleteClub(clubId) {
  const { error } = await supabase.rpc('delete_owned_club', { p_club_id: clubId });
  if (error) throw error;
}

/** Owner sets a member's role (member / co_organizer). */
export async function setMemberRole({ clubId, userId, role }) {
  const { error } = await supabase
    .from('club_members')
    .update({ role })
    .eq('club_id', clubId).eq('user_id', userId);
  if (error) throw error;
}

export async function listClubMembers(clubId) {
  const { data, error } = await supabase
    .from('club_members')
    .select('role, joined_at, profile:profiles(id, display_name, avatar_url)')
    .eq('club_id', clubId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/* ===================================================== Activities */

export async function listActivities({ clubId, status, timeframe, limit = 50 } = {}) {
  let q = supabase
    .from('activities')
    .select('*, club:clubs(id, name, crest_url, timezone)')
    .order('start_at', { ascending: true })
    .limit(limit);
  if (clubId) q = q.eq('club_id', clubId);
  if (status) q = q.eq('status', status);
  if (timeframe === 'upcoming') q = q.gte('end_at', new Date().toISOString());
  if (timeframe === 'past')     q = q.lt('end_at',  new Date().toISOString());
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getActivity(activityId) {
  const { data, error } = await supabase
    .from('activities')
    .select('*, club:clubs(id, name, crest_url, timezone, owner_id)')
    .eq('id', activityId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createActivity(payload) {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('activities')
    .insert({ ...payload, created_by: user.id })
    .select('*').single();
  if (error) throw error;
  return data;
}

export async function uploadActivityAsset(file, { folder = 'misc' } = {}) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  if (!file) throw new Error('No file selected');

  const lowerName = (file.name || '').toLowerCase().trim();
  const browserType = (file.type || '').trim();
  // Browsers often report GPX / some images as application/octet-stream; the bucket
  // rejects that MIME. Prefer extension when the browser type is missing or generic.
  const byExtension =
    /\.gpx$/.test(lowerName) ? 'application/gpx+xml' :
    /\.geojson$/.test(lowerName) ? 'application/geo+json' :
    /\.json$/.test(lowerName) ? 'application/json' :
    /\.png$/.test(lowerName) ? 'image/png' :
    /\.(jpg|jpeg)$/.test(lowerName) ? 'image/jpeg' :
    /\.webp$/.test(lowerName) ? 'image/webp' :
    /\.gif$/.test(lowerName) ? 'image/gif' :
    null;
  const genericBrowserType = !browserType ||
    browserType === 'application/octet-stream' ||
    browserType === 'text/plain';
  const inferredType =
    (byExtension && genericBrowserType) ? byExtension :
    browserType || byExtension || 'application/octet-stream';

  const safeName = (file.name || 'upload.bin')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const extMatch = lowerName.match(/(\.[a-z0-9]+)$/);
  const normalizedName = (!safeName || safeName.startsWith('.'))
    ? `upload${extMatch?.[1] || '.bin'}`
    : safeName;
  const path = `${user.id}/${folder}/${Date.now()}-${normalizedName}`;

  // Storage validates the *Blob* Content-Type. Browsers often leave File.type as
  // application/octet-stream for GPX; passing only `contentType` in options is not enough.
  const uploadBody = new File([file], file.name || 'upload.bin', {
    type: inferredType,
    lastModified: file instanceof File ? file.lastModified : Date.now(),
  });

  const { error: uploadError } = await supabase
    .storage
    .from('activity-assets')
    .upload(path, uploadBody, {
      cacheControl: '3600',
      upsert: false,
      contentType: inferredType,
    });
  if (uploadError) throw uploadError;

  const { data } = supabase
    .storage
    .from('activity-assets')
    .getPublicUrl(path);

  return {
    path,
    publicUrl: data.publicUrl,
    name: file.name || 'upload.bin',
    mimeType: inferredType,
  };
}

export async function updateActivity(activityId, patch) {
  const { data, error } = await supabase
    .from('activities').update(patch).eq('id', activityId)
    .select('*').single();
  if (error) throw error;
  return data;
}

export async function cancelActivity(activityId) {
  return updateActivity(activityId, { status: 'cancelled' });
}

/* =================================================== Registrations */

export async function listMyRegistrations({ timeframe } = {}) {
  const user = await getCurrentUser();
  if (!user) return [];
  let q = supabase
    .from('registrations')
    .select('*, activity:activities(*, club:clubs(id, name, crest_url))')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  let rows = data ?? [];
  if (timeframe === 'upcoming') {
    rows = rows.filter(r => r.activity && new Date(r.activity.end_at) >= new Date());
  } else if (timeframe === 'past') {
    rows = rows.filter(r => r.activity && new Date(r.activity.end_at) < new Date());
  }
  return rows;
}

export async function getMyRegistration(activityId) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('activity_id', activityId).eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function register({ activityId, groupName }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');

  // Capacity check — activity total_cap and per-group cap live in
  // `activities.total_cap` and `activities.groups[].cap`. We read both and
  // count non-cancelled registrations before insert so users see a friendly
  // error instead of a generic RLS/constraint failure.
  const { data: a } = await supabase
    .from('activities')
    .select('total_cap, groups')
    .eq('id', activityId).maybeSingle();
  if (a) {
    const { data: existing } = await supabase
      .from('registrations')
      .select('group_name, status')
      .eq('activity_id', activityId)
      .neq('status', 'cancelled');
    const totalCount = existing?.length ?? 0;
    if (a.total_cap != null && totalCount >= a.total_cap) {
      throw new Error('This activity is full.');
    }
    const cap = (Array.isArray(a.groups) ? a.groups : [])
      .find(g => g?.name === groupName)?.cap;
    if (cap != null) {
      const groupCount = (existing ?? []).filter(r => r.group_name === groupName).length;
      if (groupCount >= cap) throw new Error(`Group "${groupName}" is full.`);
    }
  }

  const { data, error } = await supabase
    .from('registrations')
    .insert({ activity_id: activityId, user_id: user.id, group_name: groupName, status: 'registered' })
    .select('*').single();
  if (error) throw error;
  return data;
}

/** Counts non-cancelled registrations overall and per group. */
export async function getRegistrationCounts(activityId) {
  const { data } = await supabase
    .from('registrations')
    .select('group_name, status')
    .eq('activity_id', activityId)
    .neq('status', 'cancelled');
  const rows = data ?? [];
  const byGroup = new Map();
  for (const r of rows) {
    byGroup.set(r.group_name || '', (byGroup.get(r.group_name || '') ?? 0) + 1);
  }
  return { total: rows.length, byGroup };
}

export async function cancelRegistration(activityId) {
  const user = await getCurrentUser();
  const { error } = await supabase
    .from('registrations')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('activity_id', activityId).eq('user_id', user.id);
  if (error) throw error;
}

export async function checkIn({ activityId, method, lat, lng, accuracy, targetUserId = null }) {
  const user = await getCurrentUser();

  // Late detection — check-in timestamp strictly after start_at gets
  // status = 'late' (PRD §3.3 — "Late" tag on organizer reports).
  let status = 'checked_in';
  const { data: act } = await supabase
    .from('activities')
    .select('start_at')
    .eq('id', activityId).maybeSingle();
  if (act?.start_at && new Date() > new Date(act.start_at)) {
    status = 'late';
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
    .select('*').single();
  if (error) throw error;
  return data;
}

/** Organizer manually marks a runner as checked in. */
export async function manualCheckIn({ activityId, userId }) {
  return checkIn({ activityId, method: 'fallback', targetUserId: userId });
}

export async function listActivityRegistrations(activityId) {
  const { data, error } = await supabase
    .from('registrations')
    .select('*, user:profiles(id, display_name, avatar_url)')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/* ============================================================ Runs */

/** Map of activity_id -> run count (for the current user). */
export async function myRunsByActivity() {
  const user = await getCurrentUser();
  if (!user) return new Map();
  const { data } = await supabase
    .from('runs').select('activity_id')
    .eq('user_id', user.id)
    .not('activity_id', 'is', null);
  const map = new Map();
  for (const r of data ?? []) map.set(r.activity_id, (map.get(r.activity_id) ?? 0) + 1);
  return map;
}

export async function listMyRuns({ limit = 50 } = {}) {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('runs').select('*')
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function saveRun({ activityId = null, distance_m, duration_s, started_at, ended_at, polyline }) {
  const user = await getCurrentUser();
  const avg_pace = distance_m > 0 ? Math.round((duration_s * 1000) / distance_m) : null;
  const { data, error } = await supabase
    .from('runs')
    .insert({
      user_id: user.id,
      activity_id: activityId,
      distance_m, duration_s,
      avg_pace_s_per_km: avg_pace,
      started_at, ended_at, polyline,
    })
    .select('*').single();
  if (error) throw error;
  return data;
}

export async function listLeaderboard({ clubId, month }) {
  const m = month ?? new Date().toISOString().slice(0, 7) + '-01';
  const monthStart = new Date(m + 'T00:00:00Z').toISOString();
  const { data, error } = await supabase
    .from('v_monthly_mileage')
    .select('*')
    .eq('club_id', clubId)
    .eq('month', monthStart)
    .order('total_distance_m', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* ==================================================== Reflections */

export async function getMyReflection(activityId) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('reflections').select('*')
    .eq('activity_id', activityId).eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertReflection({ activityId, emoji, note }) {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('reflections')
    .upsert(
      { activity_id: activityId, user_id: user.id, emoji, note },
      { onConflict: 'activity_id,user_id' }
    )
    .select('*').single();
  if (error) throw error;
  return data;
}

export async function listActivityReflections(activityId) {
  const { data, error } = await supabase
    .from('reflections')
    .select('*, user:profiles(display_name, avatar_url)')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* ======================================================= Realtime */

/**
 * Subscribe to new registrations across the database. The RLS policy
 * will already filter what the user is allowed to see.
 * Returns an `unsubscribe` function.
 */
export function subscribeToNewRegistrations(handler) {
  const channel = supabase
    .channel('public:registrations:new')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'registrations' },
      (payload) => handler(payload.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}
