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

PR #21 (`renderer-access-recovery`) merged to `main` on 2026-08-25 as merge commit `63ea2e9c1e289b0c149fa4e229df6d02b81ef51d`.

The merged baseline includes:
- M4 Worker-enforced access/session authorization;
- operator Admin recovery for existing Campaigns using server-only `M4_BOOTSTRAP_SECRET`;
- MapLibre 5.7.1 with saved Areas/Streets in persistent GeoJSON sources/layers;
- SVG only for active draw/edit input;
- opt-in `?diag=1` renderer/performance diagnostics;
- accepted mobile map/edit/toolbar behavior from Plan 008.

Production prerequisites already completed:
- Worker secret `M4_BOOTSTRAP_SECRET` configured outside the repository;
- remote D1 database `flyer-map-db` uses binding `DB`;
- `migrations/0001_initial.sql` remains immutable production history;
- `migrations/0002_m4_access.sql` was applied successfully on 2026-08-24.

## Merge evidence

Before merge:
- final PR head `791d8590f94efef2236968a8d7542d6d56123200` passed GitHub Actions CI #175;
- Cloudflare reported a successful preview deployment for that exact head;
- real-browser/mobile acceptance confirmed saved Area/Street visibility + selection, map alignment during pan/zoom/rotate, active-only Area edit handles and mobile toolbar/safe-area behavior.

After merge, GitHub `main` points to merge commit `63ea2e9c1e289b0c149fa4e229df6d02b81ef51d` and contains the accepted PR tree.

## Post-merge health status

This repository-only coding environment cannot currently resolve the public `workers.dev` hostname, so it cannot independently fetch the production root or `/api/health`. Do **not** convert that tooling/network limitation into a claim that production health was observed.

GitHub #23 tracks the remaining deployed-origin operational validation, including:
- public production root/health confirmation after the PR #21 merge;
- Admin recovery smoke on the deployed origin using the configured server-only secret;
- real-browser `?diag=1` output;
- representative 500 / 1,000 / 2,500 / 5,000 Street browser/device stress runs.

GitHub #22 separately tracks the desktop bottom-toolbar fit/spacing explicitly deferred by the user. Neither issue is already passed.

## Website-only rule

The site remains a normal website. There is no installable PWA, Web App Manifest, service worker, Background Sync API or whole-area offline tile cache.

Record device/browser-specific problems as GitHub issues when they cannot be resolved in the active slice.
