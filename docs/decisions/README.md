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
