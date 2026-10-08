---
id: adr-0034-v5-notes-chunks-and-engine-language
type: decision
status: accepted-for-v5-branch
last_updated: 2026-10-08
---

# ADR-0034 — v5: street chunks, field notes, warm-start cache, and why the engine stays TypeScript

## Decisions

1. **Street chunks (engine `v5.1`).** A junction-to-junction segment longer than 60 m is cut into equal pieces
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
4. **The engine stays TypeScript; no Rust/WASM port now.** Reasons, all measured or structural:
   - Derivation of 51 k houses takes ≈ 0.54 s in V8 (docs/v5/README.md) and already runs off the main thread in a
     Web Worker; the cache removes it from every warm start. It is not the bottleneck.
   - Map updates are flat per change (`setFeatureState`, ADR-0033); the remaining render cost is MapLibre's own
     worker/GPU work, which a Rust engine would not change.
   - A second implementation must reproduce every id bit-for-bit (stable keys are the sync contract) and would
     double the surface of the adversarial test suite. The same TypeScript module currently runs on the device,
     in the Worker (pack building) and in the Node tests, which is a correctness feature.
   - **Revisit when** a real mid-range Android measures derivation of the largest Area (Gebiet 8, ~47 k houses) above
     ≈ 2 s, or the Worker cannot build a pack inside its CPU limit. Then port `derive`/`route` first, keep ids
     byte-identical, and gate with a differential test against the TypeScript reference over seeded cities.

## Consequences

- Migration 0027 is additive and, like 0026, unapplied anywhere but the in-memory test database.
- Notes are not part of the status progress numbers; a note never changes a status.
- Cache entries are per device and safe to delete at any time.

## Not decided here

Abholaktion, Rooms (Übernehmen / Teilnehmen), temporary identities and the admin/login surface of v5: see
[Plan 045](../plans/active/045-v5-pickup-rooms-admin.md).
