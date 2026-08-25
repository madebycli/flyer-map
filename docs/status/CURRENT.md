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

M5 resilient mutation synchronization is now the active implementation slice:
- branch: `m5-resilient-sync-mainline` created from current post-PR21 `main`;
- PR #24: `M5 durable mutation queue on current MapLibre baseline` (Draft while acceptance continues);
- Plan 010: `docs/plans/active/010-m5-resilient-mutation-sync.md`;
- ADR-0011: page-owned IndexedDB mutation queue + Worker/D1 idempotency.

Current M5 implementation direction on PR #24:
- explicit Campaign/Team/Area/Street Task mutations;
- durable IndexedDB queue for unacknowledged changes;
- stable mutation id used as server idempotency key;
- ordered queue processing with bounded exponential retry;
- conflict / authorization-blocked / invalid terminal states;
- retry on online, visible-tab return and manual refresh;
- Worker mutation validation followed by existing snapshot-based authorization policy;
- additive `migrations/0003_m5_mutations.sql` idempotency ledger;
- narrow D1 writes guarded by Campaign revision and internal write token;
- compact visible sync status.

The obsolete pre-PR21 M5 draft PR #17 is closed as superseded. Its isolated sync ideas were selectively ported; its stale renderer/application baseline was not.

## M5 release gates

M5 is **not production-ready yet**. Before merge/production rollout:
- repository `check` must be green on the final head;
- exact Cloudflare preview head must deploy successfully;
- `0003_m5_mutations.sql` must be explicitly applied to the target D1 environment before the mutation endpoint is exercised there;
- real-browser acceptance must verify offline save -> reload -> reconnect delivery, duplicate-safe retry, visible conflict/auth-block states and unchanged MapLibre renderer behavior.

The user explicitly instructed continued implementation on 2026-08-25, so development proceeds on the isolated PR #24 branch while the production gates remain enforced.

## Known follow-ups

Two Plan-008 follow-ups remain deliberately visible:
- GitHub #22 — desktop bottom-toolbar fit/spacing; explicitly deferred for later;
- GitHub #23 — post-merge production health/deployed-origin Admin recovery smoke, real-browser `?diag=1`, and 500 / 1,000 / 2,500 / 5,000 Street device/browser stress validation.

Neither follow-up should be described as already passed. The current coding environment cannot independently fetch the public `workers.dev` production hostname; #23 records that limitation.

## Active plans

- `docs/plans/active/010-m5-resilient-mutation-sync.md` — active implementation plan for M5.
- `docs/plans/active/009-product-platform-foundation.md` — ordered platform roadmap above Plan 010.

Completed current renderer/access slice:
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

1. Finish PR #24 repository implementation/tests/documentation without changing the accepted map renderer.
2. Resolve all CI failures on the current head.
3. Obtain an exact Cloudflare preview of the final M5 head.
4. Apply migration `0003_m5_mutations.sql` to the target D1 environment before runtime mutation acceptance.
5. Complete real-browser M5 queue/conflict/retry acceptance.
6. Merge/deploy M5 only after those gates pass; keep #22/#23 visible as separate follow-ups.
