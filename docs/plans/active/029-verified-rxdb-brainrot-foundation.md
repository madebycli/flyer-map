---
id: plan-029-verified-rxdb-brainrot-foundation
type: plan
status: active
last_updated: 2026-09-05
---

# Verified RxDB + Brainrot Foundation

## Goal

Create one clean product foundation that preserves the fully verified RxDB/MapLibre staging state and adds the complete local Funny/Brainrot menu-hold mode without importing Funny-specific preview/deployment infrastructure.

## Baseline / source of truth

- Repository: `madebycli/flyer-map`
- Source baseline: `mission-rxdb-staging@4fc12270ff948ba246dd0c804076720cc65f37b8`
- New product branch: `foundation-verified-rxdb-brainrot`
- Brainrot source branch: `fun/menu-hold-xxl-runner@bf41c498c4c708113d5d2959ad4f25aa592e9dd8`
- RxDB staging remains the verified safety reference for this integration.

## Relevant context graph nodes

- current-status
- architecture
- sync
- map
- deployment
- this plan
- planner handoff added by this work

## Tasks

1. Fork the exact verified staging head into `foundation-verified-rxdb-brainrot`.
2. Preserve all staging RxDB, D1, browser-gate and MapLibre lifecycle fixes.
3. Port the complete product-side Funny/Brainrot mode from `fun/menu-hold-xxl-runner`:
   - `src/platform/FunnyFocusVideo.tsx`
   - `src/platform/funny-focus-video.css`
   - `src/main.tsx` integration
   - `tests/funnyFocusVideoContract.test.ts`
4. Do not copy the Funny-specific Cloudflare preview workflow/environment into the product foundation.
5. Keep the staging deployment/isolation configuration from the verified staging baseline.
6. Update `docs/status/CURRENT.md` and `docs/context-map.yaml` so the branch graph and integration direction are explicit.
7. Add a clean planner handoff for the next planning chat.
8. Do not integrate Organizer/Admin yet; keep that work parallel until the Admin panel is explicitly declared ready.
9. Do not port the established Street/House Engine yet; keep it as a later controlled port.

## Acceptance criteria

- New branch descends exactly from `mission-rxdb-staging@4fc12270...`.
- Existing staging MapLibre Street fix and browser-gate files remain untouched.
- Funny/Brainrot product files match the source branch implementation.
- No Funny preview/deploy workflow replaces or weakens staging isolation.
- Context graph clearly distinguishes verified staging reference, current product foundation, Admin branch and future Street/House port.
- Planner handoff names the new foundation as the preferred base for future product work after fresh GitHub verification.

## Risks

- Accidentally overwriting `wrangler.jsonc` with Funny preview configuration would weaken the verified staging boundary.
- Treating staging-only CI/deploy files as general product architecture could create future confusion.
- Integrating Admin before its branch is finished would create unnecessary conflict and invalidate independent verification.

## Decisions made

- The verified staging head is the safety baseline.
- Funny/Brainrot is ported as product behavior only, not with its isolated preview infrastructure.
- Organizer/Admin remains parallel for now.
- Street/House preparation remains a later explicit port.

## Non-goals

- No Production deploy.
- No Production D1 migration.
- No PR #74 merge/readiness change.
- No Admin merge.
- No Street/House Engine merge.
