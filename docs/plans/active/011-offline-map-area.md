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

Do not intentionally store/cache the current CARTO raster basemap or OpenStreetMap Foundation tile services for this feature.

## Accepted architecture

ADR-0012 is accepted with **Approach A: bounded raw OSM subset package**.

Direction:
- browser requests a fixed approximately 3 km package through the existing Worker;
- Worker owns the OSM/Overpass-compatible query template and validates radius/limits;
- upstream endpoint is server-configurable and replaceable;
- normalized versioned JSON/GeoJSON package preserves relevant OSM identity/tags;
- package is stored device-locally in IndexedDB;
- no R2/vector-tile build pipeline in v1;
- local MapLibre layers provide prepared offline context while the loaded website is offline;
- existing Campaign Area/Street layers stay above that context;
- same data direction should feed later M6 Smart Streets/Houses.

Initial v1 parameters:
- radius: 3,000 m;
- feature priority: roads and building footprints plus only minimal reviewed context;
- explicit OSM attribution and fetch/dataset timestamp;
- advisory age/refresh UX rather than destructive automatic expiry;
- atomic-enough replacement so failed updates preserve the previous package;
- bounded timeout/response/package sizes with visible errors.

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
- preserve OSM feature identity needed by later M6 work;
- atomic-enough replacement so failed update does not destroy last good package;
- visible storage/download errors;
- deletion/reclaim controls.

## Implementation slices

### Slice 1: Worker/package contract

- fixed authenticated Worker endpoint for prepared-area download;
- strict center/radius validation and fixed server-owned upstream query templates;
- configurable Overpass-compatible upstream;
- upstream timeout and response-size limits;
- normalized package v1 response with attribution, bounds, fetch time, roads/buildings and OSM identity;
- unit tests for validation, hostile input, upstream failure and normalization.

### Slice 2: IndexedDB lifecycle

- package repository separate from M5 mutation queue stores;
- write/validate new package before replacing previous active package;
- read/update/delete and metadata/size reporting;
- storage failure remains visible and previous valid package survives;
- tests for reload persistence and replacement failure.

### Slice 3: Settings UX

- `Offline-Kartenbereich` settings entry;
- use current map center for 3 km download;
- progress/loading/error/success state;
- package center/date/size and update/delete actions;
- clear OSM attribution.

### Slice 4: MapLibre offline context

- local package rendered in stable MapLibre sources/layers;
- local roads/buildings used when connectivity is unavailable and position is inside prepared bounds;
- Campaign Areas/Streets remain visible/selectable above local context;
- no CARTO/OSMF tile cache;
- no per-frame React geometry projection loop.

### Slice 5: Acceptance/performance

- loaded-app offline test on real mobile browser;
- dense urban 3 km package size/download/storage/render measurement;
- Areas/Streets selection/edit regression;
- M5 offline mutation queue/reconnect regression;
- update/delete/replacement failure tests;
- attribution visible offline.

## Relationship to M6

Use the reviewed normalized OSM package contract as the starting source for Smart Street/House geometry. Do not create an unrelated second OSM identity pipeline unless measurements or domain requirements prove it necessary.

## Acceptance

- user can prepare ~3 km area while online;
- stored map context remains usable after connectivity loss while app is loaded;
- Areas/Streets remain rendered/selectable;
- offline edits keep entering M5 queue;
- reconnect later syncs mutations;
- package can be updated/deleted;
- required attribution remains visible;
- no CARTO/OSMF tile cache;
- no Service Worker/PWA introduced;
- dense urban package performance is measured on real mobile devices.

## Explicit non-goals

- no whole-country/city first version;
- no turn-by-turn navigation;
- no continuous GPS route history;
- no guarantee of cold offline page startup;
- no hidden automatic large downloads;
- no R2/PMTiles production pipeline in v1.

## Sequencing

M5 is merged and ADR-0012 is accepted. Implement Slice 1 first, then IndexedDB lifecycle, Settings UX, MapLibre offline context and real-device acceptance. Keep M6 behavior outside this plan until the prepared-area data path is stable enough to reuse.
