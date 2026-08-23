---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M0 — Repository foundation.

## Working

Foundation branch contains and CI has validated:
- React/Vite application shell
- Cloudflare Worker health endpoint
- MapLibre + OpenFreeMap map prototype
- browser geolocation control
- PWA manifest/service-worker lifecycle
- initial D1 schema proposal
- agent context/documentation system

## Verification

GitHub Actions run #2 passed dependency installation, TypeScript type checking and the production Vite/Cloudflare build.

## Not connected yet

- Cloudflare Git integration
- production Worker deployment
- D1 database/binding
- shared campaign state
- offline mutation queue

## Active plan

`docs/plans/active/001-foundation.md`

## Known issues

No known foundation build errors. Production Cloudflare resources do not exist yet.

## Next

1. Merge the green foundation PR.
2. Connect the GitHub repository to Cloudflare Workers Builds.
3. Confirm the app on real Android and iPhone hardware.
4. Start M1: campaign/team/area data model and editable map layers.
