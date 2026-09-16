---
id: status-current
type: status
status: active
last_updated: 2026-09-16
---

# Current Project State

- Active Street Engine V3 implementation branch: `feat/street-engine-v3-implementation-2026-09-16`, based exactly on `beta@5aa61866ec6e9a4dd8d369cf34348c13502d38e7`. `main`/Stable is untouched.
- The V3 authority is the 2026-09-16 Free-Tier-First Greenfield brief. [ADR-0032](../decisions/ADR-0032-street-engine-v3-precompiled-source-packs.md) supersedes ADR-0031's V2 compute-default for V3.
- V3 direction: precompiled immutable StreetEngine-ready Source-Packs, content-addressed source objects, thin area-specific runtime, Browser Worker as benchmarked normal-path candidate, bounded server verifier/fallback, R2/static for immutable geometry and D1 only for small relational/manifests/overlay state.
- First implementation slice is in [Plan 037](../plans/active/037-street-engine-v3-source-packs.md): per-generation Free-Tier resource gate plus immutable Source-Pack manifest/selection core.
- Implemented on the feature branch: `streetEngineV3Budget.ts`, `streetEngineV3SourcePack.ts` and focused tests. Source selection supports normal WGS84 coverage and small antimeridian-crossing Areas; source objects are addressed only by validated SHA-256, never by arbitrary client URLs.
- Browser source preflight target is <=20 MiB and hard-blocks plans >40 MiB. D1 engineering target remains <=10k rows read/run, preferred <=5k; Worker/DO request targets <=100/run.
- Mandatory benchmarks remain open: TypeScript vs Rust/WASM, binary shards vs FlatGeobuf, real Gebiet-3 transfer, current-iPad peak memory and reproducible cold <=60 s / <=20 MiB. No pass is claimed yet.
- No V3 R2 binding, D1 migration, Beta deploy, remote D1 mutation, Stable deploy or secret change has been made by this slice.
- Release invariant: implementation stays on a branch from `beta`; after branch CI/benchmarks are green, PR merges to `beta`, exact beta SHA is verified, and only the existing Beta release/link is used for runtime/device testing.
