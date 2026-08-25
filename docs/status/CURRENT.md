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
- saved Areas/Streets in persistent MapLibre GeoJSON sources/layers;
- Campaign data changes update those sources through `setData()`;
- active draw/edit only in SVG;
- stored edit points hidden in browse;
- no application projection loop over saved geometry during normal pan/zoom/rotate.

Do not change the accepted renderer inside M5.

## Current access

Current Campaign roles remain Admin, Team Editor scoped to one Team, and Viewer. Campaign id is only a selector. Access/session authorization is Worker-enforced. Operator Admin recovery uses the configured server-only bootstrap/recovery secret and creates normal revocable access/session records.

## Active M5 development

M5 resilient mutation synchronization is the active implementation slice:
- branch: `m5-resilient-sync-mainline`;
- Draft PR #24: `M5 durable mutation queue on current MapLibre baseline`;
- Plan 010: `docs/plans/active/010-m5-resilient-mutation-sync.md`;
- ADR-0011: page-owned IndexedDB mutation queue + Worker/D1 idempotency.

Implemented on PR #24:
- explicit Campaign/Team/Area/Street Task mutations;
- durable IndexedDB queue for unacknowledged changes;
- emergency localStorage shadow during the enqueue window, including recovery/failure/quarantine handling;
- IndexedDB reads/writes wait for transaction completion;
- stable mutation ids + canonical locale-independent SHA-256 mutation fingerprints;
- same id + same content is idempotent; same id + changed content returns `mutation_id_reused`;
- ordered queue processing with bounded exponential retry;
- conflict / authorization-blocked / invalid terminal states;
- retry on online, visible-tab return and manual refresh;
- Worker mutation validation followed by existing server-side authorization;
- additive `migrations/0003_m5_mutations.sql` ledger;
- narrow D1 writes guarded by Campaign revision and internal write token;
- compact visible sync status.

Cloudflare's current D1 documentation confirms `D1Database.batch()` is transactional and a failing statement aborts/rolls back the sequence. The M5 claim -> narrow write -> ledger batch relies on that documented behavior.

The obsolete PR #17 is closed as superseded and must not be revived as the current M5 branch.

## Repository / preview acceptance

Runtime-hardening head `8c7020ad5d1538bea68c351d918e94aa8f54973c` passed CI #202.

Complete code + context/ADR/runbook head `5c7dce819d472be8242da59034310d7a87c21f36` passed CI #208 and Cloudflare deployed that exact commit successfully.

Accepted exact runtime preview:
- `https://bb8fa846-flyer-map.cloudflare-eleven035.workers.dev`;
- Cloudflare PR bot explicitly names commit `5c7dce81` and deployment success.

The later status/handoff documentation heads remain runtime-equivalent unless a later PR commit changes application/Worker/runtime configuration code. Final docs-only head `547ee4cbcc14005f6c8bb92ff1064779140c0d88` passed CI #213 before the final D1-binding documentation note.

Any later runtime change invalidates the runtime-equivalent preview assumption and requires another exact preview.

## Preview D1 binding reality

Current `wrangler.jsonc` defines one D1 binding only:
- binding `DB`;
- database `flyer-map-db`;
- one `database_id`;
- no repo-defined staging environment or separate preview D1 binding.

Cloudflare Worker versions capture their bindings, but storage state is not versioned with Worker versions. Workers Builds does not automatically create separate non-production bindings for branch previews.

Therefore, under the current repository configuration, treat the M5 preview as **code-isolated but not database-isolated**. Unless an external Cloudflare override is explicitly documented later, M5 preview mutation requests operate against the configured `flyer-map-db`.

Operationally this is acceptable for the additive `0003` rollout because `0003` only creates a new ledger table/index and current Production code ignores it. Browser acceptance should use a deliberately disposable/test Campaign where practical.

## D1 migration status — next external gate

`migrations/0003_m5_mutations.sql` is repository-prepared only. It is **not** yet claimed applied to `flyer-map-db`.

Do not intentionally exercise `/api/campaigns/:id/mutations` until `0003` is explicitly applied.

## M5 release gates still open

M5 is **not production-ready yet**. Remaining gates:
1. apply `0003_m5_mutations.sql` to `flyer-map-db` and record successful/non-sensitive migration output;
2. real-browser acceptance: offline save -> reload -> reconnect delivery;
3. retry without duplicate effect;
4. visible conflict with no silent overwrite;
5. revoked access stops blind retry and remains access-blocked;
6. transient failure remains queued and retries later;
7. MapLibre saved Area/Street and active edit behavior remain unchanged;
8. final repository head remains green before merge.

## Known follow-ups

Plan-008 follow-ups remain visible and not-passed:
- GitHub #22 — desktop bottom-toolbar fit/spacing;
- GitHub #23 — production health/deployed-origin Admin recovery smoke, `?diag=1`, and 500 / 1,000 / 2,500 / 5,000 Street device/browser validation.

## Active plans / handoff

- `docs/plans/active/010-m5-resilient-mutation-sync.md` — active M5 plan.
- `docs/plans/active/009-product-platform-foundation.md` — platform roadmap above Plan 010.
- `docs/prompts/NEW_AGENT.md` — tells fresh sessions to continue PR #24/Plan 010, not create a replacement M5 branch.
- `docs/context-map.yaml` — routes M5 through Plan 010 and ADR-0011.
- `docs/operations/DEPLOYMENT.md` — records the shared preview/Production D1 binding and migration order.
- `docs/plans/completed/008-renderer-access-recovery.md` — completed historical renderer/access slice.

## Roadmap after M5

- M6 Smart Street + House Tasks using reviewed real map geometry instead of freehand tracing as the normal path;
- M7 comments, activity and deterministic automations;
- M8 Organizations, multiple admins and separate Admin panel;
- M9 statistics/reporting + personal UI light/dark/system appearance;
- M10 field hardening/release.

Organization and collaboration/statistics architecture remain proposed, not implemented.

## Immediate next

1. Keep PR #24 Draft and do not alter the accepted renderer.
2. Apply `0003_m5_mutations.sql` to `flyer-map-db`.
3. After migration confirmation, perform the browser M5 acceptance one gate at a time through the accepted runtime-equivalent preview/branch deployment, preferably with a disposable test Campaign.
4. Record every observed gate immediately in Plan 010 + CURRENT.
5. Merge/deploy M5 only after all remaining gates pass; keep #22/#23 separate.
