# 04 · 50 m geofenced check-in

**Component:** GPS validation and fallback for attendance
**Files produced:** Geofence utility and check-in flow

## Prompt

> Build a check-in flow for activities. When a runner taps
> check-in, grab their GPS location with high accuracy and compare
> it to the activity's meetup point. If they are within the
> 50-meter radius and GPS accuracy is good enough, confirm
> attendance automatically. If the signal is too weak or they are
> out of range, show a modal explaining the problem and offer a
> manual check-in option so nobody is locked out by a bad signal.

## Implementation notes

- We chose a simple spherical distance formula because at club-run
  distances (under 1 km), the error is less than half a meter —
  well within the 50-meter tolerance.
- GPS errors are categorized (permission denied, timeout, unavailable)
  so the UI can show the right message for each case.
- Manual fallback check-ins are recorded with a flag so organizers can
  see who self-certified from their dashboard.
