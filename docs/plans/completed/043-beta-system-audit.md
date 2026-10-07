# Beta system audit, 2026-10-07

## Ziel

Audit the current Beta, implement proven backwards-compatible corrections and
record the remaining acceptance gates without deploying or mutating remote D1.

## Anforderungen und Baseline

- Project `flyer-map`; context `.ai/CONTEXT.md` validated against REGISTRY.
- Beta `603775645a07c1587df6b3cae21e35836a6de81c`, clean fresh checkout.
- Isolated branch `audit/beta-performance-consistency-2026-10-07`.
- PR #130 is an unchanged candidate, not the baseline.
- Existing React/MapLibre/RxDB/Workers/D1 stack and server authorization remain.
- No merge, deploy, remote writes, migrations, secret or runtime changes.

## Architektur und Dateistruktur

Inspect map sources (`src/map/`), replica (`src/data/rxdb*`), V4 pipeline
(`worker/streetNetwork/`), API authorization, migrations and release workflows.
Keep changes at existing module boundaries. Evidence belongs in verification
documents; durable project handoff and status belong in the routed master-context.
Relevant context: CURRENT, context-map, Plan 042, MAP, OFFLINE_SYNC,
STREET_D1_BUDGET and release-channel invariant.

## Umsetzungsschritte

1. Verify branch, runtime, PR and CI; run sequential baseline gates.
2. Map routes/data flows; reproduce progress, polling, SQL and renderer issues.
3. Compare PR #130; adopt only independently verified parts with attribution.
4. Implement focused safe fixes with regression tests and matching measurements.
5. Run final gates, review diff, record costs, security and remaining field tests.
6. Commit and create a draft PR against Beta if all local gates pass.

## Acceptance

No invented cloud/browser claims. Tests protect actual failure modes. Report
separates local CPU/SQLite, CI, public runtime and authorized field evidence.
Account quota, exact Gebiet-8 failure and mobile performance remain explicit
gates when inaccessible. Check scaling, maintainability, security and costs.

## Risiken und Entscheidungen

Preserve V4-only fail-closed sources and immutable generation semantics. Prefer
bounded reads and existing renderer/replication ownership over framework changes.
Measure performance with the same deterministic dataset on both branches.

## Offene Fragen / UNKLAR

- Current account D1 quota and billed per-query usage.
- Exact private Gebiet-8 geometry, terminal diagnosis and cloud Base exception.
- Mobile cold/refresh/pan timings, FPS, GPU and memory.
- Whether infrastructure changes are needed after measured cloud usage.

## Non-goals

No product expansion or wholesale architecture rewrite. No remote field retry.

## Abschluss

Implementation audit completed locally on 2026-10-07. Candidate gates, measurements,
findings and open browser/cloud acceptance are recorded in
[the verification report](../../verification/2026-10-07-beta-system-audit.md).
PR #130 was reviewed and selected changes were adopted with additional fixes.
No deployment or remote D1 action. Follow Plan 042 for real Gebiet-8 acceptance.
