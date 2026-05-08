# RunLink

A club-scoped mobile web app for running clubs — map-based check-in with geofencing, organizer route planning, GPS run recording, post-run reflections, leaderboards, and challenges.

**Source Code Repository:** [GitHub](https://github.com/MingxuanTong/RunLink)

## Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Framework | Vue 3 (Composition API + `<script setup>`) | ^3.5.32 |
| Build Tool | Vite 8 (Rolldown-based) | ^8.0.10 |
| Routing | Vue Router 5 (hash-based history) | ^5.0.6 |
| State Management | Pinia 3 | ^3.0.4 |
| UI Components | Vant 4 (mobile) | ^4.9.24 |
| Maps | Leaflet | ^1.9.4 |
| Backend / Auth | Supabase JS | ^2.105.1 |
| Auto-imports | unplugin-auto-import + unplugin-vue-components | — |

## Setup

### Prerequisites

- Node.js 18+
- npm 9+

### Install & Run

```bash
cd RunLink-vue
npm install
npm run dev        # start Vite dev server (default http://localhost:5173)
```

### Other Commands

```bash
npm run build      # production build → dist/
npm run preview    # preview production build locally
```

## Project Structure

```
RunLink-vue/
├── public/
├── src/
│   ├── api/           # Supabase query wrappers
│   ├── assets/        # static assets
│   ├── components/    # shared Vue components
│   ├── composables/   # useGeolocation, useRunRecorder, useCheckinFlow, etc.
│   ├── layouts/       # AppShell, AuthShell
│   ├── lib/           # Supabase client singleton
│   ├── router/        # hash-based route definitions
│   ├── stores/        # Pinia auth store
│   ├── styles/        # CSS custom properties, Vant theme overrides
│   ├── utils/         # geofence, formatters, map helpers, GPX parsing
│   └── views/         # route-level page components
├── supabase/          # SQL schema migrations (00–03)
├── ai-logs/           # Vibe Coding prompt logs (see below)
├── index.html
├── vite.config.js
└── package.json
```

## Key Features

- **Map Check-in** — 50 m Haversine geofence with manual GPS fallback
- **Organizer Routes** — Leaflet + OpenStreetMap route creation and sharing
- **Run Recording** — GPS tracking with exponential smoothing, speed/accuracy filtering
- **Reflections** — Post-run notes and mood tracking
- **Leaderboards** — Monthly mileage per club (Supabase view)
- **Challenges** — Club-wide goals with progress tracking
- **Realtime** — Live registration updates and GPS broadcast via Supabase Realtime

## Design System

- **Brand color:** `#F97316` (orange)
- **Accent:** `#22C55E` (green)
- **Fonts:** Barlow / Barlow Condensed (Google Fonts)
- **Icons:** Font Awesome 6.5.2
- **Breakpoint:** 900 px (mobile-first; desktop adds sidebar nav)

## Vibe Coding Logs

This project used AI-assisted coding ("Vibe Coding") for core components. The `/ai-logs` folder contains the primary prompts and transcripts:

| Log | Component |
|-----|-----------|
| `01-supabase-schema.md` | Postgres schema (tables, triggers, views) |
| `02-supabase-rls.md` | Row Level Security policies |
| `03-spa-shell-and-router.md` | SPA shell + hash router |
| `04-geofence-check-in.md` | Haversine geofence + GPS fallback |
| `05-activity-state-machine.md` | Activity detail state machine |
| `06-leaderboard-and-realtime.md` | Monthly leaderboard + realtime subscriptions |

Each log documents the **prompt**, **context**, **resulting code**, and **manual follow-ups**.
