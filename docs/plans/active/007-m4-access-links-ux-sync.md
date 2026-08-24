---
id: plan-007-m4
type: plan
status: active
last_updated: 2026-08-24
---

# M4 — Access Links + Authorization + Field UX hardening

## Goal

Protect every shared Campaign request with revocable Worker-enforced credentials while preserving the website-only + MapLibre-basemap/SVG-geometry architecture, then fix the mobile map/sync issues found after M3.

## Relevant context

- M3 shared snapshot persistence is live in D1 through `DB`.
- `migrations/0001_initial.sql` is production history and must not change.
- Campaign ids are selectors, never authorization credentials.
- MapLibre remains responsible only for CARTO Voyager Retina, navigation, camera and local one-shot geolocation.
- All Areas/Streets/Drafts/Edit geometry remains in the independent SVG overlay.
- No service worker, Web App Manifest, native app, WebSockets or full M5 durable mutation queue.

## Tasks

1. Add migration `0002_m4_access.sql` for access grants/sessions and Campaign default map view.
2. Add cryptographically strong invite tokens, SHA-256 token hashing, HttpOnly/Secure/SameSite sessions, revocation, roles and optional team scope.
3. Add a safe explicit bootstrap path for pre-M4 campaigns; never first-visitor admin claiming.
4. Enforce the permission matrix in the Worker and protect snapshot/version endpoints.
5. For team editors, compare old/new snapshots server-side so complete-snapshot PUTs cannot mutate another team's data or Campaign/admin configuration.
6. Add admin Access Management API/UI for list/create/revoke.
7. Change browse Area selection so it has no white halo and no corner markers; keep edit/draw markers.
8. Restore arbitrary MapLibre bearing/compass/touch rotation and keep SVG projection aligned.
9. Persist personal camera state locally per Campaign with debounce; use Campaign default focus only when no personal camera exists.
10. Add Campaign default map view controls using the current map view (no new geocoder dependency in this slice).
11. Replace full-page sync reloads with in-memory snapshot delivery; poll version every 30s plus online/visibility/manual refresh; defer remote application while draw/edit/street-draw is active.
12. Add compact localized refresh feedback and settings UI.
13. Add browser-local German/English language preference with a small TypeScript translation table; raster basemap labels remain provider-controlled.
14. Add automated Worker/security/domain tests and update docs/ADR/status/context.
15. Open PR, use CI as the execution environment for tests/typecheck/build, fix failures, then intentionally handle D1 migration/deploy/smoke validation before merge.

## Permission matrix

- Admin: read; Campaign settings/name/default view; teams; areas; tasks/status; create/revoke access grants.
- Team editor: read Campaign; write only Areas owned by its scoped team and Tasks inside those Areas; cannot change Campaign config, teams, other teams' Areas/Tasks, access grants, or reassign Areas across teams.
- Viewer: read only; every write endpoint returns authorization failure.

## Acceptance criteria

- Campaign id alone returns 401 for protected Campaign data.
- Valid admin, team editor and viewer credentials behave according to the matrix.
- Revoked grant/session immediately loses protected access.
- Invite token plaintext is never stored in D1.
- Cross-Campaign token/session use fails.
- Pre-M4 bootstrap requires an explicit server-side bootstrap credential, never race-to-claim.
- Browse Area selection has no halo/corner points; edit/draw points remain visible.
- Camera center/zoom/bearing persist locally per Campaign; Campaign focus is shared config and used only as fallback.
- Rotation works with compass; SVG stays aligned at arbitrary bearing.
- Remote snapshot refresh never calls `window.location.reload()` and never resets camera.
- Active unsaved draw/edit/street-draw is not silently replaced by remote data.
- Manual refresh exists below map controls with localized ARIA label and compact state feedback.
- German/English setting affects application text; raster basemap labels are documented as provider-side.
- Tests, TypeScript and production build are green.

## Risks

- Complete-snapshot authorization is easy to under-enforce for team editors; server-side structural diffing is mandatory.
- Revocation must invalidate already-issued sessions, not only invite redemption.
- M3 Campaigns have no owner credential, so migration requires an explicit one-time bootstrap mechanism.
- Applying `0002` to production is an intentional external D1 operation and must precede production requests that depend on it.

## Decisions made

- Use a one-time invite token in URL fragment; redeem it through an API request, then remove the fragment and rely on an opaque HttpOnly session cookie.
- Store only SHA-256 hashes of invite/session secrets in D1.
- Session authorization resolves its grant on every protected request, so grant revocation is immediately effective.
- Keep snapshot PUT for M4, but enforce a server-side old/new diff for team editors instead of starting M5's mutation queue.
- Implement Campaign focus from the current map view in M4; defer external place search/geocoder until it has a clearly reviewed provider/policy need.
