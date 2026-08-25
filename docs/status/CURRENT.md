---
id: status-current
type: status
status: active
last_updated: 2026-08-25
---

# Current Project State

## Baseline

M4 access/session authorization and PR #21 are merged on `main`.

Verteil-Flyer remains a mobile-first normal website:
- no native app;
- no installable PWA;
- no Service Worker;
- no Background Sync API.

Current renderer baseline:
- MapLibre GL JS **5.7.1 pinned**;
- CARTO Voyager Retina online basemap;
- saved Areas/Streets in persistent MapLibre GeoJSON sources/layers;
- active draw/edit geometry only in SVG;
- no application-side dense saved-geometry projection loop during browse.

Current Campaign roles remain Admin, Team Editor scoped to one Team, and Viewer. Worker authorization is authoritative.

## Active M5 implementation

M5 resilient mutation synchronization is already in progress and must **not** be restarted on a new branch.

Current implementation:
- branch `m5-resilient-sync-mainline`;
- Draft PR #24 `M5 durable mutation queue on current MapLibre baseline`;
- remote D1 migration `0003_m5_mutations.sql` has been reported applied successfully in the M5 acceptance work;
- durable mutation queue / Worker idempotency foundation is implemented on that PR.

Real-browser acceptance already found and fixed a maximum-zoom basemap bug on the M5 branch. A Worker Version preview containing the fix was tested and the basemap remained visible at maximum zoom.

A strict full cold page reload while completely offline showed Chrome's normal offline/Dino page before application JavaScript could run. This is not treated as user error or mutation-loss proof. Guaranteed cold-offline app-shell startup is deferred under the current no-Service-Worker architecture.

Before changing M5, inspect PR #24 and its branch/current CI. Do not rely only on this summary for individual remaining gates.

## Prepared offline area

`docs/plans/active/011-offline-map-area.md` tracks a future approximately 3 km prepared offline working area using an offline-permitted OSM/OSM-derived source/format.

It must not intentionally cache/store current CARTO raster content and does not by itself promise cold offline page startup.

## Full platform expansion

The accepted product direction has been expanded substantially.

Primary umbrella plan:
- `docs/plans/active/012-platform-app-expansion.md`.

New proposed architecture:
- `docs/architecture/IDENTITY_PERMISSIONS.md`;
- `docs/architecture/LIVE_TEAMS.md`;
- expanded `ORGANIZATIONS.md`, `COLLABORATION.md`, `SECURITY.md` and `UX.md`.

Dedicated fresh-chat implementation prompt:
- `docs/prompts/START_PLATFORM_EXPANSION.md`.

## Accepted expansion direction

After the M5 foundation, planned sequence is:
1. M5.5 prepared offline working area;
2. M6 Smart Street + House geometry;
3. M6.5 Clothes Collection / Pickup mode;
4. M7 Field Sessions + Live Field Groups + comments/activity/automations;
5. M8 Organizations + username/password/TOTP admin accounts + configurable permissions + desktop Admin;
6. M9 statistics/progress + app-like navigation + Support/Feedback + appearance;
7. M10 security/field hardening/release.

Important requested product capabilities include:
- Campaign/Team/Area percentage progress bars;
- Team outing/session history with date, duration, participant count and optional note;
- map highlighting of work from a selected past session using Task/domain events, not GPS trails;
- optional Team date;
- Team archive/delete;
- Team color presets starting Orange, Blue, Green, Red, Gray plus more colors;
- persistent Teams separated from temporary live Field Groups;
- multi-device Field Group joining with authorized QR/code/optional password;
- live discoverability enabled by default with opt-out, but never public internet discovery;
- separate flyer Distribution and clothes Collection/Pickup progress;
- call-in/manual pickup addresses;
- smaller field bottom bar, gear Settings icon, Team icon, Menu/App button and full-screen app-like menu;
- compact current Team name and progress in top bar;
- separate desktop Admin panel;
- administrator-configured capability permissions;
- multiple administrator accounts and safe admin transfer;
- future admin login using username + password + authenticator-app TOTP;
- Support/Feedback module.

## Security boundary for future accounts

Account/permissions work is not approved for ad-hoc implementation.

Before M8 account implementation, an accepted ADR/threat model must define:
- password hashing;
- TOTP secret protection;
- account sessions/recovery;
- rate limiting;
- role/capability evaluation;
- legacy Campaign Admin migration.

Mandatory direction already recorded:
- parameterized/prepared D1 queries;
- no SQL concatenation with user input;
- raw passwords/TOTP secrets never logged;
- injected SQL/HTML/JS/code-like input remains inert data;
- authentication never replaces Worker-side authorization;
- Organization tenant isolation is non-bypassable;
- security/admin/permission changes are audited.

## Known follow-ups

Existing follow-ups remain visible:
- GitHub #22 — desktop bottom-toolbar fit/spacing;
- GitHub #23 — production health/recovery/diagnostics and dense Street validation.

## Immediate next

1. Inspect and finish the existing M5 Draft PR #24 rather than starting a replacement.
2. Merge M5 only after its actual remaining gates and final CI are green.
3. Then execute the next slice according to Plan 011 / Plan 012 and the Context Graph.
4. For a fresh AI coding chat use `docs/prompts/START_PLATFORM_EXPANSION.md`.
