# RunLink · Running Club Companion

A mobile-first web app that helps running clubs **publish activities,
verify attendance with a 50 m map check-in, and celebrate progress
together.** Built with a no-build vanilla ES-module stack on the
frontend and Supabase on the backend.

> Demo account: `demo@runlink.test` / `Demo12345!`
> (or tap **"Use demo account"** on the sign-in screen)

---

## Tech stack

| Layer                     | Technology                                            |
|---------------------------|-------------------------------------------------------|
| Markup                    | HTML5, semantic landmarks                             |
| Styling                   | CSS3, custom properties, mobile-first responsive      |
| Client logic              | Vanilla ES 6+ modules (no bundler, no framework)      |
| Routing                   | Custom hash router with regex route table             |
| Auth                      | Supabase Auth (email + password, JWT sessions)        |
| Database                  | Supabase Postgres with Row Level Security             |
| Realtime                  | Supabase Realtime (`postgres_changes` subscriptions)  |
| Geolocation               | `navigator.geolocation` + Haversine formula           |
| Fonts / icons             | Google Fonts (Barlow, Barlow Condensed), Font Awesome 6 |
| Hosting (suggested)       | Vercel / Netlify / GitHub Pages (static)              |

No package manager is required — just open `index.html` in a modern
browser, or serve the folder over HTTP (see below).

---

## Features

### Runner
- Email + password **sign-up / sign-in** with a one-tap demo account
- **Discover** feed with greeting, quick check-in CTA, user's own
  upcoming registrations, and all published activities
- **Activity detail** with four auto-switching states
  (`open` / `registered` / `checked_in` / `past` / `cancelled`)
- **Register** to an activity, optionally picking a pace group
- **Map check-in** using the Haversine formula against the activity's
  meetup coordinates with a configurable radius (default **50 m**)
- GPS-fallback "I'm here" self-certification when accuracy is too low
  (flagged so organizers can audit)
- **Post-run reflections** — pick an emoji + optional note; feed of
  other runners' reflections
- **Cancel registration** with confirm dialog
- **Running tab** with a mock GPS recorder (distance / time / pace),
  pause / resume, auto-save with avg-pace computation, optionally
  linked to a checked-in activity
- **Community tab**: active club crest, upcoming activities, monthly
  **leaderboard** with gold / silver / bronze ranks, tier badges
  (Rookie → Platinum), and the member roll
- **My stats** with totals (runs, km, time, avg pace), longest run,
  and the 20 most recent runs
- **Profile** tab with editable display name, avatar URL, and bio

### Organizer
- **Create a club** (visibility, timezone, crest)
- **Publish activity** with rich metadata: cover image, start / end,
  check-in window, meetup lat/lng (fillable from current location),
  geofence radius, capacity, and comma-separated pace groups
- **Cancel activity** — flips the status and propagates a red chip
  across every activity card and detail page
- **Data dashboard** per activity: registered / checked-in /
  cancelled counts + roster table with check-in method & timestamp

### Cross-cutting
- **Realtime toast** — "🎉 Someone just joined …" pops when another
  user registers for an activity you can see (RLS handles filtering)
- **Responsive**: bottom tab bar on mobile, side nav from ≥ 900 px
- **Accessibility**: skip-link, `aria-live` region, `:focus-visible`
  outlines, dialog focus trap, `prefers-reduced-motion` support,
  contrast ≥ WCAG AA
- **Security**: every table has RLS; the client only ever ships the
  publishable anon key

---

## Project layout

```
RunLink/
├── index.html                # SPA shell
├── styles/
│   └── app.css               # Tokens, layout, components, responsive
├── scripts/
│   ├── supabase.js           # Client init
│   ├── api.js                # Auth + typed data access over Supabase
│   ├── geofence.js           # Haversine + 50 m validator
│   ├── ui.js                 # Toast / modal / formatters / DOM helpers
│   ├── views.js              # All view render functions
│   └── app.js                # Router + shell + entry
├── ai-logs/
├── supabase/
│   ├── 00_schema.sql         # Tables, triggers, view
│   ├── 01_policies.sql       # Row Level Security
│   ├── 02_seed.sql           # Demo clubs, activities, runs
│   ├── README.md             # How to recreate this backend
│   └── credentials.local.md  # (git-ignored) project URL + test user
└── README.md
```

---

## Run locally

No build step — the frontend is plain ES modules.

### Option A · Open the file directly
Most browsers allow ES modules over `file://`, but a few (Firefox,
older Safari) may not. If you see a blank page, use Option B.

### Option B · Serve the folder (recommended)

```powershell
# From the RunLink/ folder:
npx --yes serve .
# or
python -m http.server 8080
```

Then open the printed URL (e.g. `http://localhost:3000`).

### Option C · VS Code Live Server
Right-click `index.html` → **Open with Live Server**.

---

## Rebuild the backend from scratch

If you want to point RunLink at your own Supabase project:

1. Create a new project at https://supabase.com
2. Run the SQL files in this order from the SQL editor:
   - `supabase/00_schema.sql`
   - `supabase/01_policies.sql`
3. Register a user through the app (or the Supabase dashboard), then
   run `supabase/02_seed.sql` to drop demo clubs / activities / runs
   that refer to the first signed-up user.
4. Copy your project's **URL** and **publishable anon key** into
   `scripts/supabase.js`.

Detailed steps are in [`supabase/README.md`](supabase/README.md).

---

## Deployment

Because the app is a static folder, any free-tier host works.

### Vercel / Netlify
Drag the `RunLink/` folder onto the dashboard or import the repo.
**No build command** and the **output directory** is the project root.

### GitHub Pages

```powershell
# From the repo root:
git subtree push --prefix RunLink origin gh-pages
```

Then enable Pages → branch `gh-pages` → root.

---

## Accessibility

- `role="status"` live region for toasts, `aria-live="polite"` on the
  main view so screen readers announce route changes
- Visible focus outlines via `:focus-visible` for every interactive
  element
- Skip-link as the first tabbable item
- Emoji picker uses real `<button>` elements with keyboard support
- Activity cards are `role="link"` with Enter / Space handlers
- Colour contrast on body text is ≥ 4.5 : 1 against the dark background
- `@media (prefers-reduced-motion: reduce)` disables non-essential
  animation

---

## AI logs

[`ai-logs/`](ai-logs/)

---

## License

MIT — see `LICENSE` if present, otherwise provided as-is for the
course-project portfolio.
