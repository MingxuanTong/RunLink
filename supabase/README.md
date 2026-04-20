# RunLink · Supabase setup

This folder contains the three SQL scripts you need to bootstrap the
RunLink backend on Supabase. Everything here is **free-tier only**.

```
supabase/
├── 00_schema.sql      # tables, triggers, helper view
├── 01_policies.sql    # Row Level Security (RLS) policies
├── 02_seed.sql        # demo clubs, activities, runs
└── README.md          # you are here
```

---

## 1 · Create the Supabase project (5 min)

1. Go to <https://supabase.com> → **Sign in with GitHub**.
2. Click **New project**.
   - **Name:** `runapp` (or anything)
   - **Database password:** generate a strong one → save it somewhere
   - **Region:** pick the closest (`Northeast Asia (Tokyo)` is fine for CN users)
   - **Plan:** **Free**
3. Wait ~2 minutes for the project to provision.

### Grab the two values you'll need in the frontend

From the project dashboard → **Project Settings → API**:

- **Project URL:** `https://YOURREF.supabase.co`
- **anon public key:** `eyJ....` (long JWT)

> ⚠ The `anon` key is safe to ship in the browser — Supabase designs it
> to be public. Security is enforced by **Row Level Security**, which we
> enable in `01_policies.sql`. **Never** put the `service_role` key in the
> frontend.

Keep these two values; we'll paste them into `scripts/supabase.js` later.

---

## 2 · Run the SQL scripts in order

Open **SQL Editor** in the left sidebar of your Supabase project.

### Step 1 — Schema

1. Click **+ New query**.
2. Open `00_schema.sql` from this folder, copy **the whole file**,
   paste into the editor.
3. Click **Run** (or `Ctrl/⌘ + Enter`).
4. Expected result: `Success. No rows returned.`

What this creates:

| Table              | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `profiles`         | 1:1 with `auth.users`, auto-filled by trigger                    |
| `clubs`            | Running clubs                                                    |
| `club_members`     | Membership + role (`owner` / `co_organizer` / `member`)          |
| `activities`       | Events (with geofence, groups, capacity)                         |
| `registrations`    | User ↔ activity, state machine for check-in lifecycle            |
| `runs`             | Recorded runs (for leaderboard)                                  |
| `reflections`      | Post-run emoji + note                                            |
| `v_monthly_mileage`| View used by the monthly leaderboard                             |

Plus two triggers worth knowing about:

- `on_auth_user_created` → auto-creates a `profiles` row for every new signup.
- `trg_clubs_sync_owner` → keeps `club_members` in sync with `clubs.owner_id`.

### Step 2 — RLS policies

1. New query → paste **all of `01_policies.sql`** → Run.
2. Expected result: `Success. No rows returned.`

Verify it actually took effect: **Authentication → Policies** should now
show a list of policies for every table.

This step also prepares Supabase Storage for activity assets:

- creates the public bucket `activity-assets`
- allows authenticated users to upload cover images and route files
- supports images plus `GPX` / `GeoJSON` route uploads up to `10 MB`

### Step 3 — Create a test user (required before seeding)

The seed script needs at least one real `auth.users` row to act as the
demo club owner.

1. **Authentication → Users → Add user → Create new user**.
2. Email: `demo@runapp.test` · Password: `Demo12345!` ·
   check **Auto Confirm User**.
3. Click **Create user**.

> For faster dev, also turn off email confirmation for the whole project:
> **Authentication → Providers → Email** → toggle off
> **Confirm email** → Save. You can re-enable it before submitting.

### Step 4 — Seed demo data

1. New query → paste **all of `02_seed.sql`** → Run.
2. Expected: a `NOTICE` line like
   `Seed complete. Demo owner: 1a2b...  Clubs: Shanghai=..., Beijing=...`

### Sanity check

Run each of these in the SQL Editor (or use the **Table Editor**):

```sql
select id, name, owner_id from public.clubs;
select title, start_at, status from public.activities order by start_at;
select * from public.v_monthly_mileage;
```

You should see 2 clubs, 6 activities, and 3 runs.

---

## 3 · What's next

Your backend is ready. In the next step we'll wire the frontend:

```
runapp/
├── index.html                 # SPA shell (to be created)
├── scripts/
│   ├── supabase.js            # paste URL + anon key here
│   ├── auth.js                # signIn / signUp / signOut
│   ├── api.js                 # activities, registrations, runs, reflections
│   ├── geofence.js            # Haversine + 50m validator
│   └── app.js                 # router + hydrate
└── styles/
    └── app.css
```

When you ask me to continue, I'll generate that shell and hook it up to
the three playful features (50 m map check-in, activity reflections,
monthly mileage leaderboard) + Realtime "just registered" toast.

---

## Re-running / resetting

- **`00_schema.sql`** is idempotent — safe to re-run.
- **`01_policies.sql`** drops each policy by name before recreating —
  safe to re-run.
- **`02_seed.sql`** deletes its own previous rows (anything whose name/
  title starts with `DEMO · `) before inserting fresh — safe to re-run
  as long as you haven't renamed the demo rows.

To nuke **everything** and start over:

```sql
drop table if exists public.reflections, public.runs,
  public.registrations, public.activities, public.club_members,
  public.clubs, public.profiles cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.sync_club_owner_member() cascade;
drop function if exists public.tg_set_updated_at() cascade;
drop function if exists public.is_club_organizer(uuid) cascade;
drop function if exists public.is_club_member(uuid) cascade;
drop view if exists public.v_monthly_mileage;
```

Then re-run `00 → 01 → 02` in order.

---

## Free-tier heads-up

- Projects are **paused after 7 days of inactivity**. Open the dashboard
  or hit any endpoint to wake them up.
- Keep your `service_role` key **private**. Only the `anon` key goes
  into the browser.
- 500 MB database is plenty for a class demo; avoid storing large
  binaries in Postgres — use Supabase **Storage** if you add photos later.
