# 05 · Activity detail state machine

**Component:** Activity page that adapts its actions based on context
**Files produced:** Activity rendering logic and helpers

## Prompt

> Design an activity detail page that adapts its bottom action area
> based on context. There are five states: cancelled, past,
> registered, checked-in, and open for sign-up. Past activities
> should show the reflection composer so runners can share their
> experience. Organizers should see extra controls like a dashboard
> link and a cancel button. The rest of the page stays the same
> across all states.

## Follow-ups

- When an activity offers multiple group options, they appear as
  selectable cards — the chosen group is saved on the registration.
- Cancelling a registration requires a two-step confirmation to
  prevent accidents.
- When an organizer cancels the entire activity, every view shows a
  "CANCELLED" marker so all participants are aware.
