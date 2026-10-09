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
2. **Worker to Rust via `workers-rs`**, as a strangler: a Rust entry Worker answers the v5 routes natively and forwards everything else through a service binding to the
   current TypeScript Worker; auth moves last, after its own security review. Not started until a feasibility probe (build, D1, Durable Object, HTTP-level test harness) is accepted.
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
| Diagnostics, Support, Live | `src/diagnostics`, `src/support`, `src/live` | **keep as one "Hilfe & Status" sheet** | merge three into one |
| RxDB sync, change feed, sync heads, mutation pipeline | `worker/rxdb*`, `mutation*`, `syncHeads`, `campaignSyncDurableObject` | **keep until cut-over**, then **drop** | v5 has own LWW sync (`/api/v5/.../ops`) |
| CSS: 12 k lines in 65 files | `src/*.css` | **drop with their screens** | replaced by `src/ui` tokens + components |

Net effect: ≈ 45 000 of 79 000 lines disappear at the end; ≈ 5 000 new lines (UI) and the Rust Worker core replace them.

## Phase status

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
- Phases 3–5: not started.

## Not decided here

Auth and security code are not rewritten before phases 1–3 are on staging. The D1 contracts (`campaign_mutations`, sync heads, retention) stay as they are.
