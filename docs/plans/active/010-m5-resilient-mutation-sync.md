---
id: plan-010-m5-resilient-mutation-sync
type: plan
status: active
last_updated: 2026-08-25
related: [plan-009-product-platform-foundation, architecture-offline-sync, architecture-data, architecture-security, architecture-map, quality, ADR-0011]
---

# Plan 010 — M5 resilient mutation synchronization

## Goal

Make saved field changes durable across reloads and unreliable connectivity without introducing a Service Worker/PWA and without weakening Worker-side authorization.

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
- creating a Street while offline shows `offline gespeichert`;
- editing a Street while offline remains locally saved;
- after a full reload while still offline, the created/edited Street is still present.

This proves browser-local mutation durability across reload.

Reconnect delivery is not yet marked passed because the test exposed that the remote basemap itself is not usable after an offline reload. That separate product gap is now tracked in Plan 011 and must not be confused with mutation loss.

## Maximum-zoom renderer regression found during acceptance

At the map's maximum zoom the CARTO basemap became white while saved application geometry remained visible.

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

Because `5029f9b...` is a runtime change after the previously accepted exact preview, the old `5c7dce...` exact preview is no longer sufficient for merge acceptance. A new Cloudflare deployment/preview that contains the updated runtime is required, followed by a real-browser zoom-20 check.

## Offline map product gap

A deliberate downloadable offline geographic context is **not part of M5 PR #24**. It is now an explicit next milestone tracked by:
- `docs/plans/active/011-offline-map-area.md`;
- Roadmap M5.5.

Target UX: Settings action downloads approximately 3 km around current map center for offline use after reload.

Do not solve this by caching CARTO raster tiles. CARTO Basemap terms prohibit storing/caching basemap content. Plan 011 must select an offline-permitted OSM/OSM-derived source/format through a new ADR.

## Remaining M5 release gates

1. new Cloudflare runtime preview/deployment containing `5029f9b...`;
2. real-browser maximum-zoom confirmation: basemap stays visible at zoom 20;
3. reconnect queued mutation and confirm server delivery exactly once;
4. retry/reconnect produces no duplicate effect;
5. conflicting target change is visibly surfaced with no silent overwrite;
6. revoked/invalid access stops blind retry and leaves queued work access-blocked;
7. transient network/server failure remains queued and later retries;
8. saved Areas/Streets remain visible/selectable and active edit behavior remains correct;
9. final PR head CI remains green.

## Risks

- one terminal queue item blocks later dependent mutations by design;
- browser storage/private-mode limitations must surface visibly;
- preview and Production currently share the configured D1 database;
- exact preview evidence must be refreshed after runtime changes;
- offline map-package work is intentionally separated into Plan 011 so it does not destabilize M5 release scope.

## Explicit non-goals

- no Service Worker/PWA/Background Sync;
- no downloadable basemap package inside PR #24;
- no Organization/Comments/Statistics implementation;
- no MapLibre version upgrade;
- no saved-geometry renderer rewrite;
- no silent last-write-wins merge.

## Immediate next

1. Keep PR #24 Draft.
2. Verify Cloudflare deployment for the updated runtime and browser-test maximum zoom.
3. Resume reconnect/idempotency/conflict/auth/transient-failure acceptance.
4. Record every observed gate in this plan and `CURRENT.md`.
5. Merge M5 only after all gates pass.
6. Start Plan 011 as the next dedicated slice after M5 merge.
