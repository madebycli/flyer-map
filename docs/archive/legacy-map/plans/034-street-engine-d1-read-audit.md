# Plan 034: StreetEngine, systemwide D1 reads and sync

> Current continuation: [StreetEngine masterplan audit](../../status/STREET_ENGINE_MASTERPLAN_AUDIT.md). The prepared Area-delete read path is independently verified fixed locally; D1 work is limited to reproduced link-phase rereads. The current compute decision is ADR-0031 and the active continuation is Plan 035. Earlier measurements below remain historical.


Status: active, Phase B runtime fix checkpoint. Date: 2026-09-12.

## Goal and baseline

Identify preparation/persistence/sync failures and systemwide read amplification before changing runtime. Baseline and ongoing evidence: [audit](../../status/STREET_ENGINE_D1_AUDIT.md), current published runtime `8b1bec21`, draft PR #92.

## Relevant context graph

Nodes: street-house-network-recovery, adr-street-house-network, adr-street-base-budget, street-d1-budget, data, offline-sync, security, quality. ADR-0027/0029 retain server-generated immutable base, user-owned overlays, guarded publication, D1 authority and existing DO coordination.

## Tasks

1. Verify current branch/deployment; re-fetch before edits and commits.
2. Trace UI -> Preparation API -> DO/job -> source acquisition -> generation -> D1/feed -> RxDB -> map.
3. Inventory systemwide reads: bootstrap, status, incremental sync, auth, Organizer, history/statistics, collection/pickup, sessions/groups.
4. Reproduce relevant failures locally. Compare idle, one preparation, duplicate start, reconnect and multiple clients. Inspect EXPLAIN with synthetic data; never use a remote load test.
5. Checkpoint findings/tests immediately. Identify confirmed causes separately from live unknowns. Complete prioritized fix and verification plan.
6. Only then implement evidence-backed minimal fixes, test, run CI and authorized Admin Staging. Real-device acceptance remains distinct.

## Acceptance and risks

- Every claimed cause has reproducible evidence or an explicit live trace.
- Read costs distinguish returned rows, rows visited, request frequency and actual billing. No unsupported attribution of 4.5m reads.
- Generation is atomic and idempotent; retries preserve user edits; two clients converge without reload or repeated bootstrap.
- Preparation never performs autonomous Smart Marking.
- No production action, merge, remote D1 mutation/migration, credentials changes, force push or overwrite of concurrent work.
- Missing live metrics/device results are blocking evidence gaps, not a reason to guess or generate load.

## Decisions / non-goals

Keep MapLibre 5.7.1 and existing UI. No timing hacks, architecture replacement, added service or speculative index migration. Existing local query/write budgets are useful but are not proof of D1 billing or live source availability.

## Phase A checkpoint / implementation ordering

The historical checkpoint had seven new local characterizations and 47 existing focused tests. The current audit suite has eight characterizations and the current remote CI is green with 875 tests. Confirmed: three whole-House reads for one Team rename, full snapshot on preparation begin, prepared-Area delete snapshot amplification, actual RxDB premature short-page completion, alias blindness in read estimation, missing campaign-leading Collection member index. Healthy idle/status helpers do not load House snapshots.

The audit contains the systemwide query inventory, scaling/frequency model, narrowed hypotheses and ordered fix/verification plan. Phase B now contains local/runtime fixes for Area-only preparation begin, metadata snapshot projections, prepared-Area delete snapshot bounding, RxDB physical-page continuation, workspace polling backoff/pause and alias-aware local scan accounting. Live preparation error, Admin-Staging validation and actual daily-read attribution are still missing. Next input is the existing preparation response/job error and D1 usage window, not a new remote load test. Do not close the real-device renderer gate or claim live remediation from local tests alone.
