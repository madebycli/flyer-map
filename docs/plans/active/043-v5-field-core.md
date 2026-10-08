# Plan 043 — v5 field core (derive, don't materialise)

Status: ACTIVE on branch `claude/v5-field-core` (parallel to `beta`; nothing deployed)
Date: 2026-10-08
Decision record: [ADR-0033](../../decisions/ADR-0033-field-core-first-principles-rebuild.md) · Overview: [docs/v5/README.md](../../v5/README.md)

## Problem

The V3/V4 pipeline materialises every Street and House as a synced D1/RxDB row through Durable Object alarms.
Gebiet 8 (55,270 Streets / 46,665 Houses) repeatedly fails at the first Base bucket, and every sync event rebuilds
the whole Campaign snapshot. Smart Marking skipped side streets and marked forest paths.

## Approach

Streets/Houses are derived deterministically from a per-Area raw OSM pack on the client; only a status overlay
(`key → status`, last writer wins by hybrid logical clock) is stored and synced. See the README for layout.

## Phases

- [x] Engine: whitelist classification, junction noding, house assignment, routing (51 k houses ≈ 0.54 s)
- [x] Store: LWW overlay, outbox with immediate persistence, rollback of refused edits, sync client
- [x] Worker: `/api/v5` meta/state/ops/pack, migration 0026 (additive, unapplied), team scoping incl. key ownership
- [x] Map: geometry once, `setFeatureState` painting; `/v5` shell with route marking, undo, legacy import
- [x] Review pass: independent code review findings fixed (seq race, key ownership, stale packs, outbox safety)
- [ ] Real Overpass pack for a real Area (Gebiet 4 and Gebiet 8) and comparison of v5 vs V4 street/house counts
- [ ] Real-device acceptance per ADR-0030 (iPad + Android) incl. offline edit → reconnect convergence
- [ ] Apply migration 0026 on Beta D1; deploy the branch to Beta only after the two items above
- [ ] Decide what to do with Area drawing, comments, statistics, collection/pickup (still legacy-only)

## Gates

No Main/Production deploy, no Production D1 change. `STREET_ENGINE_LIVE_READY` stays FALSE until Gebiet 8 renders
from v5 on exact-commit Beta and a second client converges.
