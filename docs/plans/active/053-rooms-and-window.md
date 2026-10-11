---
id: plan-053-rooms-and-window
type: plan
status: active
last_updated: 2026-10-11
related: [v5-readme, plan-045-v5-pickup-rooms-admin, plan-051-full-rewrite]
---

# Plan 053 — Räume (runs) for distribution Aktionen, the Aktion's time window, more Gruppe colours

## What the owner asked for

- A **time window** for the Aktion (start, end; nothing hard-coded), shown as a **countdown** in the statistics, the Übersicht and the menu. Distribution only; the Abhol side has no deadline.
- **Räume / runs** (Rooms of the old app, rebuilt): a Gruppe works in a Gebiet in stages. Somebody opens a room at the Gebiet and enters **by hand how many people take part** (slider and number field; mandatory; devices are never counted, a sixth phone does not make a sixth person). Others join with a link or QR code and work, as temporary members of the Gruppe, **only in that Gebiet**. A timer runs for the stage. After it, the record shows per run: how long, how many people, how many houses, how much of the Gebiet; per Gruppe and in total, for the feedback round and to size the next Gebiete.
- Who may join is a setting: link/QR (default), only the Gruppe, with a password, open to everybody (also other Gruppen).
- **More Gruppe colours**: with 15 to 20 Gruppen eight colours are too few.

## Design (built)

- **Migrations (additive)**: `0028_v5_window.sql` (`campaigns.window_starts_at/ends_at`), `0029_v5_rooms.sql` (`v5_rooms`, `v5_room_guests`, `campaign_access_grants.room_id`). Names of the Gebiet and the Gruppe are copied into the room row so the record outlives them. **They have to be applied before the code that uses them is deployed**; only the sign-in path (`resolvePersistentAccess`) falls back to the old query when `v5_rooms` is missing, so nobody is locked out in between.
- **Worker** (`worker/v5/rooms.ts`, routed in `worker/v5/api.ts`): `PUT /window` (admin), `GET/POST /rooms`, `PATCH/DELETE /rooms/:id`, `POST /rooms/:id/finish`; public `GET /rooms/:id?j=` and `POST /rooms/:id/join`. The window comes with `/meta`.
- **Joining** creates a team-editor grant of the room's Gruppe, bound to the room (`room_id`), with a session of 16 hours. Where the rights are decided (`canReadArea`, `canWriteArea`, `readableAreasClause`, `/meta`) a guest is bound to the room's Gebiet, and every other endpoint of the system treats the guest session as no session (`resolveAccess` needs `allowRoom`). The access ends with the room (finish or delete revokes the grants; a session of a finished room no longer resolves). Guests do not appear in the list of access links.
- **Modes**: `link` needs the secret from the link's fragment (never in a server log); `password` needs the password (PBKDF2, eight wrong tries lock the room for ten minutes); `team` lets nobody new in; `open` needs only the room id. A wrong link answers 404 and reveals nothing. Somebody already signed in is not logged out by accident: admins and members of the Gruppe get `409` and go on to the map.
- **Houses of a run** are the houses marked done in the Gebiet since the room opened (write counter at the start, `v5_state.seq`), live while it runs and frozen at the end; the number of houses of the Gebiet comes from the client (it derives them) and gives the percentage.
- **Client**: `roomsLogic.ts` (countdown, clock, run figures, per-Gruppe statistics, room links; pure and tested), `useRooms.ts` (polling, server clock), `roomsUi.tsx` (Runs sheet, room form, room, join page, chip next to the menu, countdown card). Menu → Runs; the chip shows the running clock.
- **Gruppe colours**: 32 (`groupColors.ts`), a free choice, a new Gruppe gets the first colour nobody uses.

## Not done / open

- The record has no export yet (CSV for the feedback round).
- A guest cannot rejoin after the 16-hour session ended while the room still runs (open the link again).
- Room rules are tested against the SQLite stand-in of D1 and the browser flows; not against a real D1.

## Acceptance

`tests/v5Rooms.test.ts` (window, opening, rights, guests and the Gebiet, ending, modes and lock, accidents, changes, deletion), `tests/v5RoomsLogic.test.ts`, `tests/v5GroupColors.test.ts`, `scripts/v5-e2e/flow22.mjs` (admin and guest in two browsers), the new sheets in `flow17` (44 px, names, rhythm, no overflow).
