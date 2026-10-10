# Plan 051 — Full rewrite: one design, one shell, compute in Rust

Status: measured and planned; nothing deleted yet. Decisions needed are at the end.
Reference: [Plan 047](047-v5-field-ui-v2.md) (design system and shell), [Plan 046](046-v5-rust-tiles.md) (engine in Rust), Plan 031 (dormant features).

## What is there (measured 2026-10-09, `node scripts/reachability.mjs`)

| Area | Lines | Notes |
|---|---|---|
| `src` (UI + domain + data) | 51 203 in 288 files | `src/v5` is 6 135 of it; the rest is the legacy app |
| `worker` | 27 356 in 93 files | one Worker for everything; v5 handlers are `worker/v5` (≈ 800) |
| `engine-rs` | 1 858 in 11 files | derive, tiles, route, lasso, search |
| CSS | 12 035 in 65 files | the legacy look (`styles.css`, `m4.css`, `ui-dark-mode*.css`, one file per hub) |
| tests | 33 250 in 231 files | they are the specification of the legacy behaviour |

**Reachability** from `index.html`, `v5.html` and `worker/indexOrganizer.ts`: 71 400 of 78 940 lines are live. 43 files / ≈ 7 500 lines are not
imported by any entry point. Removing them was tried and **reverted**: 23 tests fail, because the plans keep them on purpose —
Activity, Automationen, Einsatz-Verlauf, Statistik, Team-Center ("implemented but not promoted", Plan 031), Smart House/Street tasks and the
v3/v4 street-engine remnants. "Unreachable" is therefore a list of *dormant product decisions*, not of garbage.

## Principles

1. **Replace, don't polish.** A legacy surface is rewritten in the v5 shell with the shared design system; its old code, CSS and tests are deleted in the same
   change, once the replacement passes an equivalent test. No parallel copies are left behind.
2. **Compute in Rust, glue in TypeScript.** Anything that is geometry, graph, search, validation or encoding moves into `engine-rs` with a TypeScript
   reference and differential tests (as done for route, lasso, search). UI stays TypeScript. The Worker moves to Rust only where that keeps the exact
   contract (see phase 4).
3. **The old tests are the spec.** Every phase starts by listing the behaviours its old tests assert and ends with the same assertions on the new code.
4. **Nothing goes live from here.** Each phase ends on staging (`flyer-map-staging`), production switches only on an explicit go.

## Phases

| # | What | Size | Rust? | Risk |
|---|---|---|---|---|
| 1 | **Design system as a package** (`src/ui`: tokens, `Sheet`, `Tile`, buttons, lists, forms) extracted from `src/v5`; `v5.css` becomes tokens + components | ≈ 1 000 lines | no | low |
| 2 | **Dormant features rebuilt** in the shell: Statistik, Aktivität, Einsatz-Verlauf, Automationen, Team-Center (≈ 3 300 lines of UI + 4 800 CSS today) | ≈ 1 500 new lines | stats/aggregation in Rust | medium |
| 3 | **Legacy map app** (`App.tsx` 2 095, `MapView.tsx` 2 699, collection view 917, comments, offline map, smart street/house) replaced by `/v5` | the big one | engine already Rust | high: it is what runs in production |
| 4 | **Worker**: v5 handlers (pack, state, notes, prune, meta) to Rust (`workers-rs`), same endpoints and tests; then mutations/sync; **auth last** (KDF, TOTP, trusted devices need their own security review) | ≈ 27 000 lines | yes | high |
| 5 | **Delete the legacy app**, its CSS (12 k lines) and the tests that only described it | − 45 000 lines | — | after go-live |

## Decisions (2026-10-09, taken by the technical owner on the user's instruction "Überdenke alle Funktionen … full rewrite")

1. **Dormant features are rebuilt, not deleted** — in the v5 shell and the shared design system, one at a time, each behind its existing Worker contract.
2. **Worker stays TypeScript** — superseded the earlier `workers-rs` idea after measuring ([ADR-0035](../../decisions/ADR-0035-worker-stays-typescript.md)): the heaviest Worker task (pack build, 39 k houses) is 0.5 s CPU, dominated by native `JSON.parse` and gzip.
3. **One switch**: all work lands on one long-lived branch in always-green stages; `/v5` replaces the legacy map app only on an explicit go after staging.

## Function inventory — keep / rebuild / move to Rust / drop

| Function (today) | Where | Decision | Why |
|---|---|---|---|
| Karte, Status setzen, Smart Marking, Lasso, Routing, Suche | `src/v5`, `engine-rs` | **keep** (done, Rust) | already the new core |
| Notizen, Gebiete zeichnen, Aktions-Vorlage, Abholmodus, Raum | `src/v5` | **keep** | done in the shell |
| Fortschritt / Statistik (Team, Gebiet, Zeitraum) | `StatisticsHub`, `worker/statistics.ts` | **rebuild** in shell; aggregation **Rust** | pure function of the status overlay; no D1 rows needed |
| Aktivität (wer hat was wann) | `ActivityHub`, `worker/activity.ts`, `domainEventHistory` | **rebuild**; reads ops log of v5 | v5 ops already carry author + HLC |
| Einsatz-Verlauf / Field Sessions | `FieldSessions*`, `worker/fieldSession*` | **rebuild** (one list + one detail sheet) | merge History/Draft/Note/Tasks into one concept: "Einsatz" |
| Kommentare | `CommentsHub/Panel/ContextPanel` | **drop as separate feature, merged into Notizen** | v5 notes already do flags + text per place; comments were the same idea |
| Automationen | `AutomationHub`, `worker/automation*` | **rebuild small**: rules list + toggle; runtime stays TS until Worker phase | low use, keep contract |
| Team-Center / Teams, Gruppen, Mitglieder, Beitritt, Credential-Recovery | `src/team`, `worker/fieldGroup*` | **rebuild** (Team sheet in shell) | needed for Aktionen; recovery flow security-reviewed |
| Räume (Rooms) | `RoomsHub` | **drop** — replaced by v5 Raum (Abholmodus) | duplicate |
| Smart House / Smart Street tasks, v3/v4 street engine | `src/domain/*street*`, `worker/streetNetwork` (4 336 lines) | **drop after cut-over** | v5 derives instead of materialising; D1 task tables stay readable for the import tool only |
| Legacy-Karte `App.tsx` / `MapView.tsx` / Collection view / Offline map | `src` | **replace** by `/v5` (+ offline = warm cache) | phase 3 |
| Organizer / Admin: Aktionen anlegen, löschen, vergleichen, Analytics-Export, Einladungen, öffentliche Links, Sicherheit (MFA, trusted devices) | `src/admin`, `src/organization`, `worker/organization*` | **rebuild UI** in shell (Admin area of `/v5`); **auth stays TS until last** | security review before porting KDF/TOTP |
| Workbench previews, Funny-Focus-Video, M6/M5 previews | `src/workbench`, `src/platform/FunnyFocusVideo` | **drop** | demo/preview surfaces, not product |
| Diagnostics, Support, Live | `src/diagnostics`, `src/support`, `src/live` | **rebuilt as one "Diagnose" panel** (`?diag=1`, menu tile): engine, sync, network, map, log, report, plus server request lines — [docs/v5/DIAGNOSTICS.md](../../v5/DIAGNOSTICS.md) | more precise than the old `?diag=1`; no telemetry upload |
| RxDB sync, change feed, sync heads, mutation pipeline | `worker/rxdb*`, `mutation*`, `syncHeads`, `campaignSyncDurableObject` | **keep until cut-over**, then **drop** | v5 has own LWW sync (`/api/v5/.../ops`) |
| CSS: 12 k lines in 65 files | `src/*.css` | **drop with their screens** | replaced by `src/ui` tokens + components |

Net effect: ≈ 45 000 of 79 000 lines disappear at the end; ≈ 5 000 new lines (UI) and the Rust Worker core replace them.

## Phase status

- **Solo mode, UI audit (A, 2026-10-10):** the owner asked A to continue alone. A-6, A-7 (MapLibre 6.13), B's unpushed mobile P3 (rebuilt) and A-8 merged after B's reviews plus an independent review agent. New flow 17 audits every sheet (390/430 × dark/light): it found the Gruppen sheet scrolling sideways (a grid cell without `min-width: 0`), 38 px colour and group buttons in four sheets, a handle gap a grid cannot express with a negative margin, the status caption „Nicht möglich“ cut off at 390 px and note-flag icons at 1.4–2.9 : 1 on light surfaces; all fixed. The organiser pages got the same bar in flow 11 (every page: ≥ 44 px, no English leftovers, no cut-off captions): they showed „Organization“, raw lifecycle values (`DRAFT`, `active` …), „Campaign-ID“, „2FA in Unstable“ and a navigation that scrolled entries out of sight on phones; all German now, navigation wraps. One spacing rhythm for sheets (`--sp-1/--sp-2`, `gap` only).

- **Diagnostics and logs (A, 2026-10-10):** `src/v5/diag` (bounded log rings, counters/gauges/histograms, probes, redaction, report `v5-diag-1`, plain-German findings), `src/v5/app/diagSheet.tsx` (panel, readout), instrumentation of net, engine, boot, sync, store, notes, cache and map; Worker: request id, `Server-Timing` (total, database), JSON request lines at `V5_LOG_LEVEL` (default `warn`). Found and fixed on the way: the feature-state reset on the vector tile source named no source layer (MapLibre error, nothing removed). 464 tests, flow 16. Not verified: real devices, real server logs. See [DIAGNOSTICS.md](../../v5/DIAGNOSTICS.md).

- **Dual review, mobile clarity (B, 2026-10-09):** distinguish obsolete-progress clean-up from deleting a Gebiet with a visible caption; refresh the clean-up control after the last obsolete key is forgotten; label each helper-right switch using existing design-system components. Acceptance: real-handler browser checks, 390/430 px × dark/light × left/right screenshot matrix, no horizontal overflow, touch targets ≥44 px, and independent A review. This covers two affected sheets; the full-sheet audit, real devices and release gates remain open.

- **Phase 1 (design system package)**: `src/ui` = `tokens.css`, `components.css`, `icons.tsx`, `progress.tsx`, `index.ts`; the v5 shell imports it, `v5.css` keeps only shell layout (203 lines, was 338). Typecheck, build, 1 178 unit tests and flows 3/9/10 green.
- **Phase 2 (dormant features)**, slice 1 — *Statistik + Aktivität merged into "Team & Aktivität"* (`activity.ts`, `activitySheet.tsx`): who brought in how many houses today / 7 days / total and the latest changes,
  derived from the status overlay (every entry carries author and HLC wall time). No server change. Decision: this aggregation stays in TypeScript — the overlay lives in JS memory and the loop is one pass over a Map,
  so a Rust port would only add marshalling (the plan's "stats in Rust" is dropped for this part; geometry stays in Rust). Tests `v5Activity` + flow 9.
- **Phase 2, slice 2 — Organizer UI** (sign-in with second factor, Aktionen, new Aktion, security centre, invitations, invite/reset pages) rebuilt on the page kit `src/ui/kit.*`:
  logic unchanged, markup new. `src/main.tsx` is now a router with two chunks (`organization/main.tsx` with the design system only, `legacyMain.tsx` with the old map and its CSS), so the
  organiser pages no longer load any map CSS. Merged duplicates: the invitation form lived twice (Security Center and Invite Center) — now only on `/admin/invites`; the nav-injection hack
  (`OrganizationAdminNavEnhancer`) is gone because one `AdminBar` serves every page. The focus picker no longer hard-codes the OSM tile server: it uses the deployment basemap via the new
  public `GET /api/v5/basemap` (same URLs every field client already receives) and falls back to a plain background. 470 lines of org CSS deleted. Tests: `organizationAdminUi` rewritten
  as behaviour assertions, `v5Api` (basemap endpoint), flow 11 (browser, API mocked at the network edge).
  Open in phase 2: Einsätze, Automationen, Team-Center/Gruppen (need Worker contracts), admin panels still inside the legacy map app (`src/admin`).
- **Phase 2, slice 3 — links and access** (`link.ts`, `accessApi.ts`, `accessSheet.tsx`): the field map redeems `#access=` and `#collection=` links itself (token → session cookie → removed from the
  address bar; revoked/made-up → "Link ungültig", server trouble → "Keine Verbindung", the link stays valid), the old map address `/?campaign=…` now opens `/v5` with the same token
  (`?legacy=1` keeps the old app reachable until it is deleted), and admins create/revoke Gruppen-, Ansehen- and Abhol-Links with QR code in the menu tile "Zugänge". Tests `v5Link`, flow 12.

## Parity audit (what a person can do in the old map vs. now)

The old launcher offers exactly: **Team, Rooms, Fortschritt, Kommentare, Streets, Gebiet, Einstellungen** (`buildPlatformLauncherItems`). Everything else in `src` that is not reachable from there was dead
(Plan 031 "implemented but not promoted": Activity, Automationen, Einsatz-Verlauf, Team-Center). **Correction to the decision above:** rebuilding unreachable features is new product work, not parity, so
Einsätze, Automationen and the Team-Center are **not** rebuilt; they are deleted in phase 5 with their tests unless the product owner asks for one of them.

| Old launcher entry | Now in the field map | Decision |
|---|---|---|
| Fortschritt | Übersicht (houses, per Gebiet, per Gruppe) + Team & Aktivität | done |
| Kommentare | Notizen (flags + text per street, house, Gebiet) | done, replaces comments |
| Gebiet (draw/edit) | Gebiete tool, polygon editor, Aktions-Vorlage | done |
| Streets (list, manual street) | search + derived streets | list replaced by search; manual street for roads missing in OSM: not rebuilt (decision 5) |
| Einstellungen: appearance, hand | Menü: Hell/Dunkel, Links-/Rechtshand | done |
| Einstellungen: access links (Gruppe/Ansehen/Admin), Abhol-Links, helpers | Menü → Zugänge | done (Admin links are replaced by Organizer accounts) |
| Gebiet löschen | on a selected Gebiet (admin): deletes it and everything v5 kept for it | done (flow 13, `POST …/areas/:id/forget`) |
| Einstellungen: Gruppen rename/recolour, Gebiet → Gruppe, Aktion rename | Menü → Gruppen (create, rename, recolour, delete when empty, Aktion rename); on a selected Gebiet: rename and move to another Gruppe | done (flow 13) |
| Einstellungen: language (en) | German only | dropped (decision 5) |
| Team (hub, active team) | Gruppe is implied by the link; admins see all Gruppen | done |
| Rooms (live groups with join code/QR, leave, members) | none (collection has its own Raum) | not rebuilt (decision 5) |
| Abholen einrichten: Sammelgebiet + Teilgebiete zeichnen/bearbeiten/archivieren, Admin-Freigabe, Helfer-Rechte je Gerät (old `CollectionAdminPanel`) | Menü → Einrichten (Abhol-Ansicht), Zugänge → Geräte | done (flow 14; found and fixed a server bug: `collection.area.update` bound no colour, so the update matched no row — regression test `collectionMutationBinds`) |
| Sonder-Marker zuweisen (an Raum/Helfer) | right can be granted, no assignment UI | **open** (small) |
| Offline map area, street edit after mission, smart house/street tasks | warm cache + derived network | replaced |

## Order from here
1. ~~"Gruppen" sheet~~ done.
2. Decide Rooms / English / manual street with the product owner (they change what is built).
3. Phase 3 checklist for staging: redirect of the old address (done), service worker/offline unchanged, soak at 39 k houses, real-device pass.
4. ~~Phase 4 (Worker in Rust)~~ dropped by ADR-0035. Phase 4 is now: delete what the Worker no longer needs.
5. Product decisions taken by the technical owner (the owner may reverse any of them): **Rooms** (live groups with codes) are not rebuilt — Gruppen links plus Team & Aktivität cover the use, collection keeps its own Raum;
   **English** is dropped (German only); the **manual street** is not rebuilt (a road missing in OSM is fixed in OSM and the Gebiet's data reloaded).
- **Phase 5 (delete the legacy app) is done on its own branch `claude/rewrite-phase5-delete-legacy`**, so that it can be dropped without touching the rest (the feature branch `claude/v5-field-core-clean` still carries the old map behind `?legacy=1`):
  client (198 files, 39 k lines) and 100+ tests that only described it deleted; Worker reduced to identity, access, collection, pickups, `worker/v5` and a lean mutation path (`authorization.ts`, `mutationHandler.ts`, `mutationRepository.ts` rewritten;
  task/house/default-view mutations are refused); rooms, comments, activity, statistics, automations, RxDB (sync, change feed, checkpoints), network intents, area preparation, street engine, offline map, field sessions removed;
  `CampaignSyncDurableObject` is an empty stub; scripts, docs of the old map archived (`docs/archive/legacy-map`), `context-map.yaml` regenerated; dependencies `rxdb`, `rxjs`, `fake-indexeddb`, `react-test-renderer`, `@mapbox/unitbezier` removed.
  Source 79 k → 23 k lines. Found on the way: map CSS depended on stylesheet order (`.v5-map` vs maplibre's `.maplibregl-map`), fixed; `collection.area.update` bound no colour, fixed.

## Not decided here

Auth and security code are not rewritten before phases 1–3 are on staging. The D1 contracts (`campaign_mutations`, sync heads, retention) stay as they are.
