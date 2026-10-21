---
id: ADR-0038
type: decision
status: accepted
date: 2026-10-21
supersedes: ADR-0006
---

# ADR-0038: Verteil-Flyer is an installable web app (PWA)

## Context

ADR-0006 (2026-08-24) kept the product a plain website: no manifest, no service worker. The owner now wants a real app feel for field use: installable from the browser, a proper start screen, no browser chrome, and every device on the current version without anybody having to know about updates.

## Decision

- Ship a Web App Manifest, icons and a service worker. The app is still delivered by the website; there are no store apps.
- The service worker caches only the app shell: navigations are network-first (the HTML is always fresh when online, the cached shell is used only offline), hashed files under `/assets/` are cache-first. It never touches `/api/`, other origins or map tiles.
- Every build carries a version `MAJOR.MINOR.BUILD` (BUILD = commit count) and publishes `/version.json`. A start with a newer version online reloads once before the app is shown; a running app shows a banner; a resume after a long pause counts as a start.
- Installing on iOS gives the app its own storage (no shared session with Safari), so joining must also work inside the installed app: pasting an invitation link now, a short code later (Plan 056).

## Consequences

- Stale-version risk is the reason ADR-0006 gave; it is handled by network-first navigations, build-named caches and the version check, and the worker can be removed by shipping a `sw.js` that unregisters itself.
- Browser zoom is locked app-wide (owner's rule); the map keeps its own gestures.
