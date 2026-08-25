---
id: ADR-0012
type: decision
status: proposed
date: 2026-08-25
---

# ADR-0012: Prepared offline map data source and package

## Status

Proposed. User architecture decision required before M5.5 implementation.

## Context

Plan 011 requires a deliberately prepared approximately 3 km offline working area for the already-loaded Verteil-Flyer website.

The current accepted boundaries remain:
- normal mobile-first website;
- no Service Worker, installable PWA or Background Sync;
- MapLibre GL JS 5.7.1;
- browser IndexedDB is allowed for local packages;
- current CARTO raster basemap must not be intentionally cached for offline use;
- Campaign Areas/Streets and M5 queued mutations keep their existing architecture;
- the map-data direction should help M6 Smart Streets/Houses instead of creating unnecessary duplicate pipelines.

OpenStreetMap data itself is available under ODbL and can be copied/adapted with required attribution and licence handling. The OpenStreetMap Foundation tile servers are a different service and explicitly prohibit bulk downloading/prefetch for offline maps. Therefore neither `tile.openstreetmap.org` nor `vector.openstreetmap.org` may be used as the download source for this feature.

Official references verified 2026-08-25:
- https://www.openstreetmap.org/copyright
- https://operations.osmfoundation.org/policies/tiles/
- https://operations.osmfoundation.org/policies/vector/
- https://wiki.openstreetmap.org/wiki/Overpass_API
- https://download.geofabrik.de/
- https://docs.protomaps.com/pmtiles/
- https://docs.protomaps.com/basemaps/downloads
- https://docs.protomaps.com/pmtiles/maplibre
- https://docs.protomaps.com/pmtiles/cloud-storage

## Required product behavior

A selected implementation must support:
- user positions the map and explicitly downloads about 3 km around current center;
- visible estimate/progress and storage errors;
- local package metadata with center, bounds/radius, created/updated time, package schema and attribution;
- atomic-enough package replacement so a failed update does not destroy the last usable package;
- package update/delete;
- geographic context while connectivity is lost and the website is still loaded;
- saved Campaign Areas/Streets above the local map data;
- normal M5 mutation queuing/reconnect behavior;
- no hidden large background downloads;
- mobile performance measurement in a dense urban area.

## Approach A: Bounded raw OSM subset package

### Stack

- existing React/Vite/MapLibre frontend;
- existing Cloudflare Worker;
- browser IndexedDB;
- Worker-controlled Overpass-compatible OSM data source initially, with the upstream endpoint configurable rather than hard-coded into UI code;
- compact normalized JSON/GeoJSON package for v1;
- no new R2 dependency for the initial slice.

A public Overpass instance may be useful for development and low-volume validation, but it must not be treated as a guaranteed production SLA. Public instances are explicitly described as services for small projects that can become overloaded. A commercial or self-hosted compatible source can later replace the upstream without changing the browser package contract.

### Data flow

1. Browser sends center/radius to a fixed Worker endpoint.
2. Worker enforces a small radius, request limits and fixed server-owned query templates.
3. Worker requests only the OSM feature classes needed for offline context and future task geometry, initially roads, buildings and a minimal set of contextual features.
4. Worker validates and normalizes geometry/tags and preserves explicit source identity such as OSM object type/id where available.
5. Browser writes an `OfflineMapPackage` to IndexedDB.
6. MapLibre renders local GeoJSON sources/layers when online basemap data is unavailable inside the prepared bounds.
7. Campaign Areas/Streets continue to render through their existing MapLibre sources above this context.

### Package direction

Initial package can remain deliberately boring:

```text
OfflineMapPackage v1
- schemaVersion
- sourceDataset
- sourceTimestamp or fetchedAt
- center
- radiusMeters
- bounds
- attribution
- roads FeatureCollection
- buildings FeatureCollection
- optional context FeatureCollections
```

Do not turn the first package into a general GIS database unless measured size/performance requires it.

### Security and abuse controls

- client never supplies arbitrary Overpass query text;
- radius/bounds are validated server-side;
- response size and upstream timeout are bounded;
- upstream URL is server configuration, not user input;
- current Campaign authorization may protect download endpoints to reduce abuse even though OSM data itself is public;
- no secrets or Campaign-private data are included in the local OSM package;
- package content is treated as untrusted external data before rendering/use.

### Benefits

- lowest new infrastructure complexity;
- lowest initial operating cost;
- preserves raw-ish OSM identities/tags needed by M6 better than a display-only basemap schema;
- one data direction can support offline context plus later Street/House proposal logic;
- simple IndexedDB replacement/version model;
- avoids introducing R2 and a scheduled tile-build pipeline before scale proves they are needed.

### Drawbacks

- public Overpass availability is not suitable as a hard production dependency at scale;
- large/dense building sets can make GeoJSON packages heavy;
- visual result needs a deliberately small local MapLibre style rather than inheriting a polished full basemap automatically;
- if real usage grows substantially, a tile-based backend may later be justified.

### Complexity

Medium.

## Approach B: Self-hosted regional vector tiles with preserved OSM identity

### Stack

- existing React/Vite/MapLibre frontend;
- `pmtiles` browser integration or equivalent MVT protocol adapter;
- Cloudflare R2 for self-hosted map archives/tiles;
- scheduled external tile build from OSM/Geofabrik extracts using Planetiler or a comparable tool;
- custom tile schema that preserves the OSM ids/tags required by M6;
- browser IndexedDB tile/package cache for the prepared 3 km area.

### Data flow

1. Scheduled builder downloads a current regional OSM PBF, for example from Geofabrik.
2. Builder creates a custom PMTiles/MVT archive containing visual context plus preserved road/building identity fields.
3. Archive is copied to R2 or another explicitly offline-capable storage service.
4. Browser normally reads remote vector tiles through MapLibre/PMTiles.
5. `3 km offline herunterladen` enumerates the bounded tile coverage and stores the needed tile bytes plus required metadata/assets in IndexedDB.
6. A custom protocol resolves local tile bytes first while offline and remote tile bytes when online.

### Security and operations

- R2 bucket exposure/CORS is deliberately configured;
- no user-controlled storage key/path is trusted blindly;
- build artifacts are versioned and immutable;
- package references include dataset/build version;
- update jobs and storage/request costs need monitoring;
- glyph/sprite assets required for offline rendering must be bundled or explicitly included in the offline strategy.

### Benefits

- predictable production availability because Verteil-Flyer controls hosting;
- vector tiles scale better than large GeoJSON packages for dense cities;
- polished map styling and zoom behavior are easier to maintain;
- same custom tile schema can preserve fields required by M6 if designed carefully;
- PMTiles is designed for browser + MapLibre range-request access and R2 is a documented hosting option.

### Drawbacks

- materially more infrastructure and operational work;
- requires a separate scheduled build environment because Cloudflare Workers are not an OSM PBF tile compiler;
- R2 storage/request cost plus build-compute cost;
- offline tile enumeration/cache/protocol and glyph/sprite handling add client complexity;
- building a custom identity-preserving tile schema before M6 identity rules are accepted risks premature architecture;
- more moving parts for the first 3 km use case.

### Complexity

High.

## Rejected approach: cache existing CARTO or OSMF tiles

Do not implement the offline button by bulk-prefetching current CARTO raster tiles or OpenStreetMap Foundation raster/vector tiles.

Reason:
- current project documentation already forbids intentionally caching CARTO content for this feature;
- OSMF standard raster and vector tile policies explicitly prohibit bulk download/offline prefetch;
- browser HTTP cache behavior is not a deliberate versioned offline package.

## Recommendation, not yet decision

For the first M5.5 slice, Approach A is the recommended direction if the user accepts it.

Reasoning:
- it is the simplest architecture that satisfies the actual 3 km prepared-area requirement;
- it adds no new Cloudflare storage product or scheduled tile compiler;
- raw OSM identity/tags are more useful for the immediately following M6 Smart Street/House work;
- the browser package contract can remain stable even if the upstream Overpass-compatible provider later changes;
- dense-data measurements can tell us whether a move to MVT/PMTiles is actually necessary.

The recommendation does not approve a public Overpass instance as a permanent production dependency. The Worker boundary should make the upstream replaceable.

## Decision required

Choose one before implementation:

- **A: Bounded raw OSM subset package via Worker and IndexedDB**
- **B: Self-hosted regional vector-tile/PMTiles pipeline with R2**

Until this ADR is accepted, do not implement the Plan 011 download/storage/rendering runtime.

## Follow-up decisions after choosing A

If A is accepted, the first implementation slice should still keep these settings conservative and measurable:
- exact feature whitelist;
- maximum radius, initially about 3 km;
- response/package size ceiling;
- package expiry/update UX;
- local MapLibre style;
- whether production uses a hosted Overpass-compatible provider immediately or starts with a limited public-instance beta.

These are implementation parameters unless measurements make them expensive architectural commitments.

## Follow-up decisions after choosing B

If B is accepted, define before runtime code:
- builder environment and schedule;
- geographic coverage;
- custom tile schema and OSM identity fields;
- R2 bucket/version lifecycle;
- offline zoom range;
- glyph/sprite packaging;
- storage/request/build budget.
