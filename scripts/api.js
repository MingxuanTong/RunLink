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
  return (data ?? []).filter(c => mine.has(c.id));
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
  const { data, error } = await supabase
    .from('registrations')
    .insert({ activity_id: activityId, user_id: user.id, group_name: groupName, status: 'registered' })
    .select('*').single();
  if (error) throw error;
  return data;
}

export async function cancelRegistration(activityId) {
  const user = await getCurrentUser();
  const { error } = await supabase
    .from('registrations')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('activity_id', activityId).eq('user_id', user.id);
  if (error) throw error;
}

export async function checkIn({ activityId, method, lat, lng, accuracy }) {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from('registrations')
    .update({
      status: 'checked_in',
      checkin_method: method,
      checkin_ts: new Date().toISOString(),
      checkin_lat: lat ?? null,
      checkin_lng: lng ?? null,
      checkin_accuracy: accuracy != null ? Math.round(accuracy) : null,
    })
    .eq('activity_id', activityId).eq('user_id', user.id)
    .select('*').single();
  if (error) throw error;
  return data;
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
