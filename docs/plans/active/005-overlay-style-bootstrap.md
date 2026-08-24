# Plan 005 — Overlay Style Bootstrap

## Goal

Remove the last runtime dependency that can leave all application geometry invisible on the production phone. Areas, streets and draft geometry must exist as part of the initial MapLibre style instead of being created only after the map `load` event.

## Field finding

Production-phone testing after PR #11 still showed the basemap but no saved areas, selected-area highlight, area draft points/lines, street drafts or saved street tasks. This means the complete application overlay path is still absent at runtime rather than merely low-contrast.

## Root-cause direction

The current map creates application GeoJSON sources/layers only after MapLibre emits `load`. With raster tiles on mobile connectivity the basemap can already be visible and interactive while that event remains delayed. When this happens, none of the application sources exist, so every later `setData` call is effectively skipped.

## Tasks

- [x] remove dynamic application source/layer creation after `load`
- [x] define application overlay sources directly in the initial MapLibre style
- [x] reduce overlay state to three GeoJSON sources: areas, street tasks and current draft/edit geometry
- [x] seed saved areas/tasks directly into the initial style
- [x] keep latest React state mirrored into the three sources without a `ready` gate
- [x] resync the latest state on MapLibre style lifecycle events as a fallback
- [x] preserve one-shot geolocation behavior and compact mobile UI
- [ ] pass TypeScript typecheck and production build
- [ ] verify visible area draft, saved area, selection halo, street draft and saved street on production phone

## Acceptance criteria

- Application GeoJSON sources are part of the style passed to `new Map(...)`.
- No `ready` or `load` gate is required before drawing data can be sent to MapLibre.
- Existing saved areas/tasks are present in the initial style data.
- Area and street drawing update the single draft source immediately.
- A slow or incomplete raster-tile load cannot prevent application sources from existing.
- CI is green before merge.
