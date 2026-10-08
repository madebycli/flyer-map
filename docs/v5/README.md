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

`npm test` (1056 tests incl. engine, store, API, legacy import), `npm run typecheck`, `npm run build`, and the
browser flow in `scripts/v5-e2e` (needs Playwright + Chromium): pack build → derive → mark house → undo →
server sync → fresh client sees state → route marking (5 segments, 16 houses) → viewer is read-only.
Measured in headless Chromium with software WebGL: 12.8 k houses, painting 5 000 statuses ≈ 21 ms, one change ≈ 1 ms;
engine derives 51 k houses in ≈ 0.54 s on a fast CPU.

## Not verified / not done

- Real phones (ADR-0030) and the live OpenFreeMap basemap (sandbox has no egress): only a blank-style fallback was exercised.
- Real Overpass data: the pack builder is tested with a stub and a synthetic city, not a real city extract.
- Area drawing, comments, activity, statistics, collection/pickup and admin screens still live in the legacy app;
  v5 reads the same Areas and access grants.
- No deploy, no remote migration (`0026` is additive and untested against a real D1).
- Pack rebuilds change derived ids only where OSM changed; statuses of vanished ids stay in D1 but are not shown.
