---
id: status-current
type: status
status: active
last_updated: 2026-09-13
---

# Current Project State

- Source: `madebycli/flyer-map`, `fix/street-engine-smart-marking`, Draft PR #92, open/unmerged; base `integration/main-street-runtime@f4facd6ef354c5ba6de861519b696bce6f46a209`.
- Last verified runtime: `3ad3fc755bbdcfa03a1b1110312a0f3ab198af31`. Exact CI [34720417354](https://github.com/madebycli/flyer-map/actions/runs/34720417354), job `103625130098`: Tests, Typecheck, Dependency audit and Production build success.
- The quality fix rejects entirely corrupted Building tiles, classifies null nodes as data errors, persists safe source-attempt metadata and exposes bounded quality/failure details. Source cache version 2 avoids old silently reduced cached tiles. Existing ready generations are not automatically regenerated.
- Local Smart-Marking candidate full suite: 893/894 pass; one sandbox Unix-socket EPERM in the two-tab leader-election test. Local TS7 cannot start because `/proc/self/exe` is unavailable; TS5.9.3 passes. Local Build passes; audit passes with the existing MapLibre GHSA-jrc7-96c5-q579 exception, not zero advisories.
- MapLibre remains exactly 5.7.1 with unitbezier 0.0.1. Existing Area draw/edit compact HUD and same-button comments toggle retained; no renderer rewrite.
- `AREA_DELETE_READ_PATH=VERIFIED_FIXED` locally through RxDB/DO regressions. `D1_STATUS=OPEN` only for directly affected repeated full edge-staging reads in the link phase. No new Delete rewrite or broad D1 project.
- 0/399/1k/5k/10k synthetic source runs completed; 20k/two tiles fails at the current 10k target limit. This is a capacity blocker, not a passed 20k test.
- Compute decision: server-first/server generation; operator compute remains conditional on measured CPU/memory benefit including validation/upload costs. [ADR-0031](../decisions/ADR-0031-street-engine-compute-placement.md).
- Smart-Marking candidate: up to 32 visible waypoints, per-leg choices, Undo/Cancel, one atomic intent, stale-road state guard, exact partial coverage details and conflicting address-node rejection. [Plan036](../plans/active/036-smart-marking-waypoints.md); candidate CI pending, separate from the verified P1 runtime below.
- Active implementation plan: [035](../plans/active/035-street-engine-masterplan.md). P1 quality/diagnostics implemented. P2 pause/resume, P3 20k/graph reads, P4 integrity/real sync, P5 live acceptance remain open.
- No new staging deployment, remote D1 read/write/migration, merge, Production change or secret change in this audit. Historical staging evidence is not evidence for this runtime.
- `STREET_ENGINE_LIVE_READY=FALSE`, `D1_ATTRIBUTION_CONFIRMED=FALSE`, `MAP_RENDER_P0=OPEN`. The reported Buildings/cursor-0 live cause still needs its sanitized failed-job and deployed-SHA evidence.

Detailed evidence: [audit](STREET_ENGINE_MASTERPLAN_AUDIT.md), [D1 gate](../verification/2026-09-12-street-engine-d1-gate.md), [handoff](STREET_ENGINE_MASTERPLAN_HANDOFF.md).
