---
id: plan-011-offline-map-area
type: plan
status: active
last_updated: 2026-08-25
related: [product-roadmap, architecture-map, architecture-offline-sync, architecture-data, architecture-stack, quality]
---

# Plan 011 — Downloadable offline working area

## Goal

Let a field user deliberately prepare a small map area before leaving connectivity so the map remains useful after an offline reload while queued work continues to use the M5 browser mutation queue.

Default product target: **approximately 3 km around the current map center**.

## Why this exists

M5 real-browser acceptance proved that Campaign data and an offline Street mutation survive a full offline reload, but the remote raster basemap is unavailable after that reload. The user can therefore retain work but loses the geographic context needed to continue distributing safely.

This plan adds deliberate local map preparation without turning Verteil-Flyer into a PWA.

## Constraints / source of truth

Preserve:
- normal mobile-first website;
- no Service Worker;
- no installable PWA;
- no Web App Manifest installation flow;
- no Background Sync API;
- MapLibre GL JS 5.7.1 until a separately accepted runtime change;
- current saved Area/Street GeoJSON renderer boundary;
- Worker authorization and M5 mutation semantics.

CARTO Voyager raster tiles are **not eligible** for the offline package. CARTO Basemap terms prohibit storing/saving/caching basemap content. Online CARTO use may remain until the normal basemap strategy is intentionally changed.

## Required architecture decision before implementation

Create an ADR that selects the offline-permitted OSM/OSM-derived data source and package format.

The ADR must decide:
- source/provider and operational reliability;
- whether the package is GeoJSON, vector tiles, PMTiles or another browser-renderable format;
- attribution/licensing requirements;
- maximum package size and zoom/detail level;
- IndexedDB schema/versioning and expiration/update policy;
- how online and offline map layers switch/fallback;
- whether road/building data is shared with M6 Smart Street + House generation.

Do not proxy/cache CARTO tiles as a workaround.

## Intended UX

Settings contains an `Offline-Kartenbereich` section.

Initial flow:
1. user positions the map where they will work;
2. taps `3 km offline herunterladen`;
3. UI shows estimated/download progress and completion;
4. downloaded area is listed with center/radius/date/size;
5. user may update or delete the package;
6. if connectivity is unavailable, MapLibre automatically renders the stored package for covered map bounds;
7. Campaign Areas/Streets remain rendered above it;
8. edits continue to enter the normal M5 durable mutation queue;
9. reconnect sends queued mutations normally.

Default radius is 3 km. Larger radii must be deliberately bounded by package-size/performance evidence rather than silently becoming whole-city downloads.

## Data/storage rules

- browser IndexedDB is the intended local durable store;
- map-package records are device/browser-local, not D1 Campaign state;
- never store credentials inside map packages;
- downloaded OSM-derived data must keep required attribution metadata;
- packages need a format/schema version;
- replacement/update must be atomic enough that a failed refresh does not destroy the last usable package;
- expose storage/download failure visibly;
- provide deletion to reclaim device storage.

## Renderer rules

- MapLibre remains responsible for persistent map rendering;
- do not create one DOM/SVG element per downloaded road/building;
- offline data should be rendered through batched MapLibre sources/layers;
- Areas/Streets continue to use the current application sources/layers;
- active edit/draw stays in the SVG overlay;
- switching online/offline basemap context must not recreate or reset Campaign camera/state unnecessarily.

## Relationship to M6

Prefer one reviewed map-data pipeline that can serve both:
- offline geographic context;
- Smart Street/House geometry generation.

Avoid downloading one road/building dataset for offline display and a second incompatible dataset for Smart Tasks unless evidence requires it.

## Tasks

1. Research offline-permitted OSM/OSM-derived provider/package options and expected 3 km payload sizes.
2. Write/accept the architecture ADR.
3. Add IndexedDB offline-map package store with versioning and atomic replacement.
4. Add Settings download/update/delete UI.
5. Add MapLibre offline source/layers and connectivity/provider fallback.
6. Preserve OSM/provider attribution while offline.
7. Add storage/error/progress UX.
8. Test offline reload on Android and iPhone-class browsers.
9. Measure package size/load time/memory for dense urban 3 km areas.
10. Update MAP/OFFLINE_SYNC/STACK/UX/CURRENT/context graph.

## Acceptance criteria

- user can download a 3 km working area from Settings while online;
- after successful download, switch device offline and fully reload page;
- downloaded geographic context still renders for the covered area;
- saved Areas/Streets remain visible/selectable over the offline map;
- Street/Area mutations can be created/edited offline and survive reload;
- reconnect later delivers queued M5 mutations without duplicate effects;
- deleting the package removes its stored map data;
- no CARTO basemap content is intentionally cached/stored by the feature;
- required OSM/provider attribution remains visible;
- no Service Worker/PWA/Background Sync is introduced;
- mobile performance is acceptable in a dense representative 3 km urban area.

## Risks

- public OSM query endpoints may be unsuitable as a production data backend;
- building-scale data in a dense 3 km radius can be several MB and expensive to parse/render;
- browser storage quotas vary by platform and private mode;
- offline app-shell availability is still governed by ordinary browser caching because no Service Worker exists;
- provider terms/licensing can invalidate an otherwise attractive technical option;
- duplicating M6 map data would create unnecessary storage/network cost.

## Explicit non-goals

- no offline whole-country/city basemap in the first version;
- no turn-by-turn navigation;
- no continuous GPS route recording;
- no Service Worker or PWA installation;
- no hidden automatic large downloads;
- no CARTO raster tile cache.

## Sequencing

Do not expand Draft PR #24 with this feature. Finish/merge M5 first. Plan 011 is the next dedicated map/connectivity slice and should be designed to feed directly into M6 Smart Street + House work.
