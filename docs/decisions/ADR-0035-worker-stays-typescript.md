---
id: adr-0035-worker-stays-typescript
type: decision
status: accepted-for-v5-branch
last_updated: 2026-10-09
---

# ADR-0035 — The Worker stays TypeScript; Rust is used where the compute is

## Context

The product owner allowed moving the Worker to Rust (`workers-rs`) "if sensible" and asked for "everything in Rust that can be". Plan 051 therefore sketched a strangler
(Rust entry Worker, service binding to the TypeScript Worker, auth last). The decision was left to the technical owner.

## Measurements (2026-10-09, `scripts/` bench on the synthetic city, node 22)

Server-side pack build for one Area (Overpass response → normalised raw → gzip), the only heavy thing the v5 Worker does:

| Area | houses | Overpass JSON | `JSON.parse` | normalise | gzip + encode | total CPU |
|---|---|---|---|---|---|---|
| small | 1.2 k | 0.5 MB | 3 ms | 9 ms | 95 ms | ≈ 0.1 s |
| medium | 12.8 k | 5.1 MB | 48 ms | 32 ms | 98 ms | ≈ 0.18 s |
| large | 39 k | 15.5 MB | 167 ms | 79 ms | 257 ms | ≈ 0.5 s |

`JSON.parse` and gzip (`CompressionStream`) are host-native in both languages; the part Rust could speed up (normalise) is 79 ms at 39 k houses. Everything else the v5 handlers do
is a prepared SQL statement and a small JSON body.

## Decision

1. **The Worker stays TypeScript.** A Rust port would not make any measured path faster, it would triple the build and deploy pipeline (`worker-build`, wasm size, a second test harness
   because the existing 1 190 tests run the real handlers against in-memory SQLite), and it would put the security-critical code (password KDF, TOTP, trusted devices, sessions) through a rewrite
   without a benefit. Revisit only if a measured CPU limit is hit.
2. **Rust stays where the compute is, in the browser:** derive, tiles, route, lasso, search (`engine-rs`), each with an exact TypeScript reference and differential tests.
3. **Worker work in this rewrite is subtraction:** the dead legacy sync (RxDB change feed, sync heads, Durable-Object notifier), street-engine materialisation (v3/v4 tasks) and the pages that only
   served the old map are deleted together with their tests (Plan 051 phase 5). What v5 uses stays untouched: mutations, access links, collection, pickups, organisation API, `worker/v5`.

## Consequences

- No `workers-rs` probe is needed; the earlier probe request is withdrawn.
- If the product owner still wants a Rust Worker for its own sake, the first slice would be `worker/v5/*` (≈ 800 lines) behind the same HTTP contract, tested by running the TypeScript contract tests over HTTP against both
  implementations; auth would not move.
