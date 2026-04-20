-- =====================================================================
-- RunLink · Row Level Security policies
-- Run AFTER 00_schema.sql.
-- Idempotent: drops existing policies by name before recreating.
-- =====================================================================

-- Enable RLS on every table
alter table public.profiles       enable row level security;
alter table public.clubs          enable row level security;
alter table public.club_members   enable row level security;
alter table public.activities     enable row level security;
alter table public.registrations  enable row level security;
alter table public.runs           enable row level security;
alter table public.reflections    enable row level security;

-- Helper: is caller an organizer of a given club?
create or replace function public.is_club_organizer(p_club_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.club_members
    where club_id = p_club_id
      and user_id = auth.uid()
      and role in ('owner','co_organizer')
  );
$$;

-- Helper: is caller a member of a given club?
create or replace function public.is_club_member(p_club_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.club_members
    where club_id = p_club_id and user_id = auth.uid()
  );
$$;

-- =====================================================================
-- storage bucket
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'activity-assets',
  'activity-assets',
  true,
  10485760,
  array[
    'image/png','image/jpeg','image/webp','image/gif',
    'application/gpx+xml','application/geo+json','application/json','application/xml','text/xml',
    'application/octet-stream','text/plain'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- =====================================================================
-- profiles
-- =====================================================================
drop policy if exists profiles_read_all        on public.profiles;
drop policy if exists profiles_update_self     on public.profiles;
drop policy if exists profiles_insert_self     on public.profiles;

create policy profiles_read_all on public.profiles
  for select to authenticated
  using (true);

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

-- =====================================================================
-- clubs
-- =====================================================================
drop policy if exists clubs_read_public        on public.clubs;
drop policy if exists clubs_insert_authed      on public.clubs;
drop policy if exists clubs_update_organizer   on public.clubs;
drop policy if exists clubs_delete_owner       on public.clubs;

-- Anyone logged-in can see public clubs; members can see their private clubs
create policy clubs_read_public on public.clubs
  for select to authenticated
  using (
    visibility = 'public'
    or public.is_club_member(id)
  );

-- Any authenticated user can create a club (they become owner)
create policy clubs_insert_authed on public.clubs
  for insert to authenticated
  with check (auth.uid() = owner_id);

-- Organizers (owner or co_organizer) can update
create policy clubs_update_organizer on public.clubs
  for update to authenticated
  using (public.is_club_organizer(id))
  with check (public.is_club_organizer(id));

-- Only owner can delete
create policy clubs_delete_owner on public.clubs
  for delete to authenticated
  using (owner_id = auth.uid());

-- =====================================================================
-- club_members
-- =====================================================================
drop policy if exists members_read_own_clubs    on public.club_members;
drop policy if exists members_join_self         on public.club_members;
drop policy if exists members_leave_self        on public.club_members;
drop policy if exists members_manage_organizer  on public.club_members;

-- Read: members of the same club, or the user themselves
create policy members_read_own_clubs on public.club_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_club_member(club_id)
  );

-- Join a club (self-insert as member)
create policy members_join_self on public.club_members
  for insert to authenticated
  with check (user_id = auth.uid() and role = 'member');

-- Leave a club (delete own row), but owner cannot leave this way
create policy members_leave_self on public.club_members
  for delete to authenticated
  using (user_id = auth.uid() and role <> 'owner');

-- Organizers can manage (promote/remove) members
create policy members_manage_organizer on public.club_members
  for all to authenticated
  using (public.is_club_organizer(club_id))
  with check (public.is_club_organizer(club_id));

-- =====================================================================
-- activities
-- =====================================================================
drop policy if exists activities_read_public     on public.activities;
drop policy if exists activities_insert_organizer on public.activities;
drop policy if exists activities_update_organizer on public.activities;
drop policy if exists activities_delete_organizer on public.activities;

create policy activities_read_public on public.activities
  for select to authenticated
  using (
    exists (
      select 1 from public.clubs c
      where c.id = activities.club_id
        and (c.visibility = 'public' or public.is_club_member(c.id))
    )
  );

create policy activities_insert_organizer on public.activities
  for insert to authenticated
  with check (public.is_club_organizer(club_id));

create policy activities_update_organizer on public.activities
  for update to authenticated
  using (public.is_club_organizer(club_id))
  with check (public.is_club_organizer(club_id));

create policy activities_delete_organizer on public.activities
  for delete to authenticated
  using (public.is_club_organizer(club_id));

-- =====================================================================
-- registrations
-- =====================================================================
drop policy if exists reg_read_self_or_organizer   on public.registrations;
drop policy if exists reg_insert_self              on public.registrations;
drop policy if exists reg_update_self_or_organizer on public.registrations;
drop policy if exists reg_delete_self              on public.registrations;

-- Read: the user themselves, OR organizers of the club that owns the activity
create policy reg_read_self_or_organizer on public.registrations
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.activities a
      where a.id = registrations.activity_id
        and public.is_club_organizer(a.club_id)
    )
  );

-- Insert: user can only register themselves
create policy reg_insert_self on public.registrations
  for insert to authenticated
  with check (user_id = auth.uid());

-- Update: the user (for cancel, check-in) OR organizer (for manual status)
create policy reg_update_self_or_organizer on public.registrations
  for update to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.activities a
      where a.id = registrations.activity_id
        and public.is_club_organizer(a.club_id)
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.activities a
      where a.id = registrations.activity_id
        and public.is_club_organizer(a.club_id)
    )
  );

-- Delete: only user themselves (hard-cancel). Organizers should prefer status update.
create policy reg_delete_self on public.registrations
  for delete to authenticated
  using (user_id = auth.uid());

-- =====================================================================
-- runs
-- =====================================================================
drop policy if exists runs_read_self_or_clubmate on public.runs;
drop policy if exists runs_insert_self           on public.runs;
drop policy if exists runs_update_self           on public.runs;
drop policy if exists runs_delete_self           on public.runs;

-- Read: the user themselves, OR any user who shares a club (for leaderboard)
create policy runs_read_self_or_clubmate on public.runs
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.club_members cm1
      join public.club_members cm2 on cm1.club_id = cm2.club_id
      where cm1.user_id = auth.uid()
        and cm2.user_id = runs.user_id
    )
  );

create policy runs_insert_self on public.runs
  for insert to authenticated
  with check (user_id = auth.uid());

create policy runs_update_self on public.runs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy runs_delete_self on public.runs
  for delete to authenticated
  using (user_id = auth.uid());

-- =====================================================================
-- reflections
-- =====================================================================
drop policy if exists reflections_read_clubmates on public.reflections;
drop policy if exists reflections_write_self     on public.reflections;

-- Read: anyone in a club that owns the activity
create policy reflections_read_clubmates on public.reflections
  for select to authenticated
  using (
    exists (
      select 1 from public.activities a
      where a.id = reflections.activity_id
        and public.is_club_member(a.club_id)
    )
  );

create policy reflections_write_self on public.reflections
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =====================================================================
-- delete club (owner only) — bypasses RLS for FK cascades
-- Cascading deletes hit registrations / reflections / runs.activity_id
-- updates that plain clients cannot pass under member-only RLS.
-- =====================================================================
create or replace function public.delete_owned_club(p_club_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.clubs c
    where c.id = p_club_id and c.owner_id = auth.uid()
  ) then
    raise exception 'forbidden: only the club owner can delete this club';
  end if;

  delete from public.clubs where id = p_club_id;
end;
$$;

revoke all on function public.delete_owned_club(uuid) from public;
grant execute on function public.delete_owned_club(uuid) to authenticated;

-- =====================================================================
-- storage.objects · activity-assets bucket
-- =====================================================================
drop policy if exists activity_assets_read   on storage.objects;
drop policy if exists activity_assets_insert on storage.objects;
drop policy if exists activity_assets_update on storage.objects;
drop policy if exists activity_assets_delete on storage.objects;

create policy activity_assets_read on storage.objects
  for select to authenticated
  using (bucket_id = 'activity-assets');

create policy activity_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'activity-assets');

create policy activity_assets_update on storage.objects
  for update to authenticated
  using (bucket_id = 'activity-assets')
  with check (bucket_id = 'activity-assets');

create policy activity_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'activity-assets');

-- =====================================================================
-- Done. Next: run 02_seed.sql (requires at least one signed-up user)
-- =====================================================================
