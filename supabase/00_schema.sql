-- =====================================================================
-- RunLink · Supabase schema
-- Run this file FIRST in the Supabase SQL Editor.
-- Idempotent: safe to re-run during development.
-- =====================================================================

-- ---------- Extensions ----------
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ---------- Utility: updated_at trigger ----------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- 1. profiles (1:1 with auth.users)
-- =====================================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  avatar_url    text,
  bio           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Auto-create a profile row on every new auth.users insert
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1),
      'Runner'
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 2. clubs
-- =====================================================================
create table if not exists public.clubs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  crest_url   text,
  description text,
  timezone    text not null default 'Asia/Shanghai',
  visibility  text not null default 'public'
              check (visibility in ('public','private')),
  owner_id    uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_clubs_updated_at on public.clubs;
create trigger trg_clubs_updated_at
  before update on public.clubs
  for each row execute function public.tg_set_updated_at();

create index if not exists idx_clubs_owner on public.clubs(owner_id);

-- =====================================================================
-- 3. club_members
-- =====================================================================
create table if not exists public.club_members (
  club_id    uuid not null references public.clubs(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member'
             check (role in ('owner','co_organizer','member')),
  joined_at  timestamptz not null default now(),
  primary key (club_id, user_id)
);

create index if not exists idx_club_members_user on public.club_members(user_id);

-- Keep owner row in sync with clubs.owner_id
create or replace function public.sync_club_owner_member()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.club_members (club_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (club_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists trg_clubs_sync_owner on public.clubs;
create trigger trg_clubs_sync_owner
  after insert or update of owner_id on public.clubs
  for each row execute function public.sync_club_owner_member();

-- =====================================================================
-- 4. activities
-- =====================================================================
create table if not exists public.activities (
  id                    uuid primary key default gen_random_uuid(),
  club_id               uuid not null references public.clubs(id) on delete cascade,
  title                 text not null,
  description           text,
  cover_url             text,
  start_at              timestamptz not null,          -- UTC
  end_at                timestamptz not null,          -- UTC
  checkin_window_start  timestamptz,
  checkin_window_end    timestamptz,
  meetup_name           text,
  meetup_lat            double precision,
  meetup_lng            double precision,
  route_file_url        text,
  route_file_name       text,
  route_file_kind       text,
  route_geojson         jsonb,
  geofence_m            integer not null default 50,
  total_cap             integer,                        -- null = unlimited
  groups                jsonb not null default '[]'::jsonb,
  status                text not null default 'published'
                        check (status in ('draft','published','cancelled','completed')),
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  check (end_at > start_at),
  check (checkin_window_end is null or checkin_window_end <= end_at)
);

drop trigger if exists trg_activities_updated_at on public.activities;
create trigger trg_activities_updated_at
  before update on public.activities
  for each row execute function public.tg_set_updated_at();

create index if not exists idx_activities_club   on public.activities(club_id);
create index if not exists idx_activities_start  on public.activities(start_at);
create index if not exists idx_activities_status on public.activities(status);

-- =====================================================================
-- 5. registrations
-- =====================================================================
create table if not exists public.registrations (
  id               uuid primary key default gen_random_uuid(),
  activity_id      uuid not null references public.activities(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  group_name       text,
  status           text not null default 'registered'
                   check (status in (
                     'registered',
                     'checked_in',
                     'late',
                     'cancelled',
                     'no_run_recorded',
                     'completed'
                   )),
  checkin_method   text check (checkin_method in ('gps','fallback')),
  checkin_ts       timestamptz,
  checkin_lat      double precision,
  checkin_lng      double precision,
  checkin_accuracy integer,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (activity_id, user_id)
);

drop trigger if exists trg_registrations_updated_at on public.registrations;
create trigger trg_registrations_updated_at
  before update on public.registrations
  for each row execute function public.tg_set_updated_at();

create index if not exists idx_registrations_user     on public.registrations(user_id);
create index if not exists idx_registrations_activity on public.registrations(activity_id);
create index if not exists idx_registrations_status   on public.registrations(status);

-- =====================================================================
-- 6. runs
-- =====================================================================
create table if not exists public.runs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  activity_id        uuid references public.activities(id) on delete set null,
  distance_m         integer not null default 0,
  duration_s         integer not null default 0,
  avg_pace_s_per_km  integer,
  started_at         timestamptz not null,
  ended_at           timestamptz,
  polyline           text,                              -- encoded path, optional
  created_at         timestamptz not null default now()
);

create index if not exists idx_runs_user  on public.runs(user_id);
create index if not exists idx_runs_month on public.runs(date_trunc('month', started_at));

-- =====================================================================
-- 7. reflections (post-run emoji + note)
-- =====================================================================
create table if not exists public.reflections (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  emoji        text not null,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (activity_id, user_id)
);

drop trigger if exists trg_reflections_updated_at on public.reflections;
create trigger trg_reflections_updated_at
  before update on public.reflections
  for each row execute function public.tg_set_updated_at();

-- =====================================================================
-- Helper view: monthly leaderboard per club
-- =====================================================================
create or replace view public.v_monthly_mileage as
select
  cm.club_id,
  r.user_id,
  p.display_name,
  p.avatar_url,
  date_trunc('month', r.started_at) as month,
  sum(r.distance_m)::bigint          as total_distance_m,
  count(*)::int                      as run_count
from public.runs r
join public.profiles p     on p.id = r.user_id
join public.club_members cm on cm.user_id = r.user_id
group by cm.club_id, r.user_id, p.display_name, p.avatar_url, date_trunc('month', r.started_at);

-- =====================================================================
-- Done. Next: run 01_policies.sql
-- =====================================================================
