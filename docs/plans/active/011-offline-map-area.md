---
id: plan-011-offline-map-area
type: plan
status: active
last_updated: 2026-08-25
related: [product-roadmap, architecture-map, architecture-offline-sync, architecture-data, architecture-stack, architecture-security, quality, plan-012-platform-app-expansion, ADR-0012]
---

# Plan 011 — Prepared Offline Working Area

## Goal

Let a field user deliberately prepare a small local map area before leaving connectivity so geographic context remains available while the already-loaded website is offline.

Initial product target: approximately **3 km around the current map center**.

## Important scope boundary

The project remains a normal website with no Service Worker/PWA under the current accepted architecture.

A full cold page reload while completely offline can show the browser's normal offline page before application JavaScript loads. This plan covers prepared local map data for an already-loaded website and does not promise strict cold app-shell startup without network.

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
- normalized versioned JSON/GeoJSON preserves relevant OSM identity/tags;
- package is stored device-locally in a separate IndexedDB database;
- no R2/vector-tile build pipeline in v1;
- local MapLibre layers provide prepared offline context while the loaded website is offline;
- existing Campaign Area/Street layers stay above that context;
- the same data direction should later feed M6 Smart Streets/Houses.

Initial v1 parameters:
- radius: 3,000 m;
- feature priority: roads and building footprints plus only minimal reviewed context;
- explicit OSM attribution and fetch/dataset timestamp;
- advisory age/refresh UX rather than destructive automatic expiry;
- failed updates preserve the previous valid package;
- bounded timeout/response/package sizes with visible errors.

## Intended UX

Settings contains `Offline-Kartenbereich`.

Flow:
1. user positions map;
2. taps `3 km offline herunterladen`;
3. UI shows download/progress state;
4. completed package shows center/radius/date/size;
5. user can update/delete package;
6. while the website remains loaded and connectivity disappears, stored map data is used for covered bounds;
7. Campaign Areas/Streets render above it;
8. mutations continue through M5 queue;
9. reconnect synchronizes normally.

## Implementation slices

### Slice 1: Worker/package contract — complete and merged in PR #26

Implemented:
- shared `OfflineMapPackage v1` domain contract and validator;
- authenticated `POST /api/campaigns/:campaignId/offline-map/package` endpoint;
- valid Campaign session required for Admin, Team Editor or Viewer;
- strict center/radius validation with 3,000 m maximum;
- fixed server-owned Overpass-compatible query template;
- configurable server-side `OSM_OVERPASS_URL`;
- request/upstream/package byte limits and bounded timeout;
- normalized OSM road LineStrings and building Polygons;
- reviewed tag allowlist, preserved OSM way ids and inert tag values;
- explicit OSM attribution/license/source timestamp metadata;
- tests for invalid radius, hostile client query text, normalization, response limits and timeout.

Evidence:
- CI #281 passed tests, strict TypeScript and production build after the initial strip-types compatibility fix;
- final CI #285 passed;
- PR #26 merged as `e5a97ac147168c9dcc3a53079324e3494508474f`.

### Slice 2: IndexedDB lifecycle — complete on PR #27 branch

Implemented:
- separate IndexedDB database `verteil-flyer-offline-map`, isolated from the M5 mutation queue database;
- one package record per Campaign;
- structural package validation before replacement;
- one transactional `put` replacement without deleting the previous record first;
- read/delete lifecycle;
- persisted UTF-8 JSON byte-size metadata;
- package summary with center, radius, dates, size, attribution and feature counts;
- corrupted package/size metadata is surfaced instead of silently used;
- tests for reload persistence, invalid replacement, failed replacement preserving the previous package, summary metadata, deletion and corruption detection.

Evidence:
- CI #287 failed only because the Node strip-types test runner required an explicit `.ts` ESM import extension;
- import fixed on commit `996dd5428dc5ce77cf7a57f76e97717411be44d5`;
- CI #288 then passed tests, strict TypeScript and production build;
- final docs-only head must remain green before merge.

### Slice 3: Settings UX — next

- `Offline-Kartenbereich` settings entry visible to authorized Campaign users;
- use current map center for the 3 km download;
- loading/error/success state without pretending to know byte percentage when the upstream does not provide one;
- package center/date/size/road/building metadata;
- update/delete actions;
- explicit OSM attribution;
- safe handling of access, network, upstream and browser-storage errors.

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
- update/delete/replacement failure checks;
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

Merge Slice 2 after its final head is green, then implement Settings UX, MapLibre offline context and real-device acceptance. Keep M6 behavior outside this plan until the prepared-area data path is stable enough to reuse.
