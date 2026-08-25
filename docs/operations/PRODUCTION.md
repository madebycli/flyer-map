---
id: operations-production
type: operations
status: active
last_updated: 2026-08-25
related: [operations-deployment, architecture-map, architecture-security]
---

# Production

## Current deployment

Primary production endpoint:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

Health endpoint:

`https://flyer-map.cloudflare-eleven035.workers.dev/api/health`

## Deployment source

- GitHub repository: `madebycli/flyer-map`;
- production branch: `main`;
- platform: Cloudflare Workers;
- deploy flow: GitHub -> Cloudflare Workers Builds -> `workers.dev`.

## Current production baseline

M4 access/session authorization is merged to `main` and is the production baseline.

Production prerequisites already completed:
- Worker secret `M4_BOOTSTRAP_SECRET` configured outside the repository;
- remote D1 database `flyer-map-db` uses binding `DB`;
- `migrations/0001_initial.sql` remains immutable production history;
- `migrations/0002_m4_access.sql` was applied successfully on 2026-08-24.

Until PR #21 merges, production intentionally remains on the M4 renderer/access baseline from `main`.

## PR #21 preview/release gate

PR #21 (`renderer-access-recovery`) is the current post-M4 release candidate. It adds:
- operator Admin recovery for existing Campaigns without weakening normal authorization;
- MapLibre GeoJSON rendering for saved Areas and Street Tasks;
- SVG only for active draw/edit input;
- opt-in `?diag=1` renderer/performance diagnostics;
- compact map refresh/UI follow-up;
- refreshed repository context/roadmap documentation.

Cloudflare must deploy the exact final PR head to a branch/commit preview before merge. CI success alone is not sufficient.

Required real-browser/device acceptance before merge:
1. saved Area remains visible and selectable after Save;
2. saved Street remains visible and selectable after Save;
3. browse geometry stays locked to the basemap during fast pan/zoom/rotate;
4. edit/draw handles appear only in active modes and remain responsive;
5. desktop bottom toolbar and mobile safe-area positioning remain usable;
6. Admin recovery works on the target preview origin with the configured server-only secret;
7. `?diag=1` reports renderer `maplibre-geojson` without exposing Campaign/token material;
8. representative dense Street datasets are accepted at 500 / 1,000 / 2,500 / 5,000 features or a concrete blocker is documented before merge.

After PR #21 merges, run the normal production smoke checks from `docs/operations/DEPLOYMENT.md`, then update this file and `docs/status/CURRENT.md` to record the new production baseline.

## Website-only rule

The site remains a normal website. There is no installable PWA, Web App Manifest, service worker, Background Sync API or whole-area offline tile cache.

Record device/browser-specific problems as GitHub issues when they cannot be resolved in the active slice.
