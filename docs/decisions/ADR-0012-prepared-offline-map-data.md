---
id: ADR-0012
type: decision
status: accepted
date: 2026-08-25
---

# ADR-0012: Prepared offline map data source and package

## Status

Accepted on 2026-08-25. Approach A was selected by the product owner.

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

The implementation must support:
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

## Decision: Approach A, bounded raw OSM subset package

### Stack

- existing React/Vite/MapLibre frontend;
- existing Cloudflare Worker;
- browser IndexedDB;
- Worker-controlled Overpass-compatible OSM data source, with the upstream endpoint configurable server-side rather than hard-coded into UI code;
- compact normalized JSON/GeoJSON package for v1;
- no new R2 dependency for the initial slice.

A public Overpass instance may be used for development and limited beta validation, but it is not considered a guaranteed production SLA. The Worker boundary keeps the upstream replaceable so a hosted or self-hosted Overpass-compatible provider can replace it without changing the browser package contract.

### Data flow

1. Browser sends center/radius to a fixed Worker endpoint.
2. Worker enforces a small radius, request limits and fixed server-owned query templates.
3. Worker requests only the OSM feature classes needed for offline context and future task geometry, initially roads and buildings with a deliberately small context whitelist.
4. Worker validates and normalizes geometry/tags and preserves explicit source identity such as OSM object type/id where available.
5. Browser writes an `OfflineMapPackage` to IndexedDB.
6. MapLibre renders local GeoJSON sources/layers when online basemap data is unavailable inside the prepared bounds.
7. Campaign Areas/Streets continue to render through their existing MapLibre sources above this context.

### Package contract

Initial package remains deliberately small and versioned:

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

### Initial implementation parameters

These are conservative v1 parameters and may be tuned from measurements without replacing this ADR:
- requested working radius: 3,000 m;
- Worker rejects larger radii rather than trusting arbitrary client bounds;
- fixed server-owned OSM query templates, never client-supplied query text;
- v1 feature priority: routable/visible road ways and building footprints, preserving relevant OSM ids/tags for later M6 work;
- package is device/browser-local in IndexedDB and is replaced only after the new package has downloaded, validated and persisted successfully;
- package metadata carries OSM attribution and dataset/fetch timestamp;
- user can explicitly update or delete the package;
- package expiry is advisory in v1: stale packages remain usable but UI can mark age and offer refresh;
- hard response/package limits and timeout values are implementation constants with visible user errors and tests.

### Security and abuse controls

- client never supplies arbitrary Overpass query text;
- radius/bounds are validated server-side;
- response size and upstream timeout are bounded;
- upstream URL is server configuration, not user input;
- Campaign authorization protects the download endpoint to reduce abuse even though OSM data itself is public;
- no secrets or Campaign-private data are included in the local OSM package;
- package content is treated as untrusted external data before rendering/use;
- user-controlled values are not concatenated into SQL or executable query/code templates.

### Consequences

Benefits:
- lowest new infrastructure complexity and operating cost for the current 3 km requirement;
- preserves raw OSM identities/tags needed by M6 better than a display-only basemap schema;
- one map-data direction can support offline context plus later Street/House proposal logic;
- simple IndexedDB replacement/version model;
- avoids R2 and a scheduled tile-build pipeline until measured scale justifies them.

Trade-offs:
- public Overpass availability is not suitable as a hard production dependency at scale;
- large/dense building sets can make GeoJSON packages heavy;
- local offline styling will be simpler than the CARTO online basemap;
- if real usage grows substantially, a later accepted ADR may replace the upstream/package transport with a tile-based pipeline while preserving the product contract.

## Rejected for M5.5: Approach B, self-hosted vector tiles/PMTiles

A self-hosted regional vector-tile/PMTiles pipeline with Cloudflare R2 remains a valid future scaling option, but is rejected for the first M5.5 slice because it adds a scheduled OSM build environment, custom tile schema, R2 lifecycle, offline tile enumeration/cache protocol and glyph/sprite packaging before current scale requires them.

If measurements later show the normalized package approach is not viable, revisit this through a new ADR rather than silently changing the accepted architecture.

## Rejected approach: cache existing CARTO or OSMF tiles

Do not implement the offline button by bulk-prefetching current CARTO raster tiles or OpenStreetMap Foundation raster/vector tiles.

Reason:
- current project documentation already forbids intentionally caching CARTO content for this feature;
- OSMF standard raster and vector tile policies explicitly prohibit bulk download/offline prefetch;
- browser HTTP cache behavior is not a deliberate versioned offline package.

## Implementation follow-up

Plan 011 may now proceed. The first slice should implement the Worker contract, package validation/storage, package lifecycle UI and local MapLibre rendering with tests before expanding into M6 Smart Street/House behavior.
