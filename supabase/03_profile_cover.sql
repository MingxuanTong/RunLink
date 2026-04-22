-- Add profile cover image support for existing databases.
alter table public.profiles
  add column if not exists cover_url text;
