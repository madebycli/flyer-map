---
id: status-current
type: status
status: active
last_updated: 2026-10-09
---

# Current Project State

The authoritative cross-repository route is `.ai/CONTEXT.md` → `madebycli/master-context/projects/flyer-map/INDEX.md` → `handoffs/CURRENT.md`.

**What exists (integration branch `claude/rewrite-phase5-delete-legacy`, not merged into main/beta, not deployed):** one field map, `/v5`, written from scratch ([Plan 051](../plans/active/051-full-rewrite.md), [ADR-0036](../decisions/ADR-0036-legacy-map-retired.md)).
Streets and houses are derived on the device by a Rust/WASM engine from one OSM pack per Gebiet; only a status overlay and notes are stored and synced. One design system (`src/ui`) serves the field map and the organiser pages
(sign-in with second factor, Aktionen, Sicherheit, Einladungen). The old map, RxDB sync, V3/V4 street engine, Rooms, comments, statistics and automations are deleted; the Worker keeps identity, access links, the collection
backend (Abholen incl. admin setup), the lean mutation path and `worker/v5`. Source: 79 k → 23 k lines.

**Verified (sandbox only, B mobile-clarity branch: integration 5e352a2 plus reviewed A-5 62d3234):** 432 unit tests, typecheck and build; affected flows 9/14/15 against real Worker handlers on in-memory D1. Flow 15 checks the Gebiet and helper-rights sheets at 390/430 px × dark/light × left/right, including clean-up preserving real progress and keyboard/tap rights toggles. [Evidence](../v5/screens/mobile-clarity-2026-10-09/README.md). This UI diff awaits A review. Earlier runs of all 15 flows and the TypeScript fallback belong to earlier commits; the current runner lists 16 flows and its complete run has not been repeated here.
**Not verified:** real phones, real Overpass data, a real D1, the live basemap, the organiser pages against the real API (flow 11 mocks it at the network edge).

**Open before go-live (owner):**
- Apply `0026_v5_field_state.sql` and `0027_v5_notes.sql` (additive) on the target D1; on staging also the missing legacy migrations behind the login 500 (`0023`, `0024_*`, `0025`) — needs a go.
- Deploy to **staging** first (`deploy/staging/wrangler.staging.example.jsonc`), test with real devices, then merge. Branch previews share the production D1; production is untouched.
- Decide: Rooms, English UI, manual street, assigning Sonder-Marker (all dropped, see Plan 051 decision 5). Delete the old remote branch `claude/v5-field-core`.
- `CampaignSyncDurableObject` stays as an empty stub until a `deleted_classes` migration is approved (it destroys the object's storage).
- GitHub workflows for the old pipelines (street engine, RxDB sync, D1 attribution) are unchanged and partly obsolete; the owner decides which to remove.
- `npm run audit:dependencies` reports high advisories in the Cloudflare dev tooling (`wrangler`/`miniflare`/`@cloudflare/vite-plugin`); not touched here.

`STREET_ENGINE_LIVE_READY=FALSE` (the flag and V4 engine no longer exist in code). No Production/Main deploy, Production D1 mutation or secret rotation without explicit authorisation.
