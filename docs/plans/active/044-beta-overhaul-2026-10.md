# Plan 044 — Beta overhaul (2026-10): road relevance, Smart Marking connectivity, incremental sync, controls

Status: ACTIVE on branch `claude/beta-overhaul-2026-10-08` (from `beta`; nothing deployed)
Decision/measurements: [ADR-0033](../../decisions/ADR-0033-field-core-first-principles-rebuild.md). The parallel rebuild is [Plan 043](043-v5-field-core.md).

## Changes

- `src/domain/roadRelevance.ts`: client-side delivery relevance for Smart Marking candidates (tracks, bridleways, cycleways,
  sidewalks/crossings, unpaved or restricted paths hidden; `foot` overrides generic `access`). Offline map schema is now v2 (carries `footway`,
  older cached packages are refetched). **Not applied to server street preparation** (`eligibleRoad` unchanged): that needs the plan-038
  shadow comparison first because it changes generated Task ids/counts.
- `smartRoadSelection`: ways connect through any shared vertex (side streets at interior nodes were "disconnected"); linear-time adjacency.
- `MapView`: Areas/Streets/Houses sync incrementally with content-derived versions; cache is forgotten on resume/style reinstall.
- RxDB snapshot materialisation reuses validated plain documents per immutable document revision (test pins the assumption).
- `src/vela-controls.css`: Vela-style round zoom/compass/locate controls.

## Open

- [ ] Real-device acceptance (ADR-0030) of the incremental map path, esp. page resume
- [ ] Plan-038 shadow comparison before any server-side road filter change
- [ ] Decide: merge this branch, or supersede it by Plan 043
