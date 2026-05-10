# 02 · Row Level Security policies

**Component:** Access control for every database table
**Files produced:** The security migration

## Prompt

> Set up row-level security on every table. Anyone can read profiles
> but only the owner can edit them. Public clubs are visible to
> everyone; private clubs only to members. Users can create, edit,
> and delete their own registrations, runs, and reflections —
> nothing else. Activity organizers should be able to view
> registrations for their activities. Write helper functions to
> check whether a user is an organizer or member of a club.

## Post-migration hardening

Supabase's security advisor flagged two issues after the migration:

- The monthly leaderboard view was bypassing row-level security because
  it ran with the view owner's permissions instead of the caller's.
  We recreated it so it respects the querying user's access rules.
- A trigger function had a mutable search path, which is a potential
  security risk. We pinned it to the public schema.

A remaining warning about leaked password protection is a dashboard
toggle, not something we could fix in code — documented as a manual
step for the project owner.
