# Architecture

## Overview

Verteil-Flyer is a client-heavy mobile-first PWA with a small Cloudflare Worker API.

```text
Browser / installed PWA
  ├─ React application shell
  ├─ MapLibre map
  │   └─ OpenFreeMap / OpenStreetMap data
  ├─ device geolocation (local display only)
  └─ future IndexedDB offline queue
          │
          ▼
Cloudflare Worker API
          │
          ▼
Cloudflare D1
```

## Runtime boundaries

### Browser

Responsible for presentation, map interaction, device geolocation, local optimistic state and future offline queuing.

The browser must never be trusted to authorize a write.

### Worker

Responsible for API validation, authorization, write rules and database access.

The Worker should remain small. Business rules belong in testable services rather than route handlers once complexity warrants it.

### D1

Stores campaign state, teams, areas, tasks and later an event log/access tokens.

The browser never receives direct D1 credentials.

## Map boundary

Map rendering is separated from application data. OpenFreeMap is the initial basemap provider, not a permanent architectural dependency.

Distribution geometry and status belong to Verteil-Flyer data and are rendered as application layers above the basemap.

## Deployment

Vite builds the React client. The Cloudflare Vite plugin packages the client assets and Worker as one deployable unit using Workers Static Assets.

See `docs/operations/DEPLOYMENT.md`.
