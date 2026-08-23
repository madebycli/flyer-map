# Architecture

## Overview

Verteil-Flyer is a client-heavy mobile-first website with a small Cloudflare Worker API.

```text
Mobile/Desktop Browser
  ├─ React website shell
  ├─ MapLibre map
  │   └─ VersaTiles / OpenStreetMap-derived vector data
  ├─ device geolocation (local display only)
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

The website is not an installable PWA and does not depend on a service worker.

The browser must never be trusted to authorize a write.

### Worker

Responsible for API validation, authorization, write rules and database access.

The Worker should remain small. Business rules belong in testable services rather than route handlers once complexity warrants it.

### D1

Stores campaign state, teams, areas, tasks and later an event log/access tokens.

The browser never receives direct D1 credentials.

## Map boundary

Map rendering is separated from application data. VersaTiles is the current basemap provider, not a permanent architectural dependency.

Distribution geometry and status belong to Verteil-Flyer data and are rendered as application layers above the basemap.

## Deployment

Vite builds the React website. The Cloudflare Vite plugin packages the client assets and Worker as one deployable unit using Workers Static Assets.

See `docs/operations/DEPLOYMENT.md`.
