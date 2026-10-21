---
id: plan-059
status: active
date: 2026-10-21
---

# Plan 059: flyermap-rs (the Rust rewrite of everything of our own)

Owner's rule: what is ours is Rust: logic, sync, rules, backend and UI. What comes from elsewhere is used as it is: MapLibre GL JS, the Cloudflare runtime (Workers, Durable Objects, D1), the browser and its APIs, Playwright. The name for people stays **Verteil-Flyer / Flyer Map**; `flyermap-rs` is the code name of the workspace (`flyermap-rs/`) and appears nowhere in the app.
Supersedes Plan 058 and ADR-0035 (the Worker stays TypeScript): the measurements in ADR-0035 still hold (Rust does not make a handler faster), the reason to move is one language, one set of rules for client and server, and maintainability.

## History this builds on

- V4 used RxDB for sync (ADR-0024/0025) and was removed (ADR-0033). V5's sync is its own small thing: `key → status` with a hybrid logical clock and last-writer-wins. It is the simplest CRDT and moves to Rust unchanged in behaviour. Generic CRDT libraries (Automerge, Loro, Yrs) are not used for it; only concurrent note *text* could ever need one.
- The TypeScript code stays alive as the **oracle** until each part is replaced: golden vectors made by the TypeScript implementation are the test input of the Rust one.

## Rules of the code (they decide how the workspace is cut)

1. **Layers.** A crate depends only on crates below it (`flyermap-diag` is the lowest; everything may log through it, nothing else is allowed down there). No cycles, no "util" crate. Pure logic never touches the network, storage, time or randomness: those come in through small traits.
2. **One concept per module, one module per file.** A file has one reason to change. Soft limit 300 lines per file, hard limit 500; `scripts/rs-check.sh` fails the build above the hard limit. A `mod.rs` only declares and re-exports.
3. **Small public surface.** Each crate exposes a few types and functions in `lib.rs`; everything else is private. Types carry meaning (`Key`, `OpId`, `AreaId`, `Status`), not strings and numbers.
4. **Errors are typed** (`thiserror`), never strings, never panics on bad input. User-visible text is German and lives in one place (`flyermap-wire::text`), not in handlers.
5. **JSON only at the edge.** Inside, data is structs and enums. Wire shapes are defined once in `flyermap-wire` and used by the client and the Worker alike, so a changed field cannot break one side silently.
6. **No `unsafe` except the engine's C ABI.** Workspace lint `forbid`; the engine crate opts out explicitly.
7. **Everything testable without a browser.** Core, rights, wire, sync and the Worker handlers run in native `cargo test`; the browser only runs glue and screens.

## Crates

| Crate | What it holds | Depends on |
| --- | --- | --- |
| `flyermap-diag` | events, levels, ring buffer, metrics, probes, breadcrumbs, redaction, report; the recorder is installed by the host (browser or Worker) | serde |
| `flyermap-core` | `status`, `key`, `clock` (HLC), `op`, `overlay` (last-writer-wins map), `outbox`, `conflict`, `store` (composes the four), `progress` | serde |
| `flyermap-rights` | `role`, `access` (the caller), `area` (distribution and collection), `rules` (can_read_area, can_write_area, scope), `op_rules` (what makes an operation acceptable) | core |
| `flyermap-wire` | requests and responses of `/api/v5/...` (ops, state, meta, notes, rooms, progress, ...), error body, German texts | core |
| `flyermap-sync` | the sync loop as a state machine: rounds, batches, backoff, history; traits `Transport`, `Storage`, `Timer` | core, wire |
| `flyermap-engine` | derive, classify, tiles, route, lasso, search (WebAssembly, C ABI) | own |
| `flyermap-worker` | `http` (router, request, response, observability), `access` (grants to caller), `repo` (traits + D1 implementation), `handlers/*` one file per resource | core, rights, wire |
| `flyermap-web` | `platform` (storage, fetch, timers, wake lock, vibration, viewport), `ui` (design system), `map` (MapLibre bridge), `features/*` (field, marking, areas, notes, rooms, team, access, settings, help, diagnostics), `app` (router, session, state) | core, wire, sync, engine |

## Diagnostics and logs (designed in from the first crate, not added afterwards)

Goal: when something is wrong on a phone or on the server, one report says what happened, in what order, how long it took, and what the person did before, without any personal data.

- **`flyermap-diag`** is the lowest crate. It defines `Event {t, level, area, code, message, fields}`, the macros `info!/warn!/error!` and `span!`, a **recorder trait** the host installs once (browser: ring buffer + console + optional report upload; Worker: one structured JSON line per event/request to the Cloudflare log; native tests: a collecting recorder). Pure crates only call the macros; with no recorder installed they cost nothing.
- **Stable codes.** Every failure a person can meet has a stable code (`sync.push.forbidden`, `pack.build.timeout`, ...) with a German explanation and the next step in `flyermap-wire::text`. The report groups by code, the interface shows the sentence, support reads the code.
- **Correlation.** Each request carries a request id; the Worker echoes it and adds `Server-Timing`; the client log line and the server log line share the id, so one search finds both sides.
- **Breadcrumbs.** The last 50 steps (screen opened, mode changed, mark applied with the count, sync round result) without positions, names or free text: enough to reproduce.
- **Timeline.** Boot phases, sync rounds (sent, accepted, rejected, pulled, ms), map style loads, engine calls, long frames: all as timed spans with the same format, newest last.
- **Doctor.** `Store::check()` and friends verify invariants (outbox ids unique and sorted, every queued op also in the overlay or superseded, cursor never behind, clock never behind the newest id) and return findings; the report includes them, tests call them after every fuzz step.
- **Redaction by allowlist.** Foreign text (library messages, server bodies) is never copied into a report as it is: kinds and codes only. Positions, names, tokens never leave the device. The redaction is one module with its own tests (the TypeScript version's cases are the starting set).
- **Report.** Versioned JSON (`schema`), built from the recorder: environment (build, browser, screen, storage), stores (counts, cursor, clock offset), sync timeline, probes, findings, last errors by code, breadcrumbs. Copy and download as today; plus **"Diagnose senden"**: the person taps once, the report is stored on the server for 7 days under a short code (`D-7K2Q`) that the person reads out; the owner opens it on the admin page. Nothing is sent without that tap.
- **Server.** Request log with route template, status, ms, db statements and ms, code; slow-request and error summaries per route kept in D1 counters for the admin page ("last hour: 3 failed pushes, p95 push 180 ms").
- **Failure injection** (debug only): offline, slow network, 500 on the Nth call, clock skew; used by the flows to prove that the diagnostics say the right thing.
- **Flows assert quiet.** The end-to-end flows fail when an unexpected `warn`/`error` event appears, so new noise cannot hide.

## UI architecture (one look, built from few parts)

- **Zones** (fixed, the same on every screen): top bar zone (command bar), right rail (map tools), bottom-left chip (context: role/group, room), bottom-right primary action (marking), one sheet zone. Nothing else floats on the map.
- **Three container kinds only:** `Bar` (floating, one line), `Sheet` (bottom, scrolls, header with back/close), `Card` (modal, short). Every screen is a `Sheet` or a `Card` filled with `Section`s of `Row`s.
- **Row kinds:** navigation row, info row, switch row, choice (segmented), field, action button. Heights from three tokens (control 48, row 56, bar 56) on an 8 px grid; radius from two tokens. No per-screen sizes.
- **Marking panel** has four slots that never move: mode (top-left), brush/status (top-right), confirm (bottom-right), cancel/undo (bottom-left); a mode adds its own control only inside its slot.
- **Look:** the colours, shapes and tokens of 5.7 stay (the owner is happy with them); `tokens.css` and `components.css` are carried over and become the only CSS. Components are Rust; styling is these classes.
- **DOM contract:** roles, labels and the key classes (`.v5-pill` with `data-done`/`data-total`, bar, sheet) stay as they are, so the Playwright flows are the acceptance test of the Rust app with selector changes only where a screen was deliberately changed.

## Build and delivery

- `flyermap-web` builds with `cargo build --target wasm32-unknown-unknown` and `wasm-bindgen --target web`; no Node bundler. MapLibre GL JS is copied as a static file; the app loads it once and talks to it through typed bindings (expressions are JSON and stay JSON).
- `flyermap-worker` builds with `worker-build`; D1 and Durable Object bindings as today; static files (the web app, icons, manifest, service worker) are served as assets.
- Until parity the Rust app is served next to the React app (`/rs/...`), same API, same data. At parity the entry points switch and the TypeScript app, references and tests are deleted.

## Milestones (each one ships to Unstable and keeps the existing flows green where they apply)

- **M0** workspace and engine moved (done).
- **M1a** `diag`: events, recorder trait, ring buffer, redaction, metrics, report; native tests.
- **M1** `core`: clock, overlay, outbox, conflicts, store, progress, with golden vectors from the TypeScript store.
- **M2** `rights` and `wire`: rules and operation validation with vectors from `worker/v5`; wire types for ops, state, meta.
- **M3** `sync`: the loop as a state machine with a fake transport; the same scenarios as `tests/v5Sync*.test.ts`.
- **M4** `worker`: `ops`, `state`, `meta` in Rust behind the same HTTP contract, run under `wrangler dev`; the TypeScript contract tests are ported to Rust fixtures route by route, then notes, rooms, progress, packs, cleanup, collection, access links, organization and auth.
- **M5** `web` shell: platform layer, design system, command bar, menu, settings, sheet; the field map with the engine and the store (read-only), then marking (stamp, brush, route, lasso).
- **M6** `web` features: areas editor with connected drawing, notes, rooms, team, access, templates, help, diagnostics, install guide and start page.
- **M7** organizer pages and auth in Rust.
- **M8** switch the entry points, delete TypeScript.

## Decisions to check with numbers on the way

- Bundle size and first interaction of the Rust app on a real low-end phone (target: not slower than the React app today).
- `workers-rs` coverage of what we use (D1 batch, Durable Object alarms, crypto for the password KDF); if a binding is missing, that one handler uses a small JS shim, the rest stays Rust.
