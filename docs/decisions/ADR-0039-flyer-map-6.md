---
id: ADR-0039
type: decision
status: accepted
date: 2026-10-21
---

# ADR-0039: Flyer Map 6.0: the map is the app

## Context

Version 5 still carried ideas of the first version: a home menu of icon tiles for everything, settings mixed with work, a search that was a page, a progress bar that waved, team and access screens built like admin web pages. Field use is one thing all day: look at the map, mark, see what is next. Everything else must be one step away and quiet.

## Decision

- **One bar, one sheet.** The map has one floating bar at the top (menu, search field, status/progress) and, at most, one sheet at the bottom. Search results float under the bar; they are not a page. The bar never changes size, so nothing jumps while typing, syncing or loading.
- **The menu is a list, not a grid.** A few titled groups of rows (now, map, manage, app). Looks and device settings (appearance, accent colour, hand, basemap, screen on, vibration) are one level down in the settings. Pages below the menu have a back arrow.
- **One component set.** Rows, groups, segmented choices, switches, progress: `src/ui/controls.tsx`. Same height, same radius, same states everywhere. New screens use them; new one-off controls need a reason.
- **Honest numbers.** Progress counts houses; "Nicht möglich" is subtracted from the total. No decorative animation on numbers.
- **A street is a street.** A search result selects the whole street (all connected pieces of that name), not one junction-to-junction piece.
- **Practical before clever.** New features must save steps in the field: the next open street, screen stays on, a buzz on each mark. No feature without a field use.
- **Stack.** Keep the web stack and the PWA (ADR-0038). A native rewrite buys little the PWA lacks for this tool and costs two store releases and review delays; revisit only if iOS limits (no vibration, storage rules) become the bottleneck.

## Consequences

- E2E flows address menu rows by name; the helpers in `scripts/v5-e2e/ui.mjs` know which page a row lives on.
- Permissions and management (who may do what, accounts, access links) are re-done on the backend in Plan 057 phase 6.2; the 6.0 screens only move, they do not change the rules.
