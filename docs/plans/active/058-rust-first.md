---
id: plan-058
status: active
date: 2026-10-21
---

# Plan 058: Rust first

Owner's rule: everything of our own is Rust where Rust works (UI, backend, sync, logic). What comes from elsewhere is used as it is, not rewritten: MapLibre GL JS, the Cloudflare runtime (Workers, Durable Objects, D1), the browser and its APIs.

## Today

| Part | Language today | Target |
| --- | --- | --- |
| Engine (derive, classify, tiles, route, lasso, search) | Rust (WASM) with a TypeScript reference | Rust only (Plan 055) |
| Sync client (HLC, op log, last-writer-wins merge, outbox, conflicts) | TypeScript (`src/v5/store`) | Rust core, WASM |
| Rules (who may write where, roles, join) | TypeScript in the Worker, mirrored by hand in the UI | One Rust crate used by Worker and client |
| Worker (API, D1, Durable Object, auth) | TypeScript (`worker/`, 42 files) | Rust (`workers-rs`) |
| UI (sheets, bar, menu, marking panel, organizer pages) | TypeScript + React | Rust (Leptos or Dioxus, WASM), MapLibre through bindings |
| Browser end-to-end flows | Playwright (JavaScript) | stay: they test the product from outside and are the acceptance test of every step |

## What exists and what was decided before

- **Sync service.** V4 used RxDB (open source, Dexie/IndexedDB; ADR-0024/0025, September). It was removed with the legacy map (phase 5.3, 2026-10-09): every replication event rebuilt the whole snapshot and 55 k streets as synced rows failed (ADR-0033). V5 has no sync library: it moves `key → status` deltas with a hybrid logical clock and last-writer-wins (`src/v5/store`, `worker/v5`), about 750 lines on the client. That is the simplest possible CRDT; a general CRDT library (Automerge, Loro, Yrs, all Rust cores) would cost more memory and bytes than it saves for this shape. They are worth a look only for concurrent note *text*.
- **ADR-0035** measured that a Rust Worker would not make any path faster and would put the security code (password KDF, TOTP, sessions) through a rewrite. The owner's rule now is Rust anyway; ADR-0035 is superseded for that reason only, and its own advice stays: the first slice is `worker/v5/*` behind the same HTTP contract, tested by running the TypeScript contract tests against both implementations. Auth moves last, and only if its gate passes.

## Order (each step ships on Unstable and keeps the flows green)

1. **Core crate `flyer-core`** (new, no JS APIs): HLC, op log, merge, conflict detection, outbox rules, and the permission rules as pure functions. The TypeScript versions become the reference for a differential test (same method as the engine) until they are removed. The client loads it as WASM next to the engine; the Worker uses the same crate. One truth for "who may write here": the UI stops mirroring it by hand.
2. **Sync client on the core**: `store.ts` / `syncClient.ts` shrink to thin glue (IndexedDB, fetch, timers). The merge and the rules run in Rust.
3. **Worker in Rust**, route by route behind the same HTTP contract (the existing Worker tests and flows are the contract): sync ops and state first, then access and links, then organization and auth, then the Durable Objects. Spike first (see gate).
4. **UI in Rust**, screen by screen after a spike (see gate). React and Rust UI do not share a screen: the first Rust screens are separate pages (start page, install guide, organizer pages), the field map comes last.
5. Remove the TypeScript references and React when the last screen is moved.

## Gates (decide with numbers, not taste)

- **Worker spike** (after step 2): the sync routes in `workers-rs` against the same D1 schema. Pass: Unstable flows green, cold start and bundle size not worse than 1.5 times today, D1 and Durable Object bindings complete for what we use (transactions, alarms, WebSocket if used). Fail: stay on TypeScript for the Worker, keep the Rust core for rules and merge.
- **UI spike** (before step 4): top bar, search card, menu, settings and one sheet in Leptos on a real low-end phone. Pass: first interaction not slower than today, bundle under today plus 400 kB compressed, gestures on sheets as smooth, flows green with only selector changes. Fail or unclear: keep React for the field UI and write only new pages in Rust.

## Why this order

The rules and the merge are where one source of truth pays off first and where bugs cost most (a wrong right is a security problem, a wrong merge loses marks). The Worker moves second because it must keep its HTTP contract and has the tests to prove it. The UI moves last: the biggest rewrite, the least logic, and the one where tooling (gestures, accessibility, sheet behaviour) is least mature in Rust.

## Not rewritten

MapLibre GL JS (used through bindings), Cloudflare Workers/D1/Durable Objects (the runtime), Playwright flows, the browser APIs. The Rust UI calls them through `wasm-bindgen`/`web-sys`.
