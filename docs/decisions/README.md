# Architecture Decision Records

ADRs preserve decisions that would otherwise be lost across chats or future refactors.

Statuses:
- proposed
- accepted
- superseded
- rejected

Do not delete accepted historical decisions. Supersede them with a newer ADR when direction changes.

Current accepted decisions relevant to active work include:
- `ADR-0012-prepared-offline-map-data.md`: M5.5 uses a bounded raw OSM subset package through the existing Worker, normalized to a versioned JSON/GeoJSON package and stored in browser IndexedDB.
- `ADR-0021-server-prepared-automatic-area-work.md`: a saved Distribution Area can atomically publish normal Street/House Tasks from bounded server-side OSM preparation; devices do not generate automatic work.
- `ADR-0020-collection-access-areas-runs.md`: First-Class Collection Access, Main/Child Areas and Runs use additive D1 persistence, Collection-only temporary access and the existing M5/MapLibre boundaries.
