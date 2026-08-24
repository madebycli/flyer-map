# Architecture

## Overview

Verteil-Flyer is a client-heavy mobile-first website with a small Cloudflare Worker API and shared Cloudflare D1 persistence.

```text
Mobile/Desktop Browser
  ├─ React website shell
  ├─ MapLibre map
  │   ├─ CARTO Voyager Retina / OpenStreetMap-derived basemap
  │   ├─ navigation controls
  │   └─ local one-shot device geolocation display
  ├─ independent SVG application overlay
  │   ├─ saved team areas
  │   ├─ saved street tasks
  │   ├─ draft/edit geometry
  │   └─ application hit testing / selected corner markers
  └─ localStorage snapshot cache + fallback
          │
          │ optimistic snapshot PUT + revision polling
          ▼
Cloudflare Worker API
          │
          ▼
Cloudflare D1
```

## Runtime boundaries

### Browser

Responsible for presentation, map interaction, local optimistic state and the last-known campaign snapshot cache.

M3 keeps the existing versioned localStorage snapshot as:
- fast startup data;
- the last known snapshot;
- a fallback while the Worker is unreachable;
- a safety copy for a rejected/conflicting optimistic snapshot.

The browser applies local mutations immediately. Shared persistence happens asynchronously through the Worker API. A durable multi-mutation offline queue is intentionally deferred to M5.

The website is not an installable PWA and does not depend on a service worker.

The browser must never be trusted to validate or authorize a write.

### Worker

Responsible in M3 for:
- campaign snapshot API routing;
- server-side domain and geometry validation;
- campaign/team/area/task membership checks;
- optimistic-concurrency revision enforcement;
- normalized D1 reads/writes;
- understandable HTTP errors.

M3 intentionally precedes the M4 access-link/authorization milestone. The campaign id used by M3 is a selector, not an authorization secret. M4 must add Worker-enforced authorization before broader shared use.

### D1

Stores the normalized shared campaign state:
- campaigns and shared revision;
- teams and colors;
- areas and polygon GeoJSON JSON;
- street tasks, LineString GeoJSON JSON, status and `completed_at`.

The browser never receives direct D1 credentials.

## Map boundary — release gate

The production-phone stability phase established a strict rendering boundary that later milestones must preserve.

MapLibre renders only:
- CARTO Voyager Retina raster basemap;
- navigation controls;
- local one-shot geolocation display.

Verteil-Flyer application geometry is **not** rendered through MapLibre application GeoJSON layers. The independent SVG overlay renders:
- saved areas;
- saved streets;
- draw/edit/street draft geometry and points;
- selected-area corner markers and selection treatment.

Application point-in-polygon and screen-distance hit testing handle area/street/edit selection. Server synchronization changes the snapshot source only; it must not redesign this renderer boundary.

## Shared synchronization

The campaign snapshot carries one coarse shared `revision`.

M3 behavior:
1. a local UI mutation is applied and cached immediately;
2. the browser writes the resulting complete snapshot with the server revision it edited from;
3. the Worker rejects stale writes with HTTP 409 rather than silently overwriting another device;
4. a lightweight version endpoint is polled and a newer server snapshot is loaded when detected;
5. a rejected optimistic snapshot is preserved locally before the current server state replaces it.

See `docs/architecture/DATA.md` and `docs/architecture/OFFLINE_SYNC.md`.

## Deployment

Vite builds the React website. The Cloudflare Vite plugin packages the client assets and Worker as one deployable unit using Workers Static Assets. D1 is attached to the Worker through the reviewed `DB` binding once the real database id exists.

See `docs/operations/DEPLOYMENT.md`.
