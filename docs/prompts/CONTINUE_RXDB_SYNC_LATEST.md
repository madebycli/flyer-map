---
id: prompt-continue-rxdb-sync-latest
type: handoff
status: current
last_updated: 2026-09-03
related: [plan-028-rxdb-local-first-mission-sync, ADR-0024, ADR-0025]
---

# Continue RxDB Sync: Planner AI Handoff

## Read first

Use this file together with `AGENTS.md`, `docs/status/CURRENT.md`, `docs/context-map.yaml` and `docs/plans/active/028-rxdb-local-first-mission-sync.md`. Do not infer Production permission from successful staging evidence.

## Exact branch / release state

- Canonical source branch: `mission-rxdb-sync`.
- Rollback/release base: `mission-release-2026-09-02-manual`.
- Rollback base SHA: `5e7148d2a32f6237861e7e6a05e022eeb67c91ce`.
- Verified application-code baseline before this documentation-only handoff: `aa0031cd88970bf7ca8b4256066663cde640f5ad`.
- Canonical push CI: run `33789550729`, success.
- Canonical PR CI: run `33789557529`, success.
- PR #74: base `mission-release-2026-09-02-manual`, head `mission-rxdb-sync`; keep **open + Draft + unmerged**.
- Isolated staging branch: `mission-rxdb-staging`.
- Verified staging test head: `4fc12270ff948ba246dd0c804076720cc65f37b8`.
- Staging URL: `https://flyer-map-staging.cloudflare-eleven035.workers.dev/`.
- Staging deploy run `33789841058`: success.
- Real Chromium two-browser renderer gate `33789841106`: success.
- User manually confirmed on real devices after deployment: the Street graphics update correctly again.

A later documentation-only commit may make the canonical branch SHA newer than `aa0031...`. Do not mistake that for an untested application-code change; `aa0031...` is the verified code baseline beneath the handoff docs.

## Hard safety boundaries

Do **not** do any of the following without an explicit new instruction from the user:

- merge PR #74;
- mark PR #74 Ready for Review;
- deploy Production;
- apply migration `0017_rxdb_sync_changes.sql` to Production D1;
- reuse Production D1/resources for staging;
- silently change the intentionally disabled automatic Area-preparation policy;
- silently reset/replace `mission-rxdb-staging` after the verified staging tests.

Staging-only deployment, recovery and browser-gate files may remain on `mission-rxdb-staging`. `UNKLAR`: whether that branch should later be reset to exact canonical source. Ask/decide before doing so.

## Current architecture

Chosen architecture: RxDB 17 + Dexie/IndexedDB in the browser, authenticated HTTP Pull/Push through the Worker, canonical D1 plus additive `rxdb_sync_changes`, optional Campaign Durable Object/WebSocket invalidation hints and a Campaign high-water checkpoint safety poll.

Collections:

- `campaigns`
- `teams`
- `areas`
- `streetTasks`
- `houseTasks`

Canonical flow:

```text
UI / domain mutation
-> RxDB / typed mutation boundary
-> authenticated Worker
-> server authorization + domain validation
-> D1 canonical commit + change-feed row
-> optional DO/WebSocket `changed` hint
-> client incremental Pull
-> RxDB collection update
-> Campaign read-model materialization
-> React MapView props
-> MapLibre GeoJSON source/layers
```

The DO is never canonical and contains no document payloads or secrets. The browser is untrusted. D1/Worker remain authoritative.

## P0 incident 1: server data durable, open client can miss prepared-Street wakeup

### Symptom

Server/D1 had generated Street tasks after explicit Area preparation, but an already-open second browser could miss them until a later reload/pull.

### Root cause

`worker/areaTaskPreparation.ts` previously detached the post-commit realtime callback:

```ts
void Promise.resolve(options.onCommitted?.()).catch(() => undefined);
```

The D1 transaction and RxDB change feed were already durable, but the `waitUntil()`-owned preparation job could resolve before `notifyCampaignSync()` reached the Durable Object/WebSocket. Cloudflare was then allowed to terminate the remaining detached work.

### Fix

Keep the notification inside the lifecycle-owned Promise:

```ts
try {
  await options.onCommitted?.();
} catch {
  // D1 + feed are already durable; realtime remains best effort.
}
```

This does **not** roll back a durable preparation if the realtime hint fails. It only prevents the Worker lifecycle from abandoning the hint prematurely.

### Regression / diagnostics

- `tests/areaTaskPreparationRuntime.test.ts`
- `tests/streetSyncLifecycleContract.test.ts`
- browser diagnostics:
  - `[rxdb-sync] realtime-change`
  - `[rxdb-sync] pull-complete`
  - `[rxdb-sync] manual-refresh-start`
  - `[rxdb-sync] manual-refresh-complete`

Do not add direct Worker `console.log/info/debug/warn/error`; `tests/securityStaticGuards.test.ts` intentionally forbids that except for the audited Worker logger.

## P0 incident 2: RxDB/App-State current, MapLibre Street line stale

### Decisive real-device observation

On device B, a Street deleted on device A remained visibly drawn but could no longer be clicked/opened. Status/menu/server state was already current. Only a full tab refresh removed the line.

This proves the failure boundary was after RxDB/App-State, inside the map projection/render path.

### Root cause

Ten live React effects in `src/map/MapView.tsx` used this guard:

```ts
if (!map || !map.isStyleLoaded()) return;
```

MapLibre can transiently report `isStyleLoaded() === false` while processing style/source work. If a React prop update arrived in that window, the effect returned and that state transition was permanently dropped. There was no retry for the lost prop update. A full page/style load later hydrated all sources from current refs, which is why reload appeared to fix it.

### Fix

All affected live effects now only require an existing map instance and then call their `sync*` function directly:

```ts
const map = mapRef.current;
if (!map) return;
syncStreetData(map, tasks);
```

Equivalent guards were corrected for all similarly structured dynamic map sources/filters, not just Streets. The initial `style.load` hydration from the latest refs remains intact.

Canonical code commit for the renderer fix: `c3a12e0a97839730f8f147d6bb700b37fd9757c4` (`fix: keep MapLibre graphics live with RxDB state`). Temporary one-shot patch workflow was removed afterward; verified code baseline is `aa0031...`.

Regression: `tests/mapRendererLiveSync.test.ts`.

## Renderer runtime evidence

The staging browser gate was upgraded to verify the actual MapLibre presentation, not only the `streetTasks` Pull response. Browser B remains open, no main-frame navigation/reload is permitted, and `.map-region` renderer diagnostics must converge:

```text
initial:   source=1 rendered=1
created:   source=2 rendered=2
completed: source=2 rendered=2
deleted:   source=1 rendered=1
reloads:   0
```

Run `33789841106` passed. The user then repeated the scenario manually on real devices and confirmed it works.

## Debug decision tree if Street sync regresses

Use this order; do not immediately blame RxDB if the line is stale:

1. No `[rxdb-sync] realtime-change` after a remote committed mutation:
   investigate Durable Object/WebSocket notification and Worker lifecycle.
2. `realtime-change` exists but no subsequent `streetTasks` pull:
   investigate client `refresh()` / RxDB `reSync()` scheduling.
3. `streetTasks` pull occurs but `documents` is empty when the change should be present:
   investigate D1 change feed, collection filtering and checkpoint/high-water logic.
4. Pull contains the correct Street document/tombstone, but Campaign UI information is stale:
   investigate RxDB -> materialized CampaignStore/read-model projection.
5. Campaign UI information is current, Street cannot be selected after delete, but the line remains visible:
   investigate `MapView` -> MapLibre GeoJSON `setData()` / source/layer projection. This was the fixed `isStyleLoaded()` drop bug.

This distinction is important: “line visible but no longer clickable” means the stale object may only exist in MapLibre rendering, not in canonical/app data.

## Staging / migration state

Migration `0017_rxdb_sync_changes.sql` has been applied and verified in the **isolated staging D1** as part of the staging pipeline. Staging migration ledger is contiguous and integrity checks passed.

Production is different: migration 0017 is still **unapplied to Production**. Successful staging does not authorize Production migration/deploy.

Staging deploy run `33789841058` passed tests, typecheck, dependency audit, build, staging isolation checks, Wrangler dry run, staging D1 checks/migrations, isolated Worker deploy and URL verification.

## Log scan after the fix

No functional application/test/deploy error remains in the checked final runs. Known non-blocking maintenance warnings:

- GitHub Actions warns that Node.js 20 actions are deprecated and the hosted runner forces Node 24 for current action versions.
- Node emits `punycode` deprecation warnings from tooling/dependencies.
- npm install reports deprecated transitive packages including `crypto-js@4.2.0`, `defekt@9.3.0`, and `get-graphql-from-jsonschema@8.1.0`; dependency audit reports 0 vulnerabilities.
- Node test runner emits `MODULE_TYPELESS_PACKAGE_JSON` warnings for TypeScript test files because package module type is not declared; tests still pass.
- Vite warns that the primary bundle is above its 500 kB chunk warning threshold; build still succeeds. This is a performance/maintainability item, not the Street correctness bug.
- Wrangler may warn about an unexpected top-level D1 API `ratelimits` entry and proceeds with empty ratelimits; the staging migration ledger/integrity checks still pass.
- Wrangler 4.33.1 reports a newer Wrangler version is available. Do not upgrade incidentally inside a release-critical bugfix without a separate decision/test cycle.

Treat these as follow-up maintenance, not evidence that the current Street fix failed.

## Intentionally unchanged behavior

Normal `area.create` and `area.update-geometry` do **not** automatically schedule Area preparation on the mission branch. Existing regression coverage explicitly locks this policy. Do not wire Worker context into normal RxDB Area pushes to re-enable automatic preparation unless the user asks to change product behavior.

## Remaining release work

The current Street realtime/render P0 is closed. Next release-level work is:

1. real Android Chromium offline/edit/reconnect smoke;
2. real iPhone Safari offline/edit/reconnect smoke, or explicitly document accepted risk if unavailable;
3. review/freeze the intended Production release head;
4. only on explicit approval: Production D1 migration 0017 through the approved migration path;
5. only on explicit approval: Production deploy;
6. keep PR #74 Draft/open until explicitly told otherwise.

## Next product topic: onboarding, not yet selected or authorized

The user previously described a clean/new URL flow that opens project onboarding with:

- project name;
- first admin username;
- first admin password.

This work was deliberately paused while the Street P0 was active. The P0 is now fixed, but this handoff request is **not** itself permission to implement onboarding.

Hard security requirements already established:

- trust server, never browser;
- password must never enter LocalStorage, IndexedDB, RxDB, URL, persisted generic app state or logs;
- only `Secure; HttpOnly; SameSite=Lax` session cookie on the browser side;
- server is authoritative for account, grant, role and campaign;
- `worker/adminAuth.ts` already contains PBKDF2-HMAC-SHA-256 password verification with random salt, 600,000 iterations, session hashes and lockout/backoff behavior.

There are multiple valid onboarding architectures and the user has not selected one. Before implementation, follow the project rule: present at least two concrete architectures, recommend one, but let the user choose. Mark unresolved details `UNKLAR`. Do not silently select an architecture.

## Planner AI operating instruction

When continuing:

1. Re-read branch/PR state before writes; do not trust these SHAs if the repository changed externally.
2. Preserve the verified Street lifecycle fixes and their regressions.
3. Do not weaken security guards to make logging/tests easier.
4. Distinguish Staging permission/evidence from Production permission.
5. If the next request is a new non-trivial feature, create/update the active plan first according to `AGENTS.md`.
6. If the user resumes onboarding, show the architecture choices before implementation.
7. If the user asks for release work, complete real mobile gates before claiming Production-ready.
