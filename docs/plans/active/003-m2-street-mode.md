# Plan 003 — M2 Street Mode

## Goal

Add the first real distribution-task workflow on top of team areas: manually trace street segments, store them as street tasks, change their distribution status in the field and undo accidental status changes.

## Relevant context

- `AGENTS.md`
- `docs/product/PRODUCT.md`
- `docs/product/MVP.md`
- `docs/product/UX.md`
- `docs/architecture/MAP.md`
- `docs/architecture/DATA.md`
- `docs/architecture/OFFLINE_SYNC.md`
- `docs/architecture/SECURITY.md`
- `docs/quality/QUALITY.md`
- active Plan 002 remains open only for final real-device M1 verification

## Tasks

- [x] evolve the browser snapshot from schema v1 to v2 without losing existing campaign/team/area data
- [x] add street-task domain type with statuses `open`, `completed`, `later`, `not-deliverable`
- [x] keep task geometry as application-controlled GeoJSON LineString assigned to an area
- [x] enter Street Mode from a selected area
- [x] manually trace a street segment with large explicit Save/Cancel/Undo controls
- [x] render all street tasks above team areas with status-distinguishing line style/opacity, not color alone
- [x] tap a street task to open a compact status sheet
- [x] change task status with large one-hand-friendly controls
- [x] provide immediate undo after a status change
- [x] allow street task rename and deletion
- [x] persist street tasks across reloads on the same device
- [x] update docs/status and planned D1 model without creating or inventing a production D1 id
- [x] pass CI typecheck/build on the implementation head
- [ ] verify the final PR head remains green and merge
- [ ] verify Street Mode on a real Android phone and iPhone/Safari-class browser

## Acceptance criteria

- A selected area can enter Street Mode without leaving the map.
- A user can trace and save at least one street line assigned to that area.
- Street tasks remain clearly visible over the basemap and area fill.
- `open`, `completed`, `later`, and `not-deliverable` are all selectable.
- Critical task state is distinguishable by line pattern/weight/opacity in addition to color.
- A status change can be undone immediately.
- Accidental map pan does not silently change task status.
- Street tasks, labels and statuses survive reload on the same device.
- Existing M1 local data migrates forward rather than disappearing.
- GPS remains local-only; no route recording, GPS history, service worker or PWA behavior is introduced.
- CI passes `npm run typecheck` and `npm run build` before merge.

## Verification so far

GitHub Actions passed dependency installation, TypeScript type checking and the production Vite/Cloudflare build on the implementation head before the final documentation/status update.

The final PR head must repeat the same green CI gate before merge. Real-device interaction remains open and is intentionally not replaced by build success.

## Risks

- Street tracing gestures can conflict with map panning on small screens.
- Dense street lines can become visually noisy over Voyager tiles and colored areas.
- Browser storage is still single-device; this milestone must not be represented as shared synchronization.

## Decisions made

- Street Mode comes before House Mode.
- The first Street Mode uses manual line tracing over the basemap instead of adding a large road-import dependency.
- Task status changes are local optimistic mutations with an immediate in-memory undo action; durable multi-device conflict handling remains a later Worker/D1 milestone.
- The snapshot receives an explicit schema migration so existing M1 data is preserved.
