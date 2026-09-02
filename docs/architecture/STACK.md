---
id: architecture-stack
type: architecture
status: accepted
last_updated: 2026-08-31
related: [architecture, architecture-map, ADR-0012]
source_of_truth_for: [runtime-stack, dependency-policy, prepared-offline-map-stack]
---

# Stack

## Client

- TypeScript
- React 19
- Vite
- plain CSS
- MapLibre GL JS **5.7.1 pinned**

React owns the website UI and current in-memory Campaign state. Do not introduce a heavy component framework without a concrete need.

The product is a normal mobile-first website. No native app, service worker, installable PWA or Web App Manifest installation flow is part of the accepted baseline.

## Cloudflare

- Cloudflare Workers
- Workers Static Assets
- Cloudflare Vite plugin
- Cloudflare D1

Frontend assets and API deploy as one Worker unit.

M5.5 adds no new Cloudflare storage product. Prepared OSM packages are generated through the existing Worker and will be stored in browser IndexedDB. R2/PMTiles is intentionally not part of v1.

The Worker entrypoint currently uses a narrow M5.5 wrapper that handles the prepared-map route and delegates all existing routes to the established Campaign Worker. This avoids an unrelated rewrite of the current API router.

## Map

- OpenFreeMap Bright vector basemap using OpenStreetMap-derived data
- MapLibre for basemap, camera, rotation/compass, live/refining geolocation follow, saved Areas and saved Street Tasks
- two long-lived application GeoJSON sources for saved geometry
- a small constant set of MapLibre Fill/Line layers
- independent SVG overlay only for active Area draw/edit and Street draw geometry/handles

Normal browse pan/zoom/rotate must not execute an application projection/repaint loop over every saved Area/Street.

### MapLibre version pin

`maplibre-gl` is currently pinned to `5.7.1` in `package.json`.

The tested `6.4.1` runtime produced a real-browser GeoJSON rendering regression in this project: basemap/FPS were healthy while saved application GeoJSON became invisible/non-interactive. Therefore map runtime upgrades require explicit browser acceptance with saved Area + Street visibility and hit testing, not just green TypeScript/CI.

## Persistence and sync

Current shared persistence:
- Cloudflare D1 as server source of truth;
- localStorage last-known snapshot/cache;
- protected Worker snapshot/version API;
- IndexedDB-backed durable M5 mutation queue;
- idempotent narrower mutation writes and explicit conflict/auth/retry states;
- secure Campaign-scoped access/session authorization.

There is no service worker or Background Sync API.

Prepared offline map packages use a separate browser IndexedDB repository and are not Campaign D1 state.

## Prepared OSM data

ADR-0012 governs the M5.5 data path.

Current v1 stack:
- authenticated Campaign-scoped Worker endpoint;
- fixed server-owned Overpass-compatible query template;
- default development/beta upstream `https://overpass-api.de/api/interpreter`;
- optional server-side `OSM_OVERPASS_URL` override for a replaceable compatible upstream;
- normalized versioned JSON/GeoJSON package shared by Worker/client domain types;
- roads and building footprints with reviewed OSM tag allowlist and preserved way ids;
- hard radius, timeout and response/package limits;
- JSTS `2.12.1` for server-side LineString/Polygon topology;
- modular Turf `7.4.0` packages for boundary checks, snapping and A/B slicing;
- deterministic prepared-street IDs and guarded delta reconciliation;
- browser IndexedDB package lifecycle in the next slice.

No client-controlled Overpass query text is accepted. Do not bulk-cache OpenFreeMap or OpenStreetMap Foundation raster/vector tile services.

## Future data/tooling

M6 Smart Street/House work should reuse the reviewed OSM identity/data direction from ADR-0012 where practical instead of selecting another provider by default.

If dense real-device measurements prove the normalized GeoJSON package unsuitable, revisit transport/storage through a new ADR. Do not silently introduce R2, PMTiles or a second OSM source-of-truth pipeline.

Planned statistics/admin features should prefer server/domain data and small focused UI dependencies. Avoid adding analytics SDKs or dashboard frameworks merely to render a few charts/tables.

## Dependency policy

Add a dependency only when it solves a demonstrated problem more safely/cheaply than local code.

The established Street Engine is the explicit exception for geometry primitives that are
safety-critical at the server boundary: `jsts@2.12.1` handles exact topology and pinned
modular Turf `7.4.0` handles client snapping/slicing and boundary predicates. The package
and license review is recorded in `docs/THIRD_PARTY_STREET_ENGINE.md`.

Avoid:
- heavy component suites;
- animation frameworks without UX value;
- large utility libraries for one function;
- unnecessary telemetry/analytics SDKs;
- external font packages;
- per-feature map libraries when MapLibre already provides the primitive.

## Version policy

Dependencies are intentionally pinned in `package.json`. Upgrade through review and real acceptance where runtime behavior matters; do not silently drift major versions.
