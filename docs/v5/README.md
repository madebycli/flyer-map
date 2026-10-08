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
| Rendering | geometry loaded once; status via `setFeatureState` (no re-tiling) |

## Layout

- `src/v5/engine` – whitelist road classification, junction noding, house→street assignment, routing,
  Overpass normalisation, area restriction, legacy-progress import, synthetic test city.
- `src/v5/store` – HLC, `FieldStore` (changed-keys listeners, outbox), `SyncClient`, `Progress`, IndexedDB persistence.
- `src/v5/map` – `FieldMap` (MapLibre 5.7.1, feature-state painting, route preview, basemap-outage fallback).
- `src/v5/app` – React shell (`App.tsx`), derivation worker, API client, Vela-style CSS.
- `worker/v5/api.ts` + `migrations/0026_v5_field_state.sql` – meta, state, ops, pack endpoints.
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

- `npm test` (1068 tests incl. engine, store, API incl. attack/race cases, legacy import), `npm run typecheck`, `npm run build`.
- An independent code review (`/code-review`, high) found 10 issues; all fixed (see git log "address independent review findings").
- Browser flows in `scripts/v5-e2e` (real Worker handlers on in-memory D1; Playwright + Chromium):
  `flow.mjs` – pack build → derive → mark → undo → sync → fresh client → route marking → read-only viewer;
  `flow2.mjs` – legacy-progress import, offline outbox (API blocked: edit persisted to IndexedDB at once, delivered
  after reconnect), team editor sees only its Area. All checks pass at 1.2 k and at 39 k houses
  (`CITY_BLOCKS=70`): first boot incl. pack build + derive 5.0 s, later boots 1.9 s in headless Chromium with software WebGL.
- Measured: 12.8 k houses, painting 5 000 statuses ≈ 21 ms, one change ≈ 1 ms; engine derives 51 k houses in ≈ 0.54 s.

## Not verified / not done

- Real phones (ADR-0030) and the live OpenFreeMap basemap (sandbox has no egress): only a blank-style fallback was exercised.
- Real Overpass data: the pack builder is tested with a stub and a synthetic city, not a real city extract.
- Area drawing, comments, activity, statistics, collection/pickup and admin screens still live in the legacy app;
  v5 reads the same Areas and access grants.
- No deploy, no remote migration (`0026` is additive and untested against a real D1).
- Reloading the page without network does not work (no service worker by ADR-0006); only a page that is already open keeps working offline.
- Key ownership is bound to the first Area that writes a key; the server cannot yet verify that a key geometrically lies inside the claimed Area (it would need the derived key set per Area).
- Pack rebuilds change derived ids only where OSM changed; statuses of vanished ids stay in D1 but are not shown.
