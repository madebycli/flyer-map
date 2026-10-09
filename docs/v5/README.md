# v5 field map

The only field map (`/v5?campaign=<id>`); the old map address forwards to it with its access token ([ADR-0036](../decisions/ADR-0036-legacy-map-retired.md)).
Rationale and measurements: [ADR-0033](../decisions/ADR-0033-field-core-first-principles-rebuild.md).

## Idea: derive, don't materialise

Streets and houses are a pure function of OSM data. v5 therefore stores **no task rows**:

| Concern | v5 |
|---|---|
| Source data | one gzip JSON pack of raw OSM per Area (`v5_packs`, built by the Worker from Overpass) |
| Streets/houses | `deriveNetwork(raw)` in `src/v5/engine`, deterministic, runs in a Web Worker on the client |
| Ids | `s<way>:<startNode>` for segments, `h<buildingWay>` / `a<node>` for houses (stable across clients) |
| User state | status overlay `key → status`, last-writer-wins by hybrid logical clock |
| Sync | `GET /api/v5/campaigns/:id/state?since=` and `POST …/ops` (idempotent, team-scoped) |
| Rendering | the engine (Rust, in a Worker) serves MapLibre vector tiles (`v5t://`); status via `setFeatureState` on the tile features |

## Layout

- `engine-rs` – the engine in Rust (C ABI WASM): derive, restrictToArea, vector-tile cutter, snapping, Area snapshots. `src/v5/engine/wasm/engine.wasm` is the committed build (`scripts/build-wasm.sh`; a test checks the source digest). The TypeScript engine below is the reference and the fallback.
- `src/v5/engine` – whitelist road classification, junction noding, house→street assignment, routing,
  Overpass normalisation, area restriction, legacy-progress import, synthetic test city.
- `src/v5/notes` – field notes: flags + text per street/house/Area, own LWW store and sync round (rides the status `SyncClient`).
- `src/v5/store` – HLC, `FieldStore` (changed-keys listeners, outbox), `SyncClient`, `Progress`, IndexedDB persistence.
- `src/v5/map` – `FieldMap` (MapLibre 5.7.1, feature-state painting, route preview, basemap-outage fallback).
- `src/v5/app` – React shell (`App.tsx`), derivation worker, API client, Vela-style CSS.
- `worker/v5/api.ts` + `migrations/0026_v5_field_state.sql` – meta, state, ops, pack endpoints; `worker/v5/notes.ts` + `0027_v5_notes.sql` – notes endpoints.
- `scripts/v5-e2e` – fixture server (real handlers, in-memory D1) and Playwright flow.

## Design

Dark first (the default, independent of the OS setting; light is one tap away and remembered). Material 3 Expressive
ideas, built with plain CSS and an own inline icon set (no webfont, no icon font, no network): tonal surfaces,
squircle shapes that morph on press, a wavy progress indicator, a morphing-shape loader, a floating icon toolbar,
and a status group of four icon buttons where the selected one grows and shows its label. Zoomed out, houses are
status-coloured dots so a whole city reads as progress; houses appear as shapes from zoom 15.2.
Screens: `docs/v5/screens/` (retake with `scripts/v5-e2e/shots.mjs`).

## Behaviour decisions

- Roads: **whitelist**. `residential`, `living_street`, `unclassified`, `tertiary…primary`, `pedestrian` are streets;
  `service` is an access road that becomes visible only when houses are assigned to it; `footway/path/steps`
  are hidden connectors promoted only with assigned houses; tracks, sidewalks, crossings, driveways, unpaved
  paths, restricted access, unknown values are excluded.
- Buildings: never excluded because of `shop`/`office`/`name`. Garages, sheds, carports etc. are dropped even
  with an address node; unaddressed buildings are kept only with a residential `building=` value.
- A status written offline is kept in the outbox and sent later; permanently rejected edits (forbidden area,
  clock far in the future) leave the outbox.
- Team editors only see/write state of their team's Areas (server-enforced via the op's `area`).

## Verified

- `npm test` (446 tests on the integration branch, incl. engine incl. chunks, store, notes, cache, API incl. attack/race cases, legacy import), `npm run typecheck`, `npm run build`; clean-up/sync release gate (positive properties, from the independent review): `node --experimental-transform-types scripts/v5-e2e/review-fixes.mjs` (exit 1 = a required property fails).
- Mobile clarity (B, reviewed by A at `3289a33`): affected flows 9/14/15 green; [evidence](screens/mobile-clarity-2026-10-09/README.md): two sheets × eight configurations, real handlers, 16 screenshots.
- An independent code review (`/code-review`, high) found 10 issues; all fixed (see git log "address independent review findings").
- Browser flows in `scripts/v5-e2e` (real Worker handlers on in-memory D1; Playwright + Chromium):
  `flow.mjs` – pack build → derive → mark → undo → sync → fresh client → route marking → read-only viewer;
  `flow2.mjs` – legacy-progress import, offline outbox (API blocked: edit persisted to IndexedDB at once, delivered
  after reconnect), team editor sees only its Area. All checks pass at 1.2 k and at 39 k houses
  (`CITY_BLOCKS=70`): first boot incl. pack build + derive 5.0 s, later boots 1.9 s in headless Chromium with software WebGL.
- Measured: 12.8 k houses, painting 5 000 statuses ≈ 21 ms, one change ≈ 1 ms; engine derives 51 k houses in ≈ 0.54 s.

- Flows 3–6 (`flow3` tools + Area editor, `flow4` two writers overwrite one street → both told, nothing reset, `flow5`
  notes between two people incl. offline and a read-only viewer, `flow6` warm start without any pack request).
  `node scripts/v5-e2e/run-all.mjs` runs all six against fresh fixture servers.

## Tools, notes, cache (see ADR-0034)

- Street pieces are ≤ 60 m chunks. Tap = whole junction segment, paint/route = chunks. Marking modes: route (default), tap,
  paint, lasso. Route: tap points → ✓ → pick the status; the other modes apply the brush at once. "Nur Straßen mit Häusern"
  skips and hides streets without a house. Undo for the last gesture. UI: [Plan 047](../plans/active/047-v5-field-ui-v2.md).
- Notes: seven quick flags (toggle) or text, or both; one marker per annotated place; overview from the Menü;
  viewers read, writers write, scoped roles only in their team's Areas.
- Warm start: derived network per Area cached in IndexedDB by pack version, Area `updatedAt` and engine version;
  `window.__v5Boot` shows `meta / packs / derive / ready` milliseconds. Measured with 39 k houses in headless Chromium
  (software WebGL): cold boot 3.1 s (derive 2.7 s) → warm boot 0.8 s (cache read 0.33 s, derive 0).

## Surfaces in the menu (Menü)

Übersicht (progress by houses, per Gebiet and Gruppe, sync state) · Team & Aktivität (who brought in how many houses, derived from the overlay) · Suche · Gebiete (draw/edit, rename, move to a Gruppe, delete) ·
Gruppen (create/rename/recolour/delete, Aktion name) · Zugänge (links for a Gruppe, viewers and Abhol-Helfer with QR, withdraw, helper rights) · Notizen · Vorlage laden / Als Vorlage · Abholen: Einrichten (Sammelgebiet, Teilgebiete, free, archive) ·
Sonder-Marker · Hell/Dunkel, Links-/Rechtshand, Karte an/aus. A link helper sees only what the server lets them do. Design system: `src/ui` (tokens, components, page kit), organiser pages: `src/organization`.

On a selected Gebiet, **Veraltete Einträge bereinigen** clears obsolete progress while preserving the Gebiet and its current progress; **Gebiet löschen** removes the whole Gebiet and its associated data. Both ask for confirmation. After clearing the last obsolete entry, the clean-up control refreshes immediately. In Zugänge, each helper-right switch has a visible caption (Sehen, Anlegen, Bearbeiten, Zuweisen), an accessible name and a pressed state; policy is enforced on the server. The Zuweisen caption describes the existing permission, not a new assignment interface.

## Not verified / not done

- Real phones (ADR-0030), the live basemap (sandbox has no egress; style URLs come from `V5_BASEMAP_DARK`/`V5_BASEMAP_LIGHT`) and real Overpass data: only stubs and a synthetic city were exercised.
- No deploy, no remote migration (`0026` and `0027` are additive and untested against a real D1).
- Reloading the page without network does not work (no service worker by ADR-0006); only a page that is already open keeps working offline.
- Key ownership is bound to the first Area that writes a key; the server cannot yet verify that a key geometrically lies inside the claimed Area.
- Pack rebuilds change derived ids only where OSM changed; statuses of vanished ids stay in D1 but are not shown. An admin clears them per Gebiet with "bereinigen" (`POST …/areas/:id/prune`); deleting a Gebiet clears everything of it (`…/forget`). Clearing never deletes a synced row: it writes a tombstone (status `open` / note `deleted`, under a newer id, with a new sequence number inside the same atomic batch) so devices that already pulled the old status receive the clear through the normal pull; only the map data of a forgotten Gebiet is deleted for good. `forget` checks inside its batch that the Gebiet is still gone.
- Dropped on purpose (Plan 051): Rooms, English UI, manual street creation, assigning Sonder-Marker.
