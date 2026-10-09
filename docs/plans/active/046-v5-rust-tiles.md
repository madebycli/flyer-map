# Plan 046 — v5: geometry stays in Rust, the map reads vector tiles

Status: R1–R5 done on `claude/v5-field-core`; follow-ups listed at the end
Reference: [ADR-0034](../../decisions/ADR-0034-v5-notes-chunks-and-engine-language.md) item 4, measurements there.

## Why

R1 (derive in Rust) is exact but gains little because the network is handed to JavaScript as ~22 MB of JSON for 39 k houses
and then rebuilt as GeoJSON for MapLibre. The cost is the hand-over. So: Rust keeps rings and street coordinates, MapLibre
asks for tiles, the app keeps only slim logic data.

## Phases

- [x] R1 — `engine-rs`: derive + restrictToArea, exact differential tests, worker integration with TypeScript fallback
- [x] R2 — tile cutter in Rust (MVT: `segments` lines, `houses` polygons, `centers` points), session holding all Areas (first Area wins), bincode snapshot per Area
- [x] R3 — `FieldNetwork` (no coordinates; per segment `mid`/`start`, per house `center`); snapping is an engine query (Rust, TypeScript twin, differentially tested)
- [x] R4 — MapLibre custom protocol `v5t://`, vector source with `promoteId`, feature-state per source-layer; GeoJSON path kept as the fallback (`?engine=ts` forces it; all browser flows pass in both modes)
- [x] R5 — warm start loads one binary snapshot per Area into the engine; boot timings in `window.__v5Boot`

## Acceptance

Every browser flow passes on both paths; tiles are byte-stable for the same network; the first screen needs no main-thread
parse of geometry; warm start reads one ArrayBuffer.

## Measured (headless Chromium, software WebGL, 39 k houses in two Areas, same machine, 2026-10-08)

| | TypeScript + GeoJSON | Rust + vector tiles |
|---|---|---|
| cold start: ready (derive done, first screen data) | 2.4 s | 1.2 s |
| …then until the map has loaded its data | +2.0 s (GeoJSON indexing) | +0.003 s (tiles on demand) |
| warm start: ready | no cache | 0.9 s |
| JS heap after load | 147 MB | 57–69 MB |
| one z16 tile | – | a few ms |

Honest limits: the Rust derive itself is ≈ 4× faster than V8 natively but only ≈ 1.5–2× inside WebAssembly here; the win is
mostly *not moving geometry through JavaScript*. Numbers from a fast desktop CPU with software GL: real phones are the open gate.

## Follow-ups

- ~~Route graph still TypeScript on the main thread~~ done: the session keeps the street graph (every piece, hidden connectors included, first Area wins) and answers `route(anchors)` in Rust inside the Worker; the TypeScript `routeSegments` stays as the reference and fallback (`tests/v5Route.test.ts`: 600 random routes over five random cities compare exactly — ids, length, ambiguity, disconnected; both break ties by network order).
- Tile-side simplification at low zoom (one dot per house is cheap, long streets at z11 are not yet generalised).
- Server-side use of the same crate (pack validation) would need the Worker's wasm import; not needed yet.
