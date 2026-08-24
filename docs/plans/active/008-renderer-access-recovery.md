---
id: plan-008-renderer-access-recovery
type: plan
status: active
last_updated: 2026-08-24
---

# 008 — Access recovery + stable whole-city renderer

## Goal

Restore Admin access for an existing Campaign without weakening Worker authorization, and reach whole-city map performance for hundreds to thousands of saved street segments while preserving reliable visibility, selection and edit behavior on mobile browsers.

## Context

- M4 access links are live on `main`; a Campaign id is only a selector, not a credential.
- Preview hosts do not share the production session cookie, so a valid Campaign can show `access_required` even when the same browser was previously authenticated on production.
- The post-M4 MapLibre GeoJSON/WebGL experiment in PR #19 failed real-browser acceptance: saved Areas/Streets remained invisible and non-interactive despite green CI.
- A first follow-up optimization grouped saved SVG paths and removed React reconciliation from browse movement, but real-device feedback still reported unacceptable lag.
- The renderer therefore keeps MapLibre limited to basemap/camera and moves **saved** application geometry to one independent Canvas while keeping **active edit/draw** geometry in SVG.
- Real-device feedback also requires edit handles to remain hidden outside active edit mode and the refresh control to sit cleanly above the bottom field UI.

## Tasks

1. Add a Worker-side Admin recovery endpoint guarded by the existing high-entropy `M4_BOOTSTRAP_SECRET`.
   - The endpoint may create a fresh Admin grant even when grants already exist.
   - It must set a new secure session cookie and return the plaintext recovery Access token once.
   - Campaign existence and same-origin protections remain enforced.
2. Add browser UI shown only when Campaign access is missing.
   - Secret is entered locally into a password field and never persisted.
   - Successful recovery immediately restores the session and yields a one-time Admin access URL that can be copied/bookmarked.
3. Saved geometry performance path.
   - Render all saved Areas and Street Tasks into one transparent Canvas overlay.
   - Precompute feature bounds when snapshot data changes.
   - Cull offscreen geometry before point projection.
   - Group Areas by Team color and Streets by Team color + status in memory.
   - Coalesce MapLibre camera events to at most one Canvas redraw per animation frame.
   - Cap overlay device-pixel-ratio at 2 to avoid oversized mobile backing buffers.
4. Active edit/draw performance path.
   - Keep area/street draft geometry and edit handles in SVG.
   - Update SVG `points`/marker coordinates directly on camera movement.
   - Never trigger a React render for every MapLibre `move` event.
5. Visual treatment.
   - Saved Streets use thin Team-colored road-like Canvas strokes without permanent broad white casing.
   - Stroke width becomes thinner as the map zooms out.
   - Saved Areas use subtle fill and thin outline.
   - Stored edit/corner points never render outside active edit mode.
6. Refresh control.
   - Browse-only.
   - Fixed bottom-right directly above the bottom field toolbar.
   - Compact surface language matching settings/field UI; no sideways expanding status label.
7. Diagnostics/tests/documentation.
   - Add coverage for recovery-secret rejection and successful recovery creating a fresh Admin grant/session.
   - Keep existing access/authorization tests green.
   - `?diag=1` reports FPS, long frames, feature counts, Canvas renderer state, DOM size and basemap timings without including Campaign selector or access token.
   - Record ADR-0010 for Canvas saved geometry + SVG active editing.
   - Update security, map architecture, current status and deployment documentation.
   - Run tests, TypeScript and production build in CI.
8. Cloudflare preview acceptance before merge.
   - Existing Campaign can be recovered on the preview host using the server secret.
   - Saved Area remains visible/clickable after Save.
   - Saved Street remains visible/clickable after Save.
   - Edit mode is smoother/no worse than current `main`.
   - Pan/zoom/rotate keeps saved Canvas aligned with the basemap.
   - Diagnose real device FPS before merge.

## Acceptance criteria

- Standard Campaign URL can recover Admin access through an explicit secret-protected flow; anonymous first-visitor claim remains impossible.
- A newly recovered Admin receives a one-time new Access Link and persistent secure session cookie.
- Saved Areas/Streets are always visible and selectable in browse mode.
- Edit handles are visible only while actively editing/drawing.
- Browse pan/zoom uses one Canvas overlay and does not reconcile stored geometry through React/SVG.
- Active editing does not React-rerender on every map camera frame.
- Streets look like colored street markings rather than highlighter strokes and scale down visually when zooming out.
- Refresh control placement is stable on desktop/mobile.
- CI is green and real-device preview acceptance passes before merge.

## Risks

- `M4_BOOTSTRAP_SECRET` becomes an operator recovery credential while it remains configured; documentation must make this explicit and recommend rotation if exposure is suspected.
- Canvas projection is still O(number of visible vertices). Culling and removal of DOM/React work materially reduce overhead, but diagnostics on realistic city data are still the release gate.
- Branch previews use a different origin and therefore require their own recovered/redeemed session cookie.

## Decision

Do not reintroduce MapLibre application GeoJSON layers in this slice. PR #19 demonstrated that path is not accepted for the current baseline. Use one Canvas for saved geometry and SVG only for active editing/drawing, as recorded in ADR-0010.
