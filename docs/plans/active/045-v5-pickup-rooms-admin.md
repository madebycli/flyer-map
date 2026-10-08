# Plan 045 — v5: Abholaktion, Rooms, identities, admin surface

Status: Phase A and B done (incl. Sonder-Marker), Phase C partly (street-aligned placement done) on `claude/v5-field-core`
Date: 2026-10-08
Reference (target behaviour, used as a reference not as a spec): `master-context/projects/flyer-map/plans/ABHOLMODUS_ZIELPLAN_2026-09-13.md`
Depends on: [Plan 043](043-v5-field-core.md), [ADR-0034](../../decisions/ADR-0034-v5-notes-chunks-and-engine-language.md)

## What already exists (legacy, reused — not rebuilt)

The legacy backend already models the Zielplan nouns, and it is exercised in production-shaped tests:

| Zielplan | Legacy table / endpoint |
|---|---|
| Abholaktion as its own action kind | action template mode `collection` (`NewActionWizard`), `collection_main_areas`, `collection_areas` |
| Abhol-Link without login, revocable | `collection_access_links` + `collection_collectors` + `collection_collector_sessions`, `POST /api/collection/access/redeem`, cookie `vf_collection_session` |
| Übernehmen | `collection_area_claims` (`claim`/`release`/`complete`/`force-release`/`archive`), `collection_areas.status` open→claimed→in-progress→completed |
| Teilnehmen / Arbeitsraum / Room | `collection_runs` + `collection_run_members` |
| Sonderaufgaben / Sonder-Marker | `collection_pickups` (open/collected/unavailable/needs-follow-up, assignments, capabilities) |
| Distribution teams / rooms | `teams`, `field_groups` (+ temporary memberships, room code / QR) |

So the work is **not** a new backend. It is: a v5 field surface that speaks to these, and the two seams where v5's
derived network meets them.

## Seams

1. **Areas of a collection Aktion live in `collection_areas`, not `areas`.** v5 needs a single "work area" notion.
   - `GET /api/v5/…/meta` returns `kind: 'distribution' | 'collection'` and, for collection, the `collection_areas`
     (id, name, geometry, status, claimedBy, runId) in the same `areas[]` shape plus `claim` info.
   - `v5_state`/`v5_notes` already store a plain `area_id`; `v5_pack_meta`/`v5_packs` have a foreign key to `areas`.
     Because 0026/0027 are unapplied, the FK is replaced by an application-level check (`canSeeArea` resolves
     the area in whichever table the campaign kind says) before the migrations ever reach a real D1.
2. **Access.** Collectors authenticate with their own cookie. `resolveAccess` for v5 additionally accepts
   `resolveCollectionAccess`; the role `collection-collector` may write status/notes **only inside Areas their Run
   has claimed** (server-checked, not UI-checked); it never reaches distribution Areas of the same campaign.

## Phases

### A — server (tests first)
- [x] `kind` in meta; `collection_areas` as work areas; one Area resolver for both kinds (`worker/v5/shared.ts`)
- [x] Collector access in `/api/v5/*`, writes limited to Areas of the helper's own active Run, per-area scoping for pulls and notes
- [x] Attack tests (`tests/v5Collection.test.ts`): foreign/unclaimed/archived/completed Areas, release/leave/close/revoke, key theft, packs, notes

### B — field UI (reusing the v5 shell)
- [x] Gebietsliste sheet (name, offen / wird bearbeitet / erledigt, % progress, claimed-by, Teilnehmen possible); finished areas greyed out and not claimable; tap an Area on the map opens the same detail
- [x] Übernehmen → creates the Run; Teilnehmen → joins it; Verlassen / Freigeben / Abbrechen as explicit actions; double tap/reload/offline never creates a second Run (idempotent request ids)
- [x] Room strip: active members and the shared progress (one number everywhere: list, detail, map, room)
- [ ] Sonder-Marker: `collection_pickups` as pins on the map and in the Area detail, never counted as street progress
- [x] Abholen labels for the same four statuses (offen · abgeholt · später · nicht verfügbar)

### C — identity and admin
- [ ] Temporary identity for link users (neutral label, per device) shown in notes, rooms and activity
- [ ] Location-derived preselection of the editable Area when starting to draw/edit (nearest Area under the user's position)
- [x] Street-aligned placement of Sonder-Marker (engine snaps to the nearest house ≤ 30 m, else street ≤ 22 m, and takes its address)
- [ ] Admin/login: keep legacy `/login` and organisation admin; v5 gets a role-aware entry (admin sees "Verwaltung", collectors never see admin links), no duplicate auth stack

## Acceptance

- Two devices claim/join the same Area concurrently → one Run, both see the same progress.
- A collector cannot read or write distribution data, nor Areas claimed by another Run.
- Reload, offline and double-tap never produce a second Run or a phantom "completed".
- An Area with partial progress never shows 100 %; "done" requires all relevant streets and tasks.

## Gates

Same as Plan 043: no deploy, no remote migration, `STREET_ENGINE_LIVE_READY=FALSE`.

## Notes on the implementation

- The UI never invents a rule: every Area carries a server-evaluated `writable`, the list is derived from `meta.runs`/`collection` only, and a failed action explains itself in plain words.
- Actions are the existing legacy mutations (`collection.run.start/claim-areas/start-area/join/leave/release-area/complete-area`); one user action = one mutation id, a lost response is recognised (`mutation_id_reused` = already applied).
- Legacy gap fixed: a helper who left a Room can now join it again (domain + repository), otherwise "Verlassen" locked people out for good.
- Browser flow `scripts/v5-e2e/flow7.mjs`: two helpers through the Abhol-Link, one Room, marking only inside the held Area, rejoin, finish greys the Area out.
