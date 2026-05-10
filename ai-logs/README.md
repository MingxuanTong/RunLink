# AI / Vibe-Coding Log

This folder keeps a traceable record of the prompts used to generate the
core components of RunLink.

Why it exists (portfolio rubric):

> If AI is used for "Vibe Coding", a `/ai-logs` folder must contain
> prompts for generating core components.

Each file in this folder is a Markdown transcript that captures:

1. **Prompt**  — the request sent to the AI assistant
2. **Context** — what state the code was in when the prompt was sent
3. **Resulting code / files** — which files ended up in the repo
4. **Notes / follow-ups** — any manual edits or verification the human ran

Core components currently documented:

| File                              | Component                                     |
|-----------------------------------|-----------------------------------------------|
| `01-supabase-schema.md`           | Postgres schema (tables, triggers, views)     |
| `02-supabase-rls.md`              | Row Level Security policies                   |
| `03-spa-shell-and-router.md`      | `index.html` + hash router in `app.js`        |
| `04-geofence-check-in.md`         | Haversine + 50 m geofence + GPS fallback      |
| `05-activity-state-machine.md`    | Activity detail (open / registered / past)   |
| `06-leaderboard-and-realtime.md`  | Monthly leaderboard + realtime registration   |
