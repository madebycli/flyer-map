---
id: status-current
type: status
status: active
last_updated: 2026-10-12
---

# Current Project State

The authoritative cross-repository route is `.ai/CONTEXT.md` → `madebycli/master-context/projects/flyer-map/INDEX.md` → `handoffs/CURRENT.md`.

**What exists (branch `claude/rewrite-phase5-delete-legacy`, not merged into `main`/`beta`, not deployed; since 2026-10-10 one AI session (A) works on it alone by the owner's instruction; changes enter after its own checks and an independent review agent; history of the two-session phase in `madebycli/master-context` `projects/flyer-map/handoffs/dual/BOARD.md`):** one field map, `/v5`, written from scratch ([Plan 051](../plans/active/051-full-rewrite.md), [ADR-0036](../decisions/ADR-0036-legacy-map-retired.md)).
Streets and houses are derived on the device by a Rust/WASM engine from one OSM pack per Gebiet; only a status overlay and notes are stored and synced. One design system (`src/ui`) serves the field map and the organiser pages
(sign-in with second factor, Aktionen, Sicherheit, Einladungen). The old map, RxDB sync, V3/V4 street engine, the old Rooms, comments, statistics and automations are deleted; the Worker keeps identity, access links, the collection
backend (Abholen incl. admin setup), the lean mutation path and `worker/v5`. Source: 79 k → 23 k lines.

**Big Gebiete:** a Gebiet over 6 km² is built and loaded in parts of a fixed grid (up to ~2 800 km²); several hundred thousand houses at once are heavy for a phone, see [Plan 052](../plans/active/052-big-areas.md).

**Map speed (2026-10-11/12):** a phone report showed 109–157 blocked main-thread tasks of 400–600 ms; cause: MapLibre walks the whole feature-state list (48–49 k statuses) for every tile it loads. Now the engine holds the statuses and cuts them into its tiles (`setStatus`, property `st`), streets are cut from z14 only, low-zoom dots are thinned, cached parts count half in the first-start budget, pixel ratio ≤ 2 (`00ce2a0`, `2911b9b`). In the sandbox (4× CPU throttle, same city) blocked time per pan fell from ≈16.6 s to ≈7.4 s in total; **not yet measured on the phone**. Goal "same speed and data use for 10 / 1 000 / 100 000 houses": [Plan 054](../plans/active/054-scale-independent-loading.md) (partly built: start order by last view, server aggregates `/progress` + `/areas/stats` with migration 0030, overview from the server while parts arrive, parts of Aktionen with more than 8 units loaded on demand as they are looked at; levels of detail, completing the sizes in one go and a part filter on the state pull not built). Deploys of `00ce2a0` and `62761d5` to `unstable` first failed at the migration step because the Cloudflare account hit the D1 free-tier daily row-write limit; `00ce2a0` was re-run after midnight UTC (migrations 0028/0029 applied to the dedicated Unstable D1, deploy result not checked by this session).

**Diagnostics:** `?diag=1` / menu → Diagnose (engine, sync, network, map, log, report, previous-session errors) plus server request ids, `Server-Timing` and `V5_LOG_LEVEL` request lines (default `warn`): [docs/v5/DIAGNOSTICS.md](../v5/DIAGNOSTICS.md). No telemetry leaves the device.

**Verified (sandbox only):** 483 unit tests (`npm test`; re-count after every merge), 20 browser runs (flow 19 needs `BIG_AREA=1`: a big Gebiet in parts) incl. the diagnostics flow 16, the layout/Strecke flow 18 (menu bottom-left, caption, house taps, mode ends after the status, shrinking sheet), the sheet audit flow 17 (11 sheets × 390/430 px × dark/light plus 1280 px desktop, measured after their data loaded: no sideways scrolling, every control ≥ 44 px and named, one spacing rhythm, no cut-off captions, note icons ≥ 3 : 1, sheets really close; 472 checks; flow 11 applies the same bar to every organiser page) and the soak run (tile count really measured since B-F-010; also with 39 207 houses: heap 37.5 → 41.9 MB, DOM/WASM flat) against the real Worker handlers on in-memory D1 (`scripts/v5-e2e`, `node scripts/v5-e2e/run-all.mjs`; also in TypeScript-fallback mode), typecheck, build. Flow 15 (Gebiet and helper-rights sheets at 390/430 px × dark/light × left/right, mobile clarity) is added by B: [evidence](../v5/screens/mobile-clarity-2026-10-09/README.md).
**Not verified:** real phones, real Overpass data, a real D1, the live basemap, the organiser pages against the real API (flow 11 mocks it at the network edge).

**Testing:** the integration branch is fast-forwarded to `unstable` → https://flyer-map-unstable.cloudflare-eleven035.workers.dev with its own, empty D1 (`flyer-map-unstable-db`); first start with the one-time setup key at `/start`: [docs/operations/UNSTABLE_TESTEN.md](../operations/UNSTABLE_TESTEN.md).

**Open before go-live (owner):**
- Apply `0026_v5_field_state.sql`, `0027_v5_notes.sql`, `0028_v5_window.sql`, `0029_v5_rooms.sql` and `0030_v5_area_stats.sql` (all additive; 0028/0029 before the code that uses them) on the target D1; on staging also the missing legacy migrations behind the login 500 (`0023`, `0024_*`, `0025`) — needs a go.
- Deploy to **staging** first (`deploy/staging/wrangler.staging.example.jsonc`), test with real devices, then merge. Branch previews share the production D1; production is untouched.
- Decide: English UI, manual street (dropped, see Plan 051 decision 5). Rooms were rebuilt on the owner's request as v5 Räume/Runs for distribution ([Plan 053](../plans/active/053-rooms-and-window.md)); assigning Gebiete to Gruppen is built. Delete the old remote branch `claude/v5-field-core`.
- `CampaignSyncDurableObject` stays as an empty stub until a `deleted_classes` migration is approved (it destroys the object's storage).
- GitHub workflows for the old pipelines (street engine, RxDB sync, D1 attribution) are unchanged and partly obsolete; the owner decides which to remove.
- `npm run audit:dependencies` reports high advisories in the Cloudflare dev tooling (`wrangler`/`miniflare`/`@cloudflare/vite-plugin`); not touched here.

`STREET_ENGINE_LIVE_READY=FALSE` (the flag and V4 engine no longer exist in code). No Production/Main deploy, Production D1 mutation or secret rotation without explicit authorisation.
