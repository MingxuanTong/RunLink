# 01 · Supabase schema

**Component:** Database schema for RunLink
**Files produced:** The initial database migration

## Prompt (sent to AI assistant)

> Design a database schema for RunLink. We need tables for user
> profiles, clubs (with owner and visibility settings), club
> memberships with roles, activities with a meetup location and
> check-in window, registrations that track status from registered
> to checked-in to completed, runs that store distance and route
> data, and reflections with emoji reactions and short notes.
> Add automatic timestamps, useful indices, and a view that shows
> each club's monthly mileage leaderboard.

## Context

Project was hosted on Supabase (Northeast Asia region).

## Key decisions & follow-ups

- The first migration failed because the database rejected a function
  used inside an index — it wasn't marked as stable enough. We fixed
  this by removing the index and computing the value at query time
  instead.
- We used a built-in random UUID generator for primary keys.
- A constraint was added to prevent activities from having an end time
  earlier than their start time.
