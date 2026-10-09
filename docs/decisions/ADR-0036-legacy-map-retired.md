---
id: adr-0036-legacy-map-retired
type: decision
status: accepted-for-v5-branch
last_updated: 2026-10-09
supersedes: [ADR-0024, ADR-0025, ADR-0032]
---

# ADR-0036 — The legacy map is retired; the v5 field map is the only map

## Context

[ADR-0033](ADR-0033-field-core-first-principles-rebuild.md) measured the old map (materialised street/house tasks, RxDB sync, V3/V4 street engine) and proposed the v5 field core; [Plan 051](../plans/active/051-full-rewrite.md)
inventoried every function of the old app and decided keep / rebuild / drop for each.

## Decision

1. **`/v5` is the only field map.** The old map address (`/?campaign=…`) forwards to it with its access token; the old React app, its CSS and its client-side data layer are deleted.
2. **Retired with it, and superseding the ADRs that introduced them:** RxDB local-first sync and its change feed (ADR-0024), the Durable-Object invalidation socket (ADR-0025), the central client sync coordinator (ADR-0032),
   the V3/V4 street engines and Smart Street/House tasks (their plans are archived), Rooms/live groups, comments, statistics, automations, field sessions, offline map areas, English UI.
   Their *replacements* are: derive-don't-materialise + status overlay (ADR-0033), notes (ADR-0034), Team & Aktivität derived from the overlay, Abhol-Räume of the collection side.
3. **The Worker keeps exactly:** organisation identity and security (ADR-0026 and its hardening), access links and sessions, the collection backend (areas, runs, collectors, pickups), the lean mutation path
   (Aktion name, Gruppen, Gebiete, collection, Sonder-Marker — task/house/default-view mutations answer `mutation_invalid`), the read-only legacy snapshot used once for the progress import, and `worker/v5`.
4. **Data stays.** No migration is removed and no table is dropped; the legacy tables remain readable. The Durable Object class `CampaignSyncDurableObject` is kept as an empty stub because the deployed
   migration history names it; deleting the class needs a `deleted_classes` migration that destroys its storage and therefore an explicit go.
5. **Not rebuilt on purpose** (the owner may reverse any): Rooms, English, manual street creation, assigning Sonder-Marker to Räume/Helfer.

## Consequences

- One design system (`src/ui`) and one shell; ≈ 56 k lines of source and 45 k lines of tests/CSS gone (79 k → 23 k lines of source).
- Old links keep working; people on an old open tab must reload.
- Rollback is a redeploy of the previous Worker version; the data was never migrated away.
