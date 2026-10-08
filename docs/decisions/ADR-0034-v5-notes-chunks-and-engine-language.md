---
id: adr-0034-v5-notes-chunks-and-engine-language
type: decision
status: accepted-for-v5-branch
last_updated: 2026-10-08
---

# ADR-0034 — v5: street chunks, field notes, warm-start cache, and why the engine stays TypeScript

## Decisions

1. **Street chunks (engine `v5.1`; `v5.2` fixes building centroids that drifted by metres — ids unchanged, caches rebuild).** A junction-to-junction segment longer than 60 m is cut into equal pieces
   `<segment>~<k>` (`CHUNK_METERS`). Tap marks the whole junction segment; painting and routes work per chunk, so a
   long street can be half done and a route can end mid-street. Ids stay deterministic; visibility is decided per
   junction segment (a service road with houses shows all its chunks). Cost: more features (≈ ×1.3 on the
   synthetic city) which feature-state painting absorbs (flat per change).
2. **Field notes replace "comments" in the field.** One note = optional quick flag (Hund, Kein Zutritt, Keine
   Werbung, Briefkasten voll, Nochmal kommen, Gefahr, Hinweis) + optional text ≤ 500 chars, attached to a street
   piece (`s:<junction>`), a house (`h:`) or an Area (`a:`). One tap on a flag is a note; tapping it again removes
   it. Notes are a second, small LWW table (`v5_notes`, migration 0027) synced by the same loop: identity = creation
   HLC, `rev` = last edit HLC, deletion = tombstone, key and Area immutable, author fixed at creation, scoped roles
   only reach their team's Areas. The legacy comment tables stay untouched (their targets are legacy snapshot ids
   that v5 does not have).
3. **Warm start cache.** The derived network per Area is kept in IndexedDB keyed by
   `(pack version, Area `updatedAt`, engine version)`. A cache hit skips pack download and derivation; any change in
   those three invalidates it. Measured at 39 k houses: cold 3.1 s → warm 0.8 s to ready. Boot timings are exposed on `window.__v5Boot` (and logged with `?debug`).
4. **Rust/WASM engine (decided by the product owner, 2026-10-08; supersedes the earlier "stay TypeScript" call).**
   The measurements that made TypeScript look sufficient are still true, so the port is judged on what it buys:
   - `engine-rs` (no wasm-bindgen, C ABI) ports `deriveNetwork` + `restrictToArea` line by line. The TypeScript engine stays
     as the reference and as the fallback when WebAssembly is unavailable; both must agree **exactly** (ids, parents,
     counts, every coordinate) on the synthetic cities and on 120 seeded random cities (all latitudes, unicode names, odd
     tags, address nodes straddling the snap radius); only `length`/`measure` (hypot/cos in different libms) are compared
     with 1e-9 tolerance. Four deliberate mutations of Rust constants were each caught.
   - Found by the differential test and fixed in **both** engines: parent choice between geometrically identical chunks
     depended on ulp noise (now: scores within 1 nm are ties, smaller id wins); output coordinates are rounded to OSM's
     1e-7° grid so both engines emit identical bytes.
   - Measured honestly (Node, 39 k houses, same bytes in, `Network` out): Rust compute is ≈ 4× faster than V8 natively, but in
     WebAssembly plus the 22 MB JSON hand-over (`TextDecoder` + `JSON.parse`) the end-to-end gain is **≈ 0–20 %**. The hand-over,
     not the algorithm, is the cost. Therefore the next step is not more compute in Rust but **not handing the geometry over
     at all**: Rust keeps the network and serves MapLibre vector tiles through a custom protocol (see Plan 046).
   - The committed `engine.wasm` is built by `scripts/build-wasm.sh`; a test fails when the Rust sources and the artifact's
     recorded digest drift apart. A future CSP needs `wasm-unsafe-eval`.

## Consequences

- Migration 0027 is additive and, like 0026, unapplied anywhere but the in-memory test database.
- Notes are not part of the status progress numbers; a note never changes a status.
- Cache entries are per device and safe to delete at any time.

## Not decided here

Abholaktion, Rooms (Übernehmen / Teilnehmen), temporary identities and the admin/login surface of v5: see
[Plan 045](../plans/active/045-v5-pickup-rooms-admin.md).
