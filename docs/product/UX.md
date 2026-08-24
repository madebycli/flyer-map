---
id: product-ux
type: product
status: accepted
last_updated: 2026-08-24
related: [product, architecture-map, architecture-security]
---

# UX Rules

## Mobile first

Design for one-handed outdoor use before desktop use.

- primary actions need large touch targets;
- important information must remain readable in sunlight;
- avoid hover-only interaction;
- respect safe-area insets;
- map panning/rotation must not accidentally complete Tasks;
- completion actions must have an immediate Undo path;
- settings and refresh controls must remain reachable without taking over the map.

## Visual hierarchy

The map is the primary workspace. Toolbars and status cards should float above it without consuming most of the viewport.

A selected saved Area is identified by its compact detail/bottom sheet. Normal selection must not make the map look like geometry-edit mode.

## Area browse/draw/edit

### Browse mode

When a stored Area is selected:
- keep its normal Team-colored fill/outline;
- do **not** add a thick white Area halo;
- do **not** draw markers at stored polygon corners;
- do not expose edit affordances on the map;
- use the bottom sheet/details as the selection indication.

### Draw mode

Area drawing continues to show:
- draft vertices;
- draft connecting geometry/fill;
- explicit Save, Cancel and Undo controls.

### Edit mode

Only after the user chooses **Form bearbeiten / Edit shape**:
- show large touch-friendly polygon vertices;
- show a high-contrast edit preview/outline;
- make the currently selected vertex visually distinct;
- keep stored geometry unchanged until Save;
- Cancel returns to the saved geometry.

Street-draft point markers remain visible while tracing a Street.

## Map camera

The map supports arbitrary bearing. Two-finger touch rotation and normal desktop MapLibre rotation are allowed; there is no 90-degree snapping. The compass remains visible and can reset North-Up.

Personal last camera view is remembered per Campaign/browser using center, zoom and bearing.

Startup priority:
1. personal last camera view for this Campaign;
2. shared Campaign/Aktionsfokus;
3. Germany overview fallback.

A remote Campaign-data refresh must not reset center, zoom or bearing and must not trigger GPS focusing.

The user can reset the personal camera preference from Settings. Admin can save the current camera as the shared Campaign start view, jump to it or remove it.

## Geolocation

GPS is a user-initiated one-shot orientation aid. After centering, the user remains free to pan, zoom and rotate.

No GPS history or route trail is created. Personal map-camera persistence is not GPS tracking and remains browser-local.

## Color

Team colors identify ownership/assignment. Completion state must not depend on color alone.

Use a second visual channel such as line style, fill pattern, icon, opacity/weight difference or checkmark.

## Task states

Initial vocabulary:
- open;
- completed;
- later;
- not-deliverable.

## Street Mode

Street Mode is the first task interaction and comes before House Mode.

- a Street is an explicit line Task assigned to an Area;
- tapping a stored Street opens a compact bottom sheet rather than immediately changing state;
- all four status actions use large labeled controls;
- changing status gives immediate visible map feedback and an immediate Undo action;
- panning/zooming/rotating or merely selecting a Street must never mark it completed;
- manual Street tracing has an obvious mode with Save, Cancel and Undo-point controls;
- status styling on the map remains distinguishable without relying only on hue.

## Access and role UX

The UI reflects the current Worker-authorized role but never replaces server authorization.

- Admin can manage Campaign settings, Teams, Campaign focus and Access Links;
- Team Editor sees editing actions only for its scoped Team data;
- Viewer receives a read-only field view and cannot perform mutation actions;
- a newly created Access Link is shown once because its plaintext token is not recoverable from D1;
- revoked grants remain a server-side security decision even if a stale browser UI has not yet rerendered.

## Settings

A normal mobile-first Settings entry contains at least:

Personal:
- language;
- reset personal map view;
- jump to Campaign focus when one exists.

Admin Campaign settings:
- Campaign/Aktion name;
- save current map view as Aktionsfokus;
- jump to/remove Aktionsfokus;
- Access Links / permissions.

## Language

Supported application languages:
- Deutsch;
- English.

Initial preference uses browser language when it starts with `de` or `en`; otherwise German is used. The setting is personal to the browser, not Campaign-wide.

Translate application controls, statuses, settings, access/sync messages and ARIA labels through the small TypeScript translation table.

CARTO Voyager Retina labels are pre-rendered raster content and remain provider-controlled; do not swap the proven basemap solely to localize those labels.

## Shared refresh UX

Remote synchronization happens in memory without full-page reload.

Normal automatic check:
- query the small revision endpoint every 30 seconds;
- also check after connectivity returns and when the tab becomes visible;
- download the full snapshot only when the server revision is newer.

A compact **Daten aktualisieren / Refresh data** button lives with the right-side map controls and gives brief loading/current/error/new-data feedback.

If a newer revision is discovered during Area draw, Area edit or Street draw:
- keep the local unsaved geometry intact;
- show that newer data is available;
- apply/recheck after the local interaction safely completes instead of silently discarding it.

## Performance UX

Prefer immediate optimistic feedback for allowed local changes, followed by ordinary in-page synchronization.

Never hide synchronization or authorization failure. A pending/offline/access problem must be visible without replacing the whole screen with a blocking modal.

## Accessibility

- semantic controls;
- visible focus state;
- sufficient contrast;
- localized labels for icon-only buttons;
- no critical state communicated only through color;
- touch-friendly edit vertices and field controls;
- respect reduced-motion preferences if motion is later introduced.
