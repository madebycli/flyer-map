---
id: plan-011-offline-map-area
type: plan
status: active
last_updated: 2026-08-25
related: [product-roadmap, architecture-map, architecture-offline-sync, architecture-data, architecture-stack, quality, plan-012-platform-app-expansion, ADR-0012]
---

# Plan 011 — Prepared Offline Working Area

## Goal

Let a field user deliberately prepare a small local map area before leaving connectivity so geographic context remains available while the already-loaded website is offline.

Initial product target: approximately **3 km around the current map center**.

## Important scope boundary

The project remains a normal website with no Service Worker/PWA under the current accepted architecture.

A real-browser test showed that a full cold page reload while completely offline can show Chrome's normal offline/Dino page before application JavaScript loads. That is not user error and is not proof of IndexedDB data loss.

Therefore this plan covers prepared local map data for offline field use. It does **not** promise strict cold app-shell startup without network.

A strict cold-offline startup requirement would require a separate ADR revisiting the website-only/service-worker decision.

## Constraints

Preserve:
- normal mobile-first website;
- no Service Worker/PWA/Background Sync;
- MapLibre 5.7.1 until separately changed;
- current saved Area/Street renderer boundary;
- Worker authorization and M5 mutation semantics.

Do not intentionally store/cache the current CARTO raster basemap for this feature. Select an offline-permitted OSM/OSM-derived source/format through an ADR.

## Intended UX

Settings contains `Offline-Kartenbereich`.

Flow:
1. user positions map;
2. taps `3 km offline herunterladen`;
3. UI shows estimate/progress;
4. completed package shows center/radius/date/size;
5. user can update/delete package;
6. while website remains loaded and connectivity disappears, stored map data is used for covered bounds;
7. Campaign Areas/Streets render above it;
8. mutations continue through M5 queue;
9. reconnect synchronizes normally.

## Storage direction

- browser IndexedDB;
- device/browser-local, not Campaign D1 state;
- package schema/version;
- required attribution metadata;
- atomic-enough replacement so failed update does not destroy last good package;
- visible storage/download errors;
- deletion/reclaim controls.

## Relationship to M6

Prefer one reviewed OSM/OSM-derived data pipeline that can support both:
- prepared offline geographic context;
- Smart Street/House geometry.

Avoid unrelated duplicate datasets unless evidence requires it.

## Required ADR

`docs/decisions/ADR-0012-prepared-offline-map-data.md` now records the two viable architectures and remains **proposed** until the user selects one.

Before implementation decide:
- provider/source;
- license/attribution;
- package format (GeoJSON/vector tiles/PMTiles/etc.);
- zoom/detail/package-size limits;
- IndexedDB storage/versioning;
- expiration/update policy;
- online/offline rendering fallback;
- relationship to M6 Street/House data.

No runtime implementation starts until ADR-0012 is accepted.

## Acceptance

- user can prepare ~3 km area while online;
- stored map context remains usable after connectivity loss while app is loaded;
- Areas/Streets remain rendered/selectable;
- offline edits keep entering M5 queue;
- reconnect later syncs mutations;
- package can be updated/deleted;
- required attribution remains visible;
- no CARTO tile cache;
- no Service Worker/PWA introduced;
- dense urban package performance is measured on real mobile devices.

## Explicit non-goals

- no whole-country/city first version;
- no turn-by-turn navigation;
- no continuous GPS route history;
- no guarantee of cold offline page startup;
- no hidden automatic large downloads.

## Sequencing

M5 is merged. Resolve ADR-0012 next, then execute this slice before or together with M6 map-data work so both can share the reviewed geometry pipeline.
