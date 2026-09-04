---
id: branch-convergence
type: context
status: current
last_updated: 2026-09-05
related: [plan-029-verified-rxdb-brainrot-foundation, plan-028-rxdb-local-first-mission-sync, ADR-0024, ADR-0025]
---

# Branch Convergence / Product Foundation

## Purpose

This file is the durable branch graph for continuing Verteil-Flyer without losing the hard-won RxDB, realtime and MapLibre fixes while parallel product work remains unfinished.

## Preferred product foundation

Branch:

`foundation-verified-rxdb-brainrot`

Origin:

`mission-rxdb-staging@4fc12270ff948ba246dd0c804076720cc65f37b8`

The branch was forked directly from that exact verified staging head before product-side Funny/Brainrot files were added.

This is the preferred basis for future general product work after a fresh GitHub verification of its current head and CI.

## Why the foundation starts from staging

`mission-rxdb-staging@4fc12270...` is the strongest verified RxDB/Street/MapLibre reference because it contains the isolated Staging deployment path and the real Chromium browser gates used to prove the multi-device sync and visible MapLibre Street lifecycle.

The key MapLibre correctness incident was not a server/RxDB-data failure: browser B already had current app state while MapLibre could still draw a stale Street line. The live renderer fix is preserved in this foundation.

Do not delete or repurpose `mission-rxdb-staging`. It remains the historical verified safety reference.

## Brainrot / Funny mode

Source branch:

`fun/menu-hold-xxl-runner@bf41c498c4c708113d5d2959ad4f25aa592e9dd8`

The product-side Brainrot mode is ported completely into the foundation through:

- `src/platform/FunnyFocusVideo.tsx`
- `src/platform/funny-focus-video.css`
- `src/main.tsx` mount beside `PlatformShell`
- `tests/funnyFocusVideoContract.test.ts`

Behavior:

- five-second hold on `.platform-grid-button` toggles the mode;
- two configured focus clips alternate when reopened;
- the long-press click is consumed;
- the feature is local-only and has no Campaign/RxDB/API persistence path;
- it is mounted outside Map state.

The Funny branch's isolated Cloudflare preview workflow/environment is deliberately NOT copied. The foundation keeps the verified staging deployment/isolation configuration.

## Parallel Organizer/Admin line

Current source branch at this handoff:

`feature/organizer-admin-platform@46931e119f23a5ba5bea44a174944c215e06ae0b`

PR #76:

- OPEN
- DRAFT
- UNMERGED
- base: `mission-rxdb-sync`

The Organizer/Admin line remains parallel until the user explicitly declares the Admin panel ready for convergence.

Do not merge PR #76 or blindly merge the whole branch into the foundation. When Admin is ready, first compare its exact current head with the foundation and make an integration plan covering migrations, Worker routes, auth/session boundaries, Organization/Campaign scoping, UI routing and browser gates.

## Parallel established Street/House engine

Branch:

`feature/established-street-preparation-engine@501b8058302342358c8eaed5c67e378b02deb0c0`

This branch belongs to an older product lineage and must not replace the current RxDB foundation.

Later, port its valuable preparation semantics/modules deliberately into a fresh integration branch based on the current foundation. Adapt the engine to the current RxDB/D1/change-feed contract rather than reverting the foundation to the old architecture.

## Branch graph

```text
mission-rxdb-sync
  |
  |  RxDB/Dexie + Worker Pull/Push + D1 change feed
  |  Durable Object/WebSocket invalidation
  |  prepared-Street realtime lifecycle fix
  |  MapLibre live renderer fix
  |
  +------------------------------+
  |                              |
  v                              v
mission-rxdb-staging             fun/menu-hold-xxl-runner
verified deploy/browser gates    Brainrot/Funny product behavior
  |                              |
  | exact verified base          | selected product-side port
  +---------------+--------------+
                  |
                  v
foundation-verified-rxdb-brainrot
CURRENT GENERAL PRODUCT FOUNDATION
                  |
                  +--> later: Organizer/Admin convergence after explicit ready gate
                  |
                  +--> later: established Street/House engine controlled port
```

## Safety rules

Without explicit user approval, do not:

- deploy Production;
- migrate Production D1;
- merge or mark PR #74 Ready;
- merge PR #76;
- overwrite the verified staging reference;
- replace staging isolation with Funny preview configuration;
- merge the old Street/House engine branch wholesale;
- silently enable automatic Area preparation policy if current product policy intentionally disables it.

## Integration order

1. Keep `foundation-verified-rxdb-brainrot` green and stable.
2. Finish and independently verify Organizer/Admin on its own branch/staging path.
3. When Admin is declared ready, create a dedicated integration plan/branch from the current foundation and port/reconcile Admin deliberately.
4. Re-run unit/type/build/security checks plus real browser gates.
5. Only after Admin convergence is stable, plan the established Street/House engine port unless the user explicitly changes priority.

## Planner rule

Any fresh planner must read:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. this file
5. `docs/prompts/CONTINUE_VERIFIED_RXDB_FOUNDATION.md`

Then re-check GitHub heads/PRs before making assumptions.
