---
id: status-current
type: status
status: active
last_updated: 2026-08-25
---

# Current Project State

## Baseline

M4 access/session authorization and PR #21 are merged on `main`. Verteil-Flyer remains a mobile-first website only: no native app, installable PWA, Service Worker, Web App Manifest install flow or Background Sync API.

Current renderer baseline:
- MapLibre GL JS **5.7.1 pinned**;
- CARTO Voyager Retina raster basemap;
- saved Areas/Streets in persistent MapLibre GeoJSON sources/layers;
- active draw/edit geometry only in the small SVG overlay;
- no application-side dense saved-geometry projection loop during browse.

Current Campaign roles remain Admin, Team Editor scoped to one Team, and Viewer. Worker authorization is authoritative.

## Active M5

M5 resilient mutation synchronization remains the current release slice:
- branch `m5-resilient-sync-mainline`;
- Draft PR #24;
- Plan 010: `docs/plans/active/010-m5-resilient-mutation-sync.md`;
- ADR-0011 governs the durable mutation queue/idempotency design.

Implemented:
- explicit Campaign/Team/Area/Street mutations;
- IndexedDB durable queue plus emergency localStorage shadow;
- ordered retry/backoff and lifecycle retry triggers;
- visible pending/offline/conflict/auth-blocked/failed states;
- canonical SHA-256 mutation fingerprints;
- Worker validation + existing authorization;
- narrow D1 mutation persistence and idempotency ledger.

D1 migration `0003_m5_mutations.sql` was successfully applied to remote `flyer-map-db` on 2026-08-25.

## Browser acceptance observations

Observed in a real browser on 2026-08-25:
- preview root loads;
- while offline, creating a Street shows `offline gespeichert`;
- while offline, editing a Street remains locally saved;
- after a full page reload while still offline, the created/edited Street is still present.

This passes the local offline durability/reload portion of M5 gate 1. Reconnect delivery is still unconfirmed because the basemap itself did not remain usable offline after reload.

## Maximum-zoom basemap bug — fixed and browser-accepted

Real-browser testing exposed a renderer bug: at maximum zoom the CARTO basemap became completely white while application geometry remained visible.

Root cause:
- Map instance is capped at zoom 20;
- CARTO source is correctly capped at zoom 20;
- raster style layer was also declared `maxzoom: 20`;
- MapLibre hides a style layer at zoom values equal to or greater than its layer `maxzoom`.

Fix committed in `5029f9b958502d96d6c185beac16b894774d72e9`:
- only the CARTO raster layer maxzoom changed from 20 to 21;
- source maxzoom remains 20;
- map maxZoom remains 20;
- no provider, MapLibre version, saved-geometry renderer or camera architecture changed.

CI #226 passed for this runtime fix.

A new Cloudflare Worker Version preview containing the fix was manually uploaded from branch head `da7a13a38916b058bc6a2d577210100700d04111` after a successful production build:
- Worker Version ID: `98516141-4820-4fb6-8f7d-8a7410c1d57b`;
- exact Version Preview: `https://98516141-flyer-map.cloudflare-eleven035.workers.dev`;
- preview alias: `https://m5-zoom-fix-flyer-map.cloudflare-eleven035.workers.dev`;
- no production traffic was changed.

Real-browser acceptance on 2026-08-25 passed: at maximum zoom the basemap remains visible and no longer turns white.

## Offline map-area requirement

A new field requirement was confirmed during M5 testing: after intentionally downloading an area, the map must remain useful after an offline reload.

Desired UX:
- Settings action to download an offline working area;
- default radius approximately **3 km around the current map center**;
- downloaded map context survives reload in browser storage;
- Areas/Streets and queued mutations continue working on top of that offline map context;
- reconnect later synchronizes normal M5 mutations.

This must remain website-only and must not use a Service Worker.

CARTO raster tiles must **not** be used for the offline package because CARTO Basemap terms prohibit storing/caching basemap content. The offline package therefore requires a separately reviewed OSM/OSM-derived source/format whose license and operational model permit deliberate local storage.

Plan 011 (`docs/plans/active/011-offline-map-area.md`) tracks this as the next map/connectivity slice after M5 rather than silently expanding PR #24.

## M5 gates still open

1. Complete offline-save gate by reconnecting and confirming queued delivery exactly once.
2. Retry/reconnect without duplicate effect.
3. Visible target conflict with no silent overwrite.
4. Revoked/invalid access stops blind retry and remains access-blocked.
5. Transient failure stays queued and retries later.
6. Saved Area/Street selection and active edit behavior remain unchanged.
7. Final repository head green before merge.

Passed renderer gate: the updated Version preview keeps the basemap visible at maximum zoom.

PR #24 remains Draft until the remaining M5 gates pass.

## Follow-ups / roadmap

- Plan 011 — downloadable ~3 km offline working area with offline-permitted map data;
- M6 — Smart Street + House Tasks from reviewed real map geometry;
- M7 — comments, activity and deterministic automations;
- M8 — Organizations, multiple admins and Admin panel;
- M9 — statistics/reporting and personal UI appearance;
- M10 — field hardening/release.

Existing GitHub follow-ups remain open:
- #22 desktop bottom-toolbar fit/spacing;
- #23 production health/recovery/diagnostics and dense Street validation.

## Immediate next

1. Keep PR #24 Draft.
2. Restore connectivity in the same browser/session that still contains the offline-saved Street and confirm the queued mutation reaches the server exactly once.
3. Continue idempotency/conflict/auth/transient-failure acceptance.
4. Merge M5 only after all release gates pass.
5. Then execute Plan 011 before/alongside Smart Street work so field users can deliberately prepare a local offline working area.
