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

### 6.1 One Gebiete model
- Austeilen and Abholen share one structure: a main area with sub-areas. Edit, draw, assign, archive work the same in both. Today they are two code paths with two sheets.
- Side streets and paths: write down the classification rules (what is a street with houses, what a path) and show the reason in the street sheet ("Weg ohne Häuser"). Needs example data from the owner.

### 6.2 People, permissions, management (backend)
- Owner's rule: permissions and management need a backend rework and better administration.
- Proposal: accounts with a user name (organiser creates it, person sets a password or passkey), roles per Aktion (admin, group editor, helper, viewer) and per Gebiet; join by short code or QR as well as link; one list of people with last seen, group, role, revoke; audit trail of who changed access. The Worker decides every right; the UI only mirrors it.
- Steps: (1) inventory of today's rights and endpoints with tests as the contract; (2) data model and migration on Unstable's D1; (3) admin screens as list + detail sheets (6.0 components); (4) join code/QR (Plan 056).

### 6.3 Live team, no tracking
- Who is working where without GPS: areas in work, last marked street per person (opt-in), run rooms as today.
- Offline: choose areas to keep on the device; show what is stored and its age.

## Research notes (canvassing and flyer apps)
Common in the field: turf cutting on a map, live team progress, offline use, conflict handling, map caching, duplicate prevention. What they do worse than we need: heavy web-form screens for team and access management. Our edge: marking by gesture, houses counted, no tracking by default.

## Not doing
- Native store apps (see ADR).
- Gamification, rankings, GPS tracking of people.
