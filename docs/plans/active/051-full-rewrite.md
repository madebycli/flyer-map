# Plan 051 — Full rewrite: one design, one shell, compute in Rust

Status: measured and planned; nothing deleted yet. Decisions needed are at the end.
Reference: [Plan 047](047-v5-field-ui-v2.md) (design system and shell), [Plan 046](046-v5-rust-tiles.md) (engine in Rust), Plan 031 (dormant features).

## What is there (measured 2026-10-09, `node scripts/reachability.mjs`)

| Area | Lines | Notes |
|---|---|---|
| `src` (UI + domain + data) | 51 203 in 288 files | `src/v5` is 6 135 of it; the rest is the legacy app |
| `worker` | 27 356 in 93 files | one Worker for everything; v5 handlers are `worker/v5` (≈ 800) |
| `engine-rs` | 1 858 in 11 files | derive, tiles, route, lasso, search |
| CSS | 12 035 in 65 files | the legacy look (`styles.css`, `m4.css`, `ui-dark-mode*.css`, one file per hub) |
| tests | 33 250 in 231 files | they are the specification of the legacy behaviour |

**Reachability** from `index.html`, `v5.html` and `worker/indexOrganizer.ts`: 71 400 of 78 940 lines are live. 43 files / ≈ 7 500 lines are not
imported by any entry point. Removing them was tried and **reverted**: 23 tests fail, because the plans keep them on purpose —
Activity, Automationen, Einsatz-Verlauf, Statistik, Team-Center ("implemented but not promoted", Plan 031), Smart House/Street tasks and the
v3/v4 street-engine remnants. "Unreachable" is therefore a list of *dormant product decisions*, not of garbage.

## Principles

1. **Replace, don't polish.** A legacy surface is rewritten in the v5 shell with the shared design system; its old code, CSS and tests are deleted in the same
   change, once the replacement passes an equivalent test. No parallel copies are left behind.
2. **Compute in Rust, glue in TypeScript.** Anything that is geometry, graph, search, validation or encoding moves into `engine-rs` with a TypeScript
   reference and differential tests (as done for route, lasso, search). UI stays TypeScript. The Worker moves to Rust only where that keeps the exact
   contract (see phase 4).
3. **The old tests are the spec.** Every phase starts by listing the behaviours its old tests assert and ends with the same assertions on the new code.
4. **Nothing goes live from here.** Each phase ends on staging (`flyer-map-staging`), production switches only on an explicit go.

## Phases

| # | What | Size | Rust? | Risk |
|---|---|---|---|---|
| 1 | **Design system as a package** (`src/ui`: tokens, `Sheet`, `Tile`, buttons, lists, forms) extracted from `src/v5`; `v5.css` becomes tokens + components | ≈ 1 000 lines | no | low |
| 2 | **Dormant features rebuilt** in the shell: Statistik, Aktivität, Einsatz-Verlauf, Automationen, Team-Center (≈ 3 300 lines of UI + 4 800 CSS today) | ≈ 1 500 new lines | stats/aggregation in Rust | medium |
| 3 | **Legacy map app** (`App.tsx` 2 095, `MapView.tsx` 2 699, collection view 917, comments, offline map, smart street/house) replaced by `/v5` | the big one | engine already Rust | high: it is what runs in production |
| 4 | **Worker**: v5 handlers (pack, state, notes, prune, meta) to Rust (`workers-rs`), same endpoints and tests; then mutations/sync; **auth last** (KDF, TOTP, trusted devices need their own security review) | ≈ 27 000 lines | yes | high |
| 5 | **Delete the legacy app**, its CSS (12 k lines) and the tests that only described it | − 45 000 lines | — | after go-live |

## Decisions needed (they change what is built)

1. **The dormant features** (Activity, Automationen, Einsätze, Statistik, Team-Center, Smart House/Street): rebuild them in the new design (phase 2), or delete them
   for good? Deleting needs the Plan 031 tests removed on purpose.
2. **The Worker in Rust**: adopt `workers-rs` and a build step in the deploy (phase 4)? This changes the deployment pipeline and the Durable Object classes.
3. **Go-live of `/v5` for the legacy map app** (phase 3): when, and which Aktionen first?

## Not decided here

Auth and security code are not rewritten before phases 1–3 are on staging. The D1 contracts (`campaign_mutations`, sync heads, retention) stay as they are.
