# v5 field core (parallel to beta)

Branch `claude/v5-field-core`, cut from `beta`. Ships as a second page at `/v5?campaign=<id>`
next to the existing app; the legacy app, auth, organisations and admin are untouched.
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

- `npm test` (1108 tests incl. engine incl. chunks, store, notes, cache, API incl. attack/race cases, legacy import), `npm run typecheck`, `npm run build`.
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

- Street pieces are ≤ 60 m chunks. Tap = whole junction segment, paint/route = chunks. Marking modes: tap, paint,
  lasso, route; a brush status applies to everything until changed; undo for the last gesture.
- Notes: seven quick flags (toggle) or text, or both; one marker per annotated place; overview from "Mehr";
  viewers read, writers write, scoped roles only in their team's Areas.
- Warm start: derived network per Area cached in IndexedDB by pack version, Area `updatedAt` and engine version;
  `window.__v5Boot` shows `meta / packs / derive / ready` milliseconds. Measured with 39 k houses in headless Chromium
  (software WebGL): cold boot 3.1 s (derive 2.7 s) → warm boot 0.8 s (cache read 0.33 s, derive 0).

## Not verified / not done

- Real phones (ADR-0030) and the live OpenFreeMap basemap (sandbox has no egress): only a blank-style fallback was exercised.
- Real Overpass data: the pack builder is tested with a stub and a synthetic city, not a real city extract.
- Activity, statistics, collection/pickup (Plan 045) and admin screens still live in the legacy app;
  v5 reads the same Areas and access grants. Area drawing/editing and notes are in v5.
- No deploy, no remote migration (`0026` and `0027` are additive and untested against a real D1).
- Reloading the page without network does not work (no service worker by ADR-0006); only a page that is already open keeps working offline.
- Key ownership is bound to the first Area that writes a key; the server cannot yet verify that a key geometrically lies inside the claimed Area (it would need the derived key set per Area).
- Pack rebuilds change derived ids only where OSM changed; statuses of vanished ids stay in D1 but are not shown.
