---
id: plan-052-big-areas
type: plan
status: active
last_updated: 2026-10-11
related: [v5-readme, plan-051-full-rewrite]
---

# Plan 052 — Big Gebiete (600 km² and more): map data in parts

## Goal

A Gebiet of several hundred km² (the owner's extreme test: 600 km²) can be drawn, its map data fetched from OpenStreetMap, stored, cached on the device and derived — without a size limit that stops it at 25 km².

## Why one pack could not do it

One request per Gebiet means one Overpass answer per Gebiet. At a few dozen km² in a dense town that is tens of MB of JSON, more than a Worker holds in memory, and Overpass itself times out. So the work is cut up.

## Design (built)

- **Fixed grid** (`PACK_CELL_LNG` 0.03°, `PACK_CELL_LAT` 0.02°, about 2.1 × 2.2 km): the same grid for every Gebiet, so editing an outline never changes what a cell contains. `packPlan(ring)` (`src/v5/engine/overpass.ts`, shared by Worker and client) returns one part without a cell for a Gebiet up to 6 km² (works exactly as before) or the cells that touch the outline. Limit: 600 parts (about 2 800 km²).
- **Server** (`worker/v5/api.ts`): `POST/GET /areas/:a/pack?part=N`. Parts are stored under `<area>~N` in the existing pack tables (no migration). A part that is already built for this outline is skipped (resumable). When the last part is in, the Gebiet's own `v5_pack_meta` row is written (no chunks, `stats {parts}`); its version is the `packVersion` that `/meta` reports, so a big Gebiet counts as ready exactly when all parts are there, and as missing when its outline changed. Empty parts (water, fields) are built too. `forget` removes the parts.
- **Client** (`buildPackFor`, `useCampaign`): builds two parts at a time (each retried when the data source is busy), shows `n/total`; at start fetches six parts at a time, derives each (`engine.area` with its `cell`) and merges. The device cache is per part.
- **Engine** (TypeScript reference and Rust, parity-tested): with a `cell`, a part keeps only the houses whose centre lies in the cell and the street pieces that start in it, so the parts partition the Gebiet and merge without double entries. Street piece ids come from OSM way and node ids, hence are the same in every part.
- **Editor**: shows "Kartendaten in N Teilen"; only an outline of more than 600 parts is refused.

## First start: show the first parts, load the rest behind the map

Measured on a phone (Android, Chrome, 15 parts, 24 000 houses): packs 2.6 s, **deriving 14 parts 32 s** (the same code takes 1.6 s on an iPad), start 62 s. Deriving, not downloading, is the wait. A first start of a Gebiet with more than four parts therefore derives only the cached parts and the first three new ones (`FIRST_UNITS`), shows the map, and loads the others in a second, quiet pass (`boot({ quiet: true, rest: true })`, the same path as any reload; the first engine keeps serving tiles meanwhile). A notice "Weitere Kartendaten werden geladen · n/15" shows the progress; if the second pass fails the notice offers a reload. While parts are missing the queued edits are not pruned (`reconcilePending` waits for the complete network). `flow19` checks the two steps.

## Known limits (measured, not hidden)

- Everything is loaded at once. Measured with the Rust engine: 44 000 houses and 117 000 street pieces (10 m pieces) in 12 parts: derive 4.9 s, JS heap 107 MB, WebAssembly memory 135 MB. A dense 600 km² can mean several hundred thousand houses and street pieces: fine on a desktop, **likely too much for a phone**. Next step if the field test shows it: load parts on demand by the visible map area (the session already adds Areas incrementally; the app state and the progress totals would have to follow).
- A street piece that spans a cell border is counted with the houses of its own cell only (`houseCount`), which can hide a service road under "Nur Straßen mit Häusern" at a border. Streets proper are always visible.
- Building 600 km² is some 130 requests to OpenStreetMap: minutes, politely paced; the page has to stay open (it resumes where it stopped).
- Not tested against real Overpass data from here (the sandbox cannot reach it).

## Acceptance

- `tests/v5PackPlan.test.ts` (grid, partition, stability under edits, refusal), `tests/v5Api.test.ts` (parts, resume, ready/stale, empty part, forget), `tests/v5Wasm.test.ts` (cell parity TS ↔ Rust, partition property), `scripts/v5-e2e/flow19.mjs` (`BIG_AREA=1`: 16 parts built and fetched, same 1 159 houses as one pack, second start from the cache).
