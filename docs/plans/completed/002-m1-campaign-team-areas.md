# Plan 002 — M1 Campaign, Teams and Areas

Status: completed for milestone implementation on 2026-08-24.

## Goal

Deliver the first usable campaign/team/area workflow with local persistence and mobile map editing.

## Completed outcome

- campaign rename and versioned snapshot
- named teams with unique palette colors
- polygon area drawing, validation, selection, edit, reassignment and deletion
- localStorage persistence and migration-ready domain boundary
- production map rendering ultimately moved from unreliable MapLibre application layers to the independent SVG overlay in Plan 005
- the production-phone stability check now confirms saved areas, draft geometry and selected-area corner markers are visible on the real device

## Verification boundary

The current production phone has passed the M1 map-geometry release gate. This closes M1 as a milestone dependency for M3.

This does **not** claim that the final Android + iPhone/Safari browser matrix has been completed. Broader cross-browser/device hardening remains an M6 release task.

## Decisions retained

- local GPS only
- normal website only; no PWA/service worker
- fixed unique team-color palette
- explicit touch-friendly geometry modes
- campaign/team/area domain shape remains compatible with Worker/D1 shared persistence
