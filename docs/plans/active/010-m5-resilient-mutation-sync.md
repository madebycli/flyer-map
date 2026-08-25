---
id: plan-010-m5-resilient-mutation-sync
type: plan
status: active
last_updated: 2026-08-25
related: [plan-009-product-platform-foundation, architecture-offline-sync, architecture-data, architecture-security, architecture-map, quality, ADR-0011]
---

# Plan 010 — M5 resilient mutation synchronization

## Goal

Make saved field changes durable during unreliable connectivity and preserve unacknowledged mutations in browser storage without introducing a Service Worker/PWA and without weakening Worker-side authorization.

The mutation queue may persist across browser reloads, but a **cold page reload while completely offline is not an application-shell guarantee** under the current website-only/no-Service-Worker architecture. If the browser cannot load the website JavaScript at all, M5 cannot render its queue or map UI. That limitation is tracked separately and must not be misreported as mutation loss.

## Baseline / source of truth

Continue existing branch `m5-resilient-sync-mainline` / Draft PR #24. Do not create a replacement M5 branch. Old PR #17 is closed as superseded.

Preserve:
- MapLibre GL JS 5.7.1;
- saved Areas/Streets in persistent MapLibre GeoJSON sources/layers;
- active draw/edit only in SVG;
- Campaign-scoped Admin / Team Editor / Viewer authorization enforced by the Worker;
- website-only architecture.

ADR-0011 governs mutation queue/idempotency behavior.

## Implemented M5 architecture

- explicit Campaign/Team/Area/Street mutations;
- IndexedDB durable queue for unacknowledged changes;
- emergency localStorage shadow during IndexedDB enqueue;
- stable mutation ids plus canonical SHA-256 fingerprints;
- ordered processing with bounded retry/backoff;
- online/visible-tab/manual retry triggers;
- explicit conflict, invalid and access-blocked states;
- Worker validation followed by existing authorization;
- narrow D1 writes plus mutation ledger;
- compact sync status UI;
- no Service Worker or Background Sync API.

## D1 migration — passed

`migrations/0003_m5_mutations.sql` was applied successfully to remote `flyer-map-db` on 2026-08-25. Wrangler showed the migration with status `✅`.

## Browser acceptance observations

Observed in a real browser:
- preview root loads;
- creating a Street while the loaded app is offline shows `offline gespeichert`;
- editing a Street while the loaded app is offline remains locally saved.

A later attempt to fully reload the page while still offline did **not** load Verteil-Flyer; Chrome showed its normal offline/Dino page. Therefore the earlier assumption that the application itself had completed a full offline reload is withdrawn. The queued mutation may still exist in IndexedDB, but the browser could not load the application shell to inspect it.

This is not treated as a user error and not as proof of mutation loss. It is an expected limitation of a normal website without a Service Worker/app-shell offline strategy.

For M5 release acceptance, cold-offline app-shell reload is therefore **deferred rather than falsely marked passed**. Plan 011 tracks deliberate offline map data, and a strict requirement that the entire website cold-start/reload offline would require a separate architecture decision revisiting ADR-0006.

## Maximum-zoom renderer regression — fixed and accepted

At the map's maximum zoom the CARTO basemap previously became white while saved application geometry remained visible.

Cause:
- Map maxZoom = 20;
- CARTO source maxzoom = 20;
- CARTO raster style layer maxzoom was also 20;
- MapLibre hides a style layer at zoom values equal to or greater than layer maxzoom.

Runtime fix commit:
- `5029f9b958502d96d6c185beac16b894774d72e9`;
- only the raster layer `maxzoom` changed `20 -> 21`;
- source maxzoom and Map maxZoom remain 20;
- no saved-geometry renderer/provider/MapLibre-version change.

CI #226 passed for this fix.

A fresh Cloudflare Worker Version preview containing the runtime fix was manually uploaded from branch head `da7a13a38916b058bc6a2d577210100700d04111` after a successful production build:
- Worker Version ID `98516141-4820-4fb6-8f7d-8a7410c1d57b`;
- exact Version Preview `https://98516141-flyer-map.cloudflare-eleven035.workers.dev`;
- alias `https://m5-zoom-fix-flyer-map.cloudflare-eleven035.workers.dev`;
- no production traffic changed.

Real-browser acceptance on 2026-08-25 passed: the basemap remains visible at maximum zoom and no longer turns white.

## Offline map / app-shell product gap

A deliberate downloadable offline geographic context is **not part of M5 PR #24**. It is tracked by:
- `docs/plans/active/011-offline-map-area.md`;
- Roadmap M5.5.

Target UX: Settings action downloads approximately 3 km around current map center for continued use when connectivity drops while the application is available.

Do not solve this by caching CARTO raster tiles. CARTO Basemap terms prohibit storing/caching basemap content. Plan 011 must select an offline-permitted OSM/OSM-derived source/format through a new ADR.

Important: storing offline map data in IndexedDB does **not** itself make the website JavaScript/HTML cold-loadable with no network. A strict cold-start/offline-reload requirement must be handled as a separate architecture decision.

## Remaining M5 release gates

1. with the app loaded, restore connectivity after an offline mutation and confirm server delivery exactly once;
2. retry/reconnect produces no duplicate effect;
3. conflicting target change is visibly surfaced with no silent overwrite;
4. revoked/invalid access stops blind retry and leaves queued work access-blocked;
5. transient network/server failure remains queued and later retries;
6. saved Areas/Streets remain visible/selectable and active edit behavior remains correct;
7. final PR head CI remains green.

Deferred/non-blocking follow-up:
- strict cold page reload while fully offline; current browser test produced Chrome's offline/Dino page before the application could run.

## Risks

- one terminal queue item blocks later dependent mutations by design;
- browser storage/private-mode limitations must surface visibly;
- preview and Production currently share the configured D1 database;
- exact preview evidence must be refreshed after runtime changes;
- offline map-package work is intentionally separated into Plan 011 so it does not destabilize M5 release scope;
- no-Service-Worker architecture means application-shell availability itself is outside the IndexedDB mutation queue.

## Explicit non-goals

- no Service Worker/PWA/Background Sync;
- no guaranteed cold offline app-shell load inside PR #24;
- no downloadable basemap package inside PR #24;
- no Organization/Comments/Statistics implementation;
- no MapLibre version upgrade;
- no saved-geometry renderer rewrite;
- no silent last-write-wins merge.

## Immediate next

1. Keep PR #24 Draft.
2. Skip the strict cold-offline reload check for M5 and keep it as a documented follow-up.
3. Continue loaded-app reconnect/idempotency/conflict/auth/transient-failure acceptance when convenient.
4. Record every observed gate in this plan and `CURRENT.md`.
5. Merge M5 only after the remaining applicable gates pass.
6. Start Plan 011 as the next dedicated map/connectivity slice after M5 merge.
