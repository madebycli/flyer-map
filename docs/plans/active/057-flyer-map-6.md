---
id: plan-057
status: active
date: 2026-10-21
---

# Plan 057: Flyer Map 6.0

Decision: [ADR-0039](../../decisions/ADR-0039-flyer-map-6.md). Goal: a field app that feels like an app: calm, stable, few things on screen, everything else one step away.

## Phases

### 6.0 Shell and UI system (this build)
- Top bar (menu, search, status), floating results, grouped menu, settings page, templates page, back arrows below the menu.
- Overview: calm progress bar (no stacked animations), correct wording ("Der Fortschritt zählt Häuser. Nicht möglich wird von der Gesamtzahl abgezogen.").
- Search selects the whole street (`wholeStreet`), fits the view to it.
- Practical: next open street, screen stays on, vibration on mark.
- Open in 6.0: one-way arrows of the basemap off, street names along marked streets, tablet sheets rounded on all corners, one control size everywhere (audit), icon/label glossary, Gebiet edit mode buttons.

### 6.1 Gebiete: separate for Austeilen and Abholen, better drawing
- Austeilen and Abholen keep their own Gebiete (owner's decision). What changes is how a Gebiet is made.
- **Connected drawing** (the Paper.io idea): start on the border of an existing Gebiet (or on one of its corner points), place points, end on the border again; the new Gebiet takes the old border between the two ends as part of its own. No more drawing a loose rectangle next to a Gebiet and fitting the lines by hand. Same for extending a Gebiet. Pure geometry in Rust, tested against hand-made cases: done in `flyermap-rs/crates/flyermap-area` (snap, connect as new or extension, split a main area, checks; 10 hand-made cases and a 3000-case random invariant test). The UI wiring comes with the Rust area editor (Plan 059 M6).
- **Abholen**: a main area and sub-areas drawn inside it (or connected to each other); sub-areas must lie inside the main area, the rest of the main area is shown as what is left.
- Side streets and paths: unnamed side streets with houses are marked like any other street; paved tracks that lead to houses count (done in the engine); paths are drawn dashed, roads solid.

### 6.2 People, permissions, management (backend)
- Owner's rule: permissions and management need a backend rework and better administration.
- Proposal: accounts with a user name (organiser creates it, person sets a password or passkey), roles per Aktion (admin, group editor, helper, viewer) and per Gebiet; join by short code or QR as well as link; one list of people with last seen, group, role, revoke; audit trail of who changed access. The Worker decides every right; the UI only mirrors it.
- Steps: (1) inventory of today's rights and endpoints with tests as the contract; (2) data model and migration on Unstable's D1; (3) admin screens as list + detail sheets (6.0 components); (4) join code/QR (Plan 056).

### 6.2b Marking panel
- One layout for every marking mode (stamp, brush, route, lasso): the same places for mode, brush, confirm, cancel and undo; a mode only adds its own control in a fixed spot, never moves another.

### 6.3 Live team, no tracking
- Who is working where without GPS: areas in work, last marked street per person (opt-in), run rooms as today.
- Offline: choose areas to keep on the device; show what is stored and its age.

## Research notes (canvassing and flyer apps)
Common in the field: turf cutting on a map, live team progress, offline use, conflict handling, map caching, duplicate prevention. What they do worse than we need: heavy web-form screens for team and access management. Our edge: marking by gesture, houses counted, no tracking by default.

## Not doing
- Native store apps (see ADR).
- Gamification, rankings, GPS tracking of people.
