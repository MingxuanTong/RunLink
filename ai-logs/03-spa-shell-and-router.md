# 03 · SPA shell and router

**Component:** App shell and client-side navigation
**Files produced:** Main HTML file, app entry script, and styles

## Prompt

> Build a single-page shell for RunLink using only HTML, CSS, and
> vanilla JavaScript modules — no bundler, no framework. We need:
>
> - A top bar on mobile with a back button, page title, and optional
>   action button
> - A bottom tab bar on mobile with four tabs: Discover, Running,
>   Community, and Profile
> - A left sidebar on screens wider than 900 pixels that replaces
>   both the top bar and bottom tabs
> - A separate layout for logged-out users so login and signup pages
>   don't show any navigation
> - Client-side hash-based routing with support for route parameters
>   and a login guard
> - Accessibility features: skip-to-content link, focus management
>   when navigating, reduced motion support
> - Proper cleanup on route changes so event listeners don't pile up

## Follow-ups

- Adding a new screen is just one line in the route table plus a
  render function.
- Icons and fonts are loaded from CDNs — no build step needed.
- A brief loading splash hides the page until the first screen renders,
  preventing a flash of unstyled content.
