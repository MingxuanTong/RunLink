# 06 · Leaderboard and realtime

**Component:** Monthly mileage leaderboard and live notifications
**Files produced:** Leaderboard view, API functions, and community tab

## Prompt

> Add a playful layer on top of the core features:
>
> First, a monthly mileage leaderboard for each club. A runner should
> appear on the leaderboard of every club they belong to, based on
> their runs that month.
>
> Second, a tier badge system based on total kilometers — starting
> from Rookie at zero, through Bronze, Silver, and Gold, up to
> Platinum at 50 kilometers.
>
> Third, a live notification that pops up whenever someone else
> registers for an activity the current user can see. The database's
> access rules should handle filtering automatically so users only
> get notified about relevant activities.

## Follow-ups

- Tier thresholds are stored in the UI layer so they can be tuned
  without changing the database.
- The top three leaderboard positions get special gold, silver, and
  bronze styling.
- The live subscription is cleaned up on sign-out to avoid leaking
  connections.
