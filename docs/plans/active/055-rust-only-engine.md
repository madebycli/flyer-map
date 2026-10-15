# Plan 055 — one engine: Rust only

Status: proposed (2026-10-15). Nothing below is built yet.

## Why

The street engine exists twice: Rust/WASM (what the phone runs) and TypeScript (`src/v5/engine/*`). Every rule change has to be written twice and kept
identical (the garden-path rule v5.5 and the street link v5.6 both were). That doubles the work and is a standing source of drift.

## What the TypeScript engine still does today

1. **Reference for the tests.** `tests/v5Wasm.test.ts` derives the same data with both and requires identical output (synthetic cities, 120 fuzzed cities).
2. **Browser fallback.** If the WASM does not load, `EngineHost` computes with TypeScript (`kind: 'ts'`); there are no tiles on that path, so the map is degraded anyway.
3. **Server helpers.** `worker/v5/api.ts` imports `overpassQuery`, `packFromOverpass`, `encodePack`, `packPlan` (data fetch and packing, not the network derivation; the Worker stays TypeScript, ADR-0035).

## Target

- `deriveNetwork`, `restrictToArea`, route, lasso, search exist **only in Rust**.
- The TypeScript that remains is the data layer the Worker needs (`overpass.ts`, pack codec, `packPlan`), moved to `src/v5/pack/` and free of derive code.
- No browser fallback: a failed WASM load is an error screen with a retry, not a degraded map.

## Steps

1. **Freeze expectations.** Derive the synthetic cities, the fuzz seeds and the path-link fixture once with the current pair (they agree), store the results as committed JSON snapshots (`tests/golden/`), and let the Rust tests compare against them. A rule change then updates a snapshot on purpose, in one reviewed diff.
2. **Move the server helpers** out of `src/v5/engine/` (no behaviour change).
3. **Remove the fallback** in `EngineHost` and show a clear error when the WASM fails.
4. **Delete the TypeScript derive** (`derive.ts`, `route.ts`, `lasso.ts`, `area.ts`, `slim.ts`, `search.ts`, `synthetic.ts` only if the snapshots no longer need it) and the parity tests; keep `v5Wasm.test.ts` as snapshot tests.
5. Run the full flow suite and the soak; bump the engine version once.

## Risks

- Without a second implementation, a bug in a rule is no longer caught by disagreement. The golden snapshots and `scripts/real-osm-check.mjs` (real OSM areas, run on a GitHub runner) take that role; the latter has to call the Rust engine (Node WASM load) instead of `deriveNetwork`.
- A device where WASM does not run at all cannot use the field map. Chrome and Safari from the last years all run it; the diagnostics already report `engine.kind`.

## Not part of this plan

Moving the Worker itself to Rust (ADR-0035 keeps it TypeScript).
