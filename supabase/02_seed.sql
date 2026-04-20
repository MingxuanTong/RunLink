-- =====================================================================
-- RunLink · Seed demo data
-- Run this AFTER 00_schema.sql and 01_policies.sql.
--
-- PRE-REQUISITE:
--   Create at least ONE test user first via Supabase Dashboard
--     -> Authentication -> Users -> "Add user" -> Create new user
--     Use e.g. demo@runapp.test / Demo12345!
--   (The profile row will be auto-created by the trigger from 00_schema.sql.)
--
-- This script picks the FIRST user in auth.users as the demo owner
-- and builds 2 clubs + 6 activities around them.
-- Re-running: safe; it deletes previous rows that start with the marker
-- 'DEMO · ' and re-inserts a fresh set.
-- =====================================================================

do $$
declare
  v_owner     uuid;
  v_club_sh   uuid := gen_random_uuid();
  v_club_bj   uuid := gen_random_uuid();
  v_now       timestamptz := now();
begin
  -- 1. Pick the first signed-up user as the demo owner
  select id into v_owner
  from auth.users
  order by created_at asc
  limit 1;

  if v_owner is null then
    raise exception 'No auth users found. Please sign up at least one user '
                    'via Supabase Dashboard -> Authentication -> Users first.';
  end if;

  -- 2. Clean up previous demo rows (activities + clubs that start with 'DEMO ·')
  delete from public.activities where title like 'DEMO · %';
  delete from public.clubs      where name  like 'DEMO · %';

  -- 3. Demo clubs
  insert into public.clubs (id, name, crest_url, description, timezone, visibility, owner_id)
  values
    (v_club_sh,
     'DEMO · Go Runners Shanghai',
     'https://api.dicebear.com/7.x/shapes/svg?seed=Shanghai',
     'Friendly weekly runs along the Huangpu River. All paces welcome.',
     'Asia/Shanghai',
     'public',
     v_owner),
    (v_club_bj,
     'DEMO · Beijing Pacers',
     'https://api.dicebear.com/7.x/shapes/svg?seed=Beijing',
     'Morning interval sessions at the Olympic Forest Park.',
     'Asia/Shanghai',
     'public',
     v_owner);

  -- (The trigger trg_clubs_sync_owner will insert club_members rows.)

  -- 4. Demo activities · Shanghai
  insert into public.activities (
    club_id, title, description, cover_url,
    start_at, end_at, checkin_window_start, checkin_window_end,
    meetup_name, meetup_lat, meetup_lng, geofence_m,
    total_cap, groups, status, created_by
  ) values
  (
    v_club_sh,
    'DEMO · Sunset Bund 5K',
    'Easy chat-pace loop around the Bund. Meet at the lighthouse.',
    'https://images.unsplash.com/photo-1571008887538-b36bb32f4571?w=800',
    v_now + interval '2 days'  + interval '11 hours',   -- 19:00 local ish
    v_now + interval '2 days'  + interval '13 hours',
    v_now + interval '2 days'  + interval '10 hours 30 minutes',
    v_now + interval '2 days'  + interval '11 hours 15 minutes',
    'Bund Lighthouse', 31.2420, 121.4901, 50,
    40,
    '[{"name":"5K Chill","cap":25},{"name":"5K Push","cap":15}]'::jsonb,
    'published', v_owner
  ),
  (
    v_club_sh,
    'DEMO · Weekend Long Run 10K',
    'Continuous 10K along Xuhui Riverside. Water provided at 5K mark.',
    'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800',
    v_now + interval '5 days'  + interval '23 hours',   -- Saturday morning
    v_now + interval '6 days'  + interval '2 hours',
    v_now + interval '5 days'  + interval '22 hours 30 minutes',
    v_now + interval '5 days'  + interval '23 hours 30 minutes',
    'Xuhui Riverside Gate 3', 31.1820, 121.4600, 50,
    30,
    '[{"name":"10K","cap":20},{"name":"7K","cap":10}]'::jsonb,
    'published', v_owner
  ),
  (
    v_club_sh,
    'DEMO · Tuesday Track Intervals',
    '6 x 800m at 5K pace, 2 min recovery. Bring a watch.',
    'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=800',
    v_now + interval '9 days'  + interval '12 hours',
    v_now + interval '9 days'  + interval '13 hours 30 minutes',
    v_now + interval '9 days'  + interval '11 hours 45 minutes',
    v_now + interval '9 days'  + interval '12 hours 15 minutes',
    'Jiangwan Stadium Track', 31.3010, 121.5120, 50,
    20,
    '[{"name":"Track","cap":20}]'::jsonb,
    'published', v_owner
  ),
  -- A past activity so "Past" tab + reflections work
  (
    v_club_sh,
    'DEMO · Last Weekend 5K',
    'Completed run. Use this to test post-run reflections & monthly mileage.',
    'https://images.unsplash.com/photo-1486218119243-13883505764c?w=800',
    v_now - interval '5 days'  + interval '1 hour',
    v_now - interval '5 days'  + interval '2 hours',
    v_now - interval '5 days'  + interval '30 minutes',
    v_now - interval '5 days'  + interval '1 hour 15 minutes',
    'Century Park Gate 1', 31.2200, 121.5450, 50,
    35,
    '[{"name":"5K","cap":35}]'::jsonb,
    'completed', v_owner
  );

  -- 5. Demo activities · Beijing
  insert into public.activities (
    club_id, title, description, cover_url,
    start_at, end_at, checkin_window_start, checkin_window_end,
    meetup_name, meetup_lat, meetup_lng, geofence_m,
    total_cap, groups, status, created_by
  ) values
  (
    v_club_bj,
    'DEMO · Olympic Park Morning 8K',
    'Scenic loop around the Olympic Forest Park north trail.',
    'https://images.unsplash.com/photo-1530137073265-95c4a90c5b7d?w=800',
    v_now + interval '3 days'  + interval '22 hours',
    v_now + interval '4 days'  + interval '0 hours',
    v_now + interval '3 days'  + interval '21 hours 30 minutes',
    v_now + interval '3 days'  + interval '22 hours 15 minutes',
    'Olympic Park South Gate', 40.0050, 116.3850, 50,
    25,
    '[{"name":"8K","cap":25}]'::jsonb,
    'published', v_owner
  ),
  (
    v_club_bj,
    'DEMO · Hill Repeats — Xiangshan',
    '4 x 600m uphill. Meet at the Xiangshan north gate parking.',
    'https://images.unsplash.com/photo-1526676537331-7747bf8278fc?w=800',
    v_now + interval '7 days'  + interval '23 hours',
    v_now + interval '8 days'  + interval '1 hour',
    v_now + interval '7 days'  + interval '22 hours 30 minutes',
    v_now + interval '7 days'  + interval '23 hours 15 minutes',
    'Xiangshan North Gate', 40.0170, 116.1850, 50,
    15,
    '[{"name":"Hills","cap":15}]'::jsonb,
    'published', v_owner
  );

  -- 6. Give the demo owner a couple of runs so leaderboard has data
  insert into public.runs (user_id, activity_id, distance_m, duration_s, avg_pace_s_per_km, started_at, ended_at)
  values
    (v_owner, null, 5020, 1620, 323, v_now - interval '12 days', v_now - interval '12 days' + interval '27 minutes'),
    (v_owner, null, 8140, 2760, 339, v_now - interval '8 days',  v_now - interval '8 days'  + interval '46 minutes'),
    (v_owner, null, 5100, 1580, 310, v_now - interval '3 days',  v_now - interval '3 days'  + interval '26 minutes');

  raise notice 'Seed complete. Demo owner: %  Clubs: Shanghai=%, Beijing=%',
    v_owner, v_club_sh, v_club_bj;
end $$;

-- =====================================================================
-- Quick sanity checks (run these separately if you want):
--   select id, name, owner_id from public.clubs;
--   select id, title, start_at, status from public.activities order by start_at;
--   select * from public.v_monthly_mileage;
-- =====================================================================
