---
id: plan-008-renderer-access-recovery
type: plan
status: active
last_updated: 2026-08-24
---

# 008 — Access recovery + stable whole-city renderer

## Goal

Restore effortless Admin access for an existing Campaign without weakening Worker authorization, and optimize the proven SVG renderer for hundreds to thousands of saved street segments while preserving reliable visibility, selection and edit behavior on mobile browsers.

## Context

- M4 access links are live on `main`; a Campaign id is only a selector, not a credential.
- Preview hosts do not share the production session cookie, so a valid Campaign can show `access_required` even when the same browser was previously authenticated on production.
- The post-M4 MapLibre GeoJSON/WebGL experiment in PR #19 failed real-browser acceptance: saved Areas/Streets remained invisible and non-interactive despite green CI.
- The proven M4 renderer on `main` keeps saved application geometry in an SVG overlay and performs reliable geometric hit testing.
- Real-device feedback also requires edit handles to remain hidden outside active edit mode and the refresh control to sit cleanly above the bottom field UI.

## Tasks

1. Add a Worker-side Admin recovery endpoint guarded by the existing high-entropy `M4_BOOTSTRAP_SECRET`.
   - The endpoint may create a fresh Admin grant even when grants already exist.
   - It must set a new secure session cookie and return the plaintext recovery Access token once.
   - Campaign existence and same-origin protections remain enforced.
2. Add browser UI shown only when Campaign access is missing.
   - Secret is entered locally into a password field and never persisted.
   - Successful recovery immediately restores the session and yields a one-time Admin access URL that can be copied/bookmarked.
3. Keep saved Areas/Streets in the proven SVG renderer, but remove React reconciliation from ordinary browse pan/zoom.
   - Project and update saved geometry imperatively from map events.
   - Coalesce browse-only geometry redraws to animation frames.
   - Preserve the existing direct edit/draw overlay behavior so editing does not regress.
4. Reduce whole-city SVG overhead.
   - Group saved street paths by Team color + status rather than one React SVG node per street where practical.
   - Group saved Area paths by Team color.
   - Cull geometry outside the visible map bounds before projection where practical.
5. Visual treatment.
   - Saved Streets use thin Team-colored road-like strokes without permanent broad white casing.
   - Stroke width becomes thinner as the map zooms out.
   - Saved Areas use subtle fill and thin outline.
   - Stored edit/corner points never render outside active edit mode.
6. Refresh control.
   - Browse-only.
   - Fixed bottom-right directly above the bottom field toolbar.
   - Compact surface language matching settings/field UI; no sideways expanding status label.
7. Tests/documentation.
   - Add coverage for recovery-secret rejection and successful recovery creating a fresh Admin grant/session.
   - Keep existing access/authorization tests green.
   - Update security, map architecture, current status and deployment documentation.
   - Run tests, TypeScript and production build in CI.
8. Cloudflare preview acceptance before merge.
   - Existing Campaign can be recovered on the preview host using the server secret.
   - Saved Area remains visible/clickable after Save.
   - Saved Street remains visible/clickable after Save.
   - Edit mode is no worse than current `main`.
   - Pan/zoom visibly avoids the old delayed React overlay behavior.

## Acceptance criteria

- Standard Campaign URL can recover Admin access through an explicit secret-protected flow; anonymous first-visitor claim remains impossible.
- A newly recovered Admin receives a one-time new Access Link and persistent secure session cookie.
- Saved Areas/Streets are always visible and selectable in browse mode.
- Edit handles are visible only while actively editing/drawing.
- Browse pan/zoom does not trigger a full React rerender for every saved geometry frame.
- Streets look like colored street markings rather than highlighter strokes and scale down visually when zooming out.
- Refresh control placement is stable on desktop/mobile.
- CI is green and preview acceptance passes before merge.

## Risks

- `M4_BOOTSTRAP_SECRET` becomes an operator recovery credential while it remains configured; documentation must make this explicit and recommend rotation if exposure is suspected.
- SVG projection is still O(number of visible vertices); grouping/culling reduces DOM/React overhead but does not make geometry free. Synthetic density testing remains required.
- Branch previews use a different origin and therefore require their own recovered/redeemed session cookie.

## Decision

Do not reintroduce MapLibre application GeoJSON layers in this slice. PR #19 demonstrated that replacing the proven renderer in one step is too risky. Optimize the stable SVG boundary first and require real-browser acceptance at every performance step.