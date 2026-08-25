---
id: status-current
type: status
status: active
last_updated: 2026-08-25
---

# Current Project State

## Baseline

M4 access/session authorization and PR #21 are merged on `main`. Verteil-Flyer remains a mobile-first website only: no native app, installable PWA, Service Worker, Web App Manifest install flow or Background Sync API.

Current renderer baseline:
- MapLibre GL JS **5.7.1 pinned**;
- CARTO Voyager Retina raster basemap;
- saved Areas/Streets in persistent MapLibre GeoJSON sources/layers;
- active draw/edit geometry only in the small SVG overlay;
- no application-side dense saved-geometry projection loop during browse.

Current Campaign roles remain Admin, Team Editor scoped to one Team, and Viewer. Worker authorization is authoritative.

## Active M5

M5 resilient mutation synchronization remains the current release slice:
- branch `m5-resilient-sync-mainline`;
- Draft PR #24;
- Plan 010: `docs/plans/active/010-m5-resilient-mutation-sync.md`;
- ADR-0011 governs the durable mutation queue/idempotency design.

Implemented:
- explicit Campaign/Team/Area/Street mutations;
- IndexedDB durable queue plus emergency localStorage shadow;
- ordered retry/backoff and lifecycle retry triggers;
- visible pending/offline/conflict/auth-blocked/failed states;
- canonical SHA-256 mutation fingerprints;
- Worker validation + existing authorization;
- narrow D1 mutation persistence and idempotency ledger.

D1 migration `0003_m5_mutations.sql` was successfully applied to remote `flyer-map-db` on 2026-08-25.

## Browser acceptance observations

Observed in a real browser on 2026-08-25:
- preview root loads;
- while the application is loaded and offline, creating a Street shows `offline gespeichert`;
- while the application is loaded and offline, editing a Street remains locally saved.

A later full page reload while still offline did **not** load Verteil-Flyer; Chrome displayed its normal offline/Dino page. Therefore the earlier assumption that an end-to-end full offline reload had passed is withdrawn.

This is not treated as user error and not as proof that the IndexedDB mutation disappeared. It demonstrates a separate application-shell limitation of the current normal-website/no-Service-Worker architecture.

Strict cold page reload/start while fully offline is therefore deferred as a TODO rather than a blocking M5 acceptance claim. A future requirement to guarantee the whole website cold-loads offline needs an explicit architecture decision revisiting ADR-0006.

## Maximum-zoom basemap bug — fixed and browser-accepted

Real-browser testing exposed a renderer bug: at maximum zoom the CARTO basemap became completely white while application geometry remained visible.

Root cause:
- Map instance is capped at zoom 20;
- CARTO source is correctly capped at zoom 20;
- raster style layer was also declared `maxzoom: 20`;
- MapLibre hides a style layer at zoom values equal to or greater than its layer `maxzoom`.

Fix committed in `5029f9b958502d96d6c185beac16b894774d72e9`:
- only the CARTO raster layer maxzoom changed from 20 to 21;
- source maxzoom remains 20;
- map maxZoom remains 20;
- no provider, MapLibre version, saved-geometry renderer or camera architecture changed.

CI #226 passed for this runtime fix.

A new Cloudflare Worker Version preview containing the fix was manually uploaded from branch head `da7a13a38916b058bc6a2d577210100700d04111` after a successful production build:
- Worker Version ID: `98516141-4820-4fb6-8f7d-8a7410c1d57b`;
- exact Version Preview: `https://98516141-flyer-map.cloudflare-eleven035.workers.dev`;
- preview alias: `https://m5-zoom-fix-flyer-map.cloudflare-eleven035.workers.dev`;
- no production traffic was changed.

Real-browser acceptance passed: at maximum zoom the basemap remains visible and no longer turns white.

## Offline map-area requirement

Plan 011 tracks a deliberate downloadable local map package:
- Settings action;
- default radius approximately **3 km around the current map center**;
- offline-permitted OSM/OSM-derived data stored in IndexedDB;
- Areas/Streets and M5 mutations continue working while the loaded application loses connectivity;
- CARTO raster tiles are not stored/cached.

Important scope correction: Plan 011 does not itself guarantee a cold full-page reload with no network. Offline map data and offline application-shell loading are separate problems.

## Newly accepted future field requirements

Two external field-user ideas were accepted into the roadmap on 2026-08-25.

### Distribution effort feedback

Groups should be able to record directly after distributing a section:
- how long they were distributing;
- how many people were in the group;
- optional short note/difficulty feedback.

Purpose:
- avoid guessing duration/group size later in leader meetings;
- help determine whether Areas are realistically sized for different groups;
- feed later Area/Team statistics and person-time reporting without GPS surveillance.

This belongs to M7 collaboration/activity capture and M9 statistics/reporting. Exact session/entity semantics are still to be designed.

### Collection / pickup mode

A second field mode is planned for the later clothes-collection round:
- reuse real Street/House geometry from M6;
- parents/teams can mark collection road sections already driven/completed;
- houses/addresses can be marked as pickup stops;
- manually reported pickup addresses can be added, e.g. after residents call;
- collection progress remains separate from prior flyer-distribution progress;
- no continuous GPS route tracking required.

This is now Roadmap **M6.5 — Collection / pickup mode** and requires its own reviewed data-model decision before implementation.

## M5 gates still open

Applicable remaining release gates:
1. with the app loaded, reconnect after an offline mutation and confirm queued delivery exactly once;
2. retry/reconnect without duplicate effect;
3. visible target conflict with no silent overwrite;
4. revoked/invalid access stops blind retry and remains access-blocked;
5. transient failure stays queued and retries later;
6. saved Area/Street selection and active edit behavior remain unchanged;
7. final repository head green before merge.

Deferred/non-blocking TODO:
- strict cold page reload/start while fully offline; current Chrome test shows the browser offline/Dino page before Verteil-Flyer can run.

PR #24 remains Draft until the applicable remaining M5 gates pass.

## Follow-ups / roadmap

- Plan 011 / M5.5 — downloadable ~3 km offline working area for the loaded app;
- M6 — Smart Street + House Tasks from reviewed real map geometry;
- M6.5 — Collection / pickup mode for later clothes collection by car and explicit pickup addresses;
- M7 — comments, activity, deterministic automations and distribution effort feedback;
- M8 — Organizations, multiple admins and Admin panel;
- M9 — statistics/reporting including duration, group size/person-time and personal UI appearance;
- M10 — field hardening/release.

Existing GitHub follow-ups remain open:
- #22 desktop bottom-toolbar fit/spacing;
- #23 production health/recovery/diagnostics and dense Street validation.

## Immediate next

1. Keep PR #24 Draft.
2. Do not repeat the strict cold-offline reload test for M5; keep it documented as a follow-up.
3. Continue the remaining loaded-app M5 browser acceptance when convenient.
4. Merge M5 only after applicable release gates pass.
5. Then execute Plan 011 and M6; M6.5 collection mode should reuse the same reviewed road/building geometry.
