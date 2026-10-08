# Plan 046 — v5: geometry stays in Rust, the map reads vector tiles

Status: IN PROGRESS on `claude/v5-field-core` (R1 done)
Reference: [ADR-0034](../../decisions/ADR-0034-v5-notes-chunks-and-engine-language.md) item 4, measurements there.

## Why

R1 (derive in Rust) is exact but gains little because the network is handed to JavaScript as ~22 MB of JSON for 39 k houses
and then rebuilt as GeoJSON for MapLibre. The cost is the hand-over. So: Rust keeps rings and street coordinates, MapLibre
asks for tiles, the app keeps only slim logic data.

## Phases

- [x] R1 — `engine-rs`: derive + restrictToArea, exact differential tests, worker integration with TypeScript fallback
- [ ] R2 — tile cutter in Rust (MVT: `segments` lines, `houses` polygons, `centers` points), session holding all Areas, serialisable index
- [ ] R3 — slim `Network` (no coordinates; per segment a midpoint, per house its centre) and the few geometry consumers (snap, legacy import) as Rust queries
- [ ] R4 — MapLibre custom protocol + vector sources with `promoteId`, feature-state painting unchanged; GeoJSON path kept as fallback
- [ ] R5 — warm start from one binary blob (index) instead of structured-cloned objects; benchmarks in the browser

## Acceptance

Every browser flow passes on both paths; tiles are byte-stable for the same network; the first screen needs no main-thread
parse of geometry; warm start reads one ArrayBuffer.
