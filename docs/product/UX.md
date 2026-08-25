---
id: product-ux
type: product
status: accepted
last_updated: 2026-08-25
related: [product, product-roadmap, architecture-map, architecture-security]
source_of_truth_for: [field-ux, map-interaction, appearance-ux]
---

# UX Rules

## Mobile first

Design for one-handed outdoor use before desktop use.

- primary actions need large touch targets;
- important information must remain readable in sunlight;
- avoid hover-only interaction;
- respect safe-area insets and desktop viewport edges;
- map panning/rotation must never accidentally complete Tasks;
- completion actions need an immediate Undo path;
- settings/refresh controls must stay reachable without covering the map;
- bottom toolbars must remain fully visible and must not clip below the viewport on desktop or mobile.

## Visual hierarchy

The map is the primary field workspace. Toolbars and status cards float above it without consuming most of the viewport.

Administrative/statistical dashboards are separate surfaces. Do not permanently overlay organization/admin complexity on the field map.

## Area browse/draw/edit

### Browse

A saved Area keeps its normal Team-colored fill/outline. Normal selection:
- no thick white halo;
- no stored corner/edit markers;
- no edit affordances directly on the polygon;
- detail/bottom sheet communicates selection.

### Draw

Area drawing shows:
- draft vertices;
- draft connecting geometry/fill;
- Save / Cancel / Undo-point controls.

### Edit

Only after explicit **Form bearbeiten / Edit shape**:
- large touch-friendly vertices;
- high-contrast edit preview;
- selected vertex visibly distinct;
- stored geometry unchanged until Save;
- Cancel returns to saved geometry.

## Saved map rendering

Saved Areas/Streets are rendered in MapLibre with the basemap. They must stay visually locked to the map while pan/zoom/rotate occurs.

Saved geometry must remain selectable with touch-friendly hit targets even when visible lines are thin.

Street styling should look road-like, not like a broad text marker:
- thin Team-colored line;
- zoom-dependent width;
- no permanent broad white casing;
- status also communicated by opacity/dash pattern, not hue alone.

## Street + House direction

Manual street tracing is the current fallback interaction, not the desired long-term normal workflow.

M6 target:
- creating/saving an Area can propose/generate actual road segments from reviewed OSM/OSM-derived data;
- user can tap/select the real Street/segment rather than hand-tracing it;
- generated geometry follows the road and does not cut diagonally across buildings/plots;
- manual LineString drawing remains available for missing/special paths.

House Mode target:
- switch explicitly between Street and House context;
- tap one building to select/update it;
- support efficient multiple-building selection on mobile without breaking normal map panning;
- exact long-press/multi-select gesture must be usability-tested before it becomes a hard rule;
- Street progress may aggregate from building children only after the data model defines that relationship.

## Map camera

The map supports arbitrary bearing. Two-finger touch rotation and normal desktop MapLibre rotation are allowed. Compass remains visible and resets North-Up.

Personal last camera view is stored per Campaign/browser using center, zoom and bearing.

Startup priority:
1. personal last camera view;
2. shared Campaign focus;
3. Germany fallback.

Remote synchronization never resets camera or automatically requests GPS.

## Geolocation

GPS is user initiated and one-shot. No continuous route history is created for field UX or statistics.

## Access/roles

UI reflects Worker-authorized roles but never replaces server authorization.

Current Campaign roles:
- Admin manages Campaign settings, Teams and access;
- Team Editor edits only scoped Team data;
- Viewer is read-only.

Future Organization Admin UI is a separate product surface and must not be inferred from current Campaign Admin controls.

## Comments/activity

Planned collaboration UI should remain contextual:
- comments/activity accessible from Campaign/Area/Task sheets;
- field UI shows recent/relevant information, not a full social feed;
- admin surface may expose richer history/filtering;
- system/automation activity must be visually distinguishable from human comments.

## Automations

Automation results must be understandable. When an automatic action changes state, the UI should make the effect visible and allow investigation through activity/history.

Do not create hidden automation that silently marks field work complete.

## Statistics/Admin panel

Statistics belong primarily in the future Admin panel:
- progress summaries;
- Team/Area/Campaign breakdowns;
- activity-over-time views;
- organization-level overview for authorized admins.

The map may show compact progress context, but not a permanent analytics dashboard.

## Appearance

Planned personal appearance setting:
- System;
- Light;
- Dark.

Dark mode initially applies to website UI only:
- top/bottom bars;
- sheets/dialogs;
- settings;
- comments/activity;
- Admin panel;
- forms/buttons/status surfaces.

The current CARTO map may remain light. UI dark mode must not require a basemap replacement.

Appearance is personal browser/user state, not shared Campaign configuration unless a later decision changes it.

## Language

Supported UI languages:
- Deutsch;
- English.

Browser language initializes preference where possible. Application controls/status/settings/ARIA labels are localized; provider-rendered CARTO labels remain provider-controlled.

## Shared refresh/sync UX

Current remote refresh is in-page and does not reload the website or reset camera.

If newer shared data appears during active draw/edit:
- preserve unsaved geometry;
- show that newer data exists;
- recheck/apply safely after local interaction completes.

M5 will add durable pending/offline mutation states. Synchronization/authorization failures must remain visible without replacing the whole field UI with a blocking screen when avoidable.

## Accessibility

- semantic controls;
- visible focus state;
- sufficient contrast in light and dark UI;
- localized labels for icon-only buttons;
- no critical state communicated only through color;
- touch-friendly edit/select targets;
- respect reduced-motion preferences if motion is introduced later.
