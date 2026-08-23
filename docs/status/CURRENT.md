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

Foundation branch contains:
- React/Vite application shell
- Cloudflare Worker health endpoint
- MapLibre + OpenFreeMap map prototype
- browser geolocation control
- PWA manifest/service-worker lifecycle
- initial D1 schema proposal
- agent context/documentation system

## Not connected yet

- Cloudflare Git integration
- production Worker deployment
- D1 database/binding
- shared campaign state
- offline mutation queue

## Active plan

`docs/plans/active/001-foundation.md`

## Known issues

The dependency build has to pass CI after the first pull request. No production Cloudflare resources exist yet.

## Next

1. Merge a green foundation PR.
2. Connect the GitHub repository to Cloudflare Workers Builds.
3. Confirm the app on real Android and iPhone hardware.
4. Start M1: campaign/team/area data model and editable map layers.
