# Architecture

## Overview

Verteil-Flyer is a client-heavy mobile-first website with a small Cloudflare Worker API.

```text
Mobile/Desktop Browser
  ├─ React website shell
  ├─ MapLibre map
  │   ├─ CARTO Voyager Retina / OpenStreetMap-derived basemap
  │   └─ Verteil-Flyer GeoJSON application layers
  ├─ device geolocation (local display only)
  ├─ current M1 local campaign snapshot persistence
  └─ future browser-side resilient mutation queue
          │
          ▼
Cloudflare Worker API
          │
          ▼
Cloudflare D1
```

## Runtime boundaries

### Browser

Responsible for presentation, map interaction, device geolocation, local optimistic state and future resilient queuing of important user mutations.

The M1 campaign/team/area slice stores a versioned campaign snapshot in browser localStorage so a single device survives reloads before shared persistence is connected.

The website is not an installable PWA and does not depend on a service worker.

The browser must never be trusted to authorize a write.

### Worker

Responsible for API validation, authorization, write rules and database access once shared campaign persistence is enabled.

The Worker should remain small. Business rules belong in testable services rather than route handlers once complexity warrants it.

### D1

Will store campaign state, teams, areas, tasks and later an event log/access tokens.

The browser never receives direct D1 credentials.

## Map boundary

Map rendering is separated from application data. CARTO Voyager Retina is the current operational basemap, not a permanent architectural dependency.

Distribution geometry and status belong to Verteil-Flyer data and are rendered as application-controlled vector/GeoJSON layers above the raster basemap.

M1 uses these application layers for stored team areas, drawing previews and polygon editing handles.

## Deployment

Vite builds the React website. The Cloudflare Vite plugin packages the client assets and Worker as one deployable unit using Workers Static Assets.

See `docs/operations/DEPLOYMENT.md`.
