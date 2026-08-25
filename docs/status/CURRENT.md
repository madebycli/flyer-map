---
id: status-current
type: status
status: active
last_updated: 2026-08-25
---

# Current Project State

## Baseline

M4 access/session authorization and PR #21 (`renderer-access-recovery`) are merged on `main`. PR #21 merged as `63ea2e9c1e289b0c149fa4e229df6d02b81ef51d` on 2026-08-25 and Plan 008 is completed.

Production D1 migration `0002_m4_access.sql` is applied and `M4_BOOTSTRAP_SECRET` is configured outside the repository.

## Map

Current renderer baseline remains unchanged during M5:
- MapLibre GL JS **5.7.1 pinned**;
- CARTO Voyager Retina raster basemap;
- saved Areas/Streets in persistent MapLibre GeoJSON sources/layers created as part of the initial style;
- Campaign data changes update those sources through `setData()`;
- active draw/edit only in SVG;
- stored edit points hidden in browse;
- no application projection loop over saved geometry during normal pan/zoom/rotate.

MapLibre 6.4.1 is not the baseline: real-browser testing showed saved GeoJSON becoming invisible/non-interactive despite healthy FPS. Do not change this renderer inside M5.

## Current access

Current Campaign roles remain:
- Admin;
- Team Editor scoped to one Team;
- Viewer.

Campaign id is only a selector. Access/session authorization is Worker-enforced. Operator Admin recovery uses the configured server-only bootstrap/recovery secret and creates normal revocable access/session records.

## Active M5 development

M5 resilient mutation synchronization is the active implementation slice:
- branch: `m5-resilient-sync-mainline` from current post-PR21 `main`;
- PR #24: `M5 durable mutation queue on current MapLibre baseline` (Draft while acceptance continues);
- Plan 010: `docs/plans/active/010-m5-resilient-mutation-sync.md`;
- ADR-0011: page-owned IndexedDB mutation queue + Worker/D1 idempotency.

Implemented on PR #24:
- explicit Campaign/Team/Area/Street Task mutations;
- durable IndexedDB queue for unacknowledged changes;
- emergency localStorage shadow during the short enqueue window, with recovery into IndexedDB after a failed write/reload;
- emergency-shadow write failure does not block a successful IndexedDB enqueue and corrupt shadow data is quarantined;
- IndexedDB reads/writes wait for transaction completion, not merely request success;
- stable mutation id used as server idempotency key;
- canonical locale-independent SHA-256 mutation fingerprint binds each idempotency id to the exact validated mutation envelope;
- same id + same content returns the original applied revision without reapplying;
- same id + changed content is rejected as `mutation_id_reused`;
- ordered queue processing with bounded exponential retry;
- conflict / authorization-blocked / invalid terminal states;
- retry on online, visible-tab return and manual refresh;
- Worker mutation validation followed by the existing snapshot-based authorization policy;
- additive `migrations/0003_m5_mutations.sql` idempotency ledger;
- narrow D1 writes guarded by Campaign revision and internal write token;
- compact visible sync status.

Cloudflare's current D1 documentation confirms `D1Database.batch()` is transactional: a failing statement aborts/rolls back the full batch. The M5 claim -> narrow domain write -> ledger sequence therefore relies on documented D1 transaction semantics, not independent autocommit writes.

The obsolete pre-PR21 M5 draft PR #17 is closed as superseded. Its isolated sync ideas were selectively ported; its stale renderer/application baseline was not.

## Current repository acceptance

Runtime-hardening head: `8c7020ad5d1538bea68c351d918e94aa8f54973c`.

Confirmed:
- CI #202 completed successfully on `8c7020ad...`;
- tests include mutation derivation/conflict behavior, queue ordering/reload recovery, emergency-shadow recovery, localStorage-shadow failure fallback, corrupt-shadow quarantine, server duplicate application, changed-payload id reuse rejection and canonical fingerprint stability;
- TypeScript check and production build passed in the same CI run;
- later code+context+ADR/runbook head `5c7dce819d472be8242da59034310d7a87c21f36` passed CI #208;
- later commits after `5c7dce...` are documentation/handoff-only unless `CURRENT.md` or PR history explicitly says otherwise;
- PR #24 remains based directly on the post-PR21 `main` baseline and does not modify `src/map/MapView.tsx` or the accepted renderer architecture.

PR #24 body has been updated to mirror these acceptance facts and remaining gates.

## Cloudflare preview status

Keep this deliberately conservative:
- exact preview deployment is confirmed only for older PR head `fc200f9d4331d002fd73c060fd3c76636e69b0d2` at `https://9ad67cf5-flyer-map.cloudflare-eleven035.workers.dev`;
- the Cloudflare PR bot record checked after CI #208 still names `fc200f9d`, not the newer hardened runtime head;
- the current coding environment also cannot resolve `*.workers.dev`, so it cannot independently convert the branch preview into an exact-head claim;
- therefore **final runtime-equivalent Cloudflare preview remains an open gate**.

## D1 migration status

`migrations/0003_m5_mutations.sql` is repository-prepared only.

It adds the Campaign-scoped mutation ledger including required 64-character canonical mutation fingerprint. It is **not** claimed applied to the runtime/Production D1 database.

Do not intentionally exercise `/api/campaigns/:id/mutations` in an environment whose D1 has not had `0003` applied.

## M5 release gates

M5 is **not production-ready yet**. Before merge/production rollout:
- current final repository head must remain green in CI;
- exact Cloudflare preview for the final runtime-equivalent head must deploy successfully;
- `0003_m5_mutations.sql` must be explicitly applied to the D1 environment used for mutation runtime acceptance before the mutation endpoint is exercised there;
- real-browser acceptance must verify offline save -> reload -> reconnect delivery, duplicate-safe retry, visible conflict/auth-block states, retry retention and unchanged MapLibre renderer behavior.

## Known follow-ups

Two Plan-008 follow-ups remain deliberately visible:
- GitHub #22 — desktop bottom-toolbar fit/spacing; explicitly deferred for later;
- GitHub #23 — post-merge production health/deployed-origin Admin recovery smoke, real-browser `?diag=1`, and 500 / 1,000 / 2,500 / 5,000 Street device/browser stress validation.

Neither follow-up should be described as already passed. The current coding environment cannot independently fetch the public `workers.dev` production hostname; #23 records that limitation.

## Active plans / handoff

- `docs/plans/active/010-m5-resilient-mutation-sync.md` — active implementation/acceptance plan for M5.
- `docs/plans/active/009-product-platform-foundation.md` — ordered platform roadmap above Plan 010.
- `docs/prompts/NEW_AGENT.md` — updated to tell a fresh agent to continue existing PR #24/Plan 010, not create another M5 branch.
- `docs/context-map.yaml` — routes M5 work through Plan 010 and ADR-0011.

Completed renderer/access slice:
- `docs/plans/completed/008-renderer-access-recovery.md`.

## Accepted roadmap after M5

See `docs/product/ROADMAP.md`.

Order after the current M5 slice:
- M6 Smart Street + House Tasks using reviewed real map geometry instead of freehand tracing as the normal path;
- M7 comments, activity and deterministic automations;
- M8 Organizations, multiple admins and separate Admin panel;
- M9 statistics/reporting + personal UI light/dark/system appearance;
- M10 field hardening/release.

Organization and collaboration/statistics architecture are currently **proposed**, not implemented.

## Immediate next

1. Keep PR #24 Draft and preserve the accepted MapLibre renderer boundary.
2. Confirm CI for the latest documentation/handoff-only head; runtime CI #202 and complete code/context CI #208 are already green.
3. Resolve the exact Cloudflare preview-head gate without claiming the stale `fc200f9d` preview as current.
4. Apply `0003_m5_mutations.sql` to the chosen D1 runtime-acceptance environment before testing the mutation route there.
5. Complete real-browser M5 queue/conflict/retry/access-revocation acceptance one gate at a time.
6. Merge/deploy M5 only after those gates pass; keep #22/#23 visible as separate follow-ups.
