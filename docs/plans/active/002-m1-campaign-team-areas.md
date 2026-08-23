# Plan 002 — M1 Campaign, Teams and Areas

## Goal

Turn the map prototype into the first useful Verteil-Flyer workflow: one campaign with named/color-coded teams and editable assigned distribution areas directly on the mobile map.

## Relevant context

- `AGENTS.md`
- `docs/product/PRODUCT.md`
- `docs/product/MVP.md`
- `docs/product/UX.md`
- `ARCHITECTURE.md`
- `docs/architecture/STACK.md`
- `docs/architecture/MAP.md`
- `docs/architecture/DATA.md`
- `docs/architecture/SECURITY.md`
- `docs/quality/QUALITY.md`
- ADR-0002, ADR-0003, ADR-0006 and ADR-0008

## Tasks

- [x] define browser-side campaign/team/area snapshot types compatible with the planned Worker/D1 model
- [x] create and rename the campaign
- [x] create, rename and recolor teams with unique palette colors
- [x] build mobile team management as a compact bottom sheet
- [x] draw a polygon area with explicit draw mode, undo, save and cancel
- [x] assign every area to a team and preview the team color while drawing
- [x] render all saved areas as colored transparent fills with clear outlines
- [x] select an existing area from the map
- [x] make the selected area unmistakable on the basemap with a dedicated high-contrast selection halo
- [x] edit saved polygon vertices with large mobile-friendly handles
- [x] reassign an area to another team
- [x] delete an area with an explicit destructive action
- [x] reject invalid/self-intersecting polygon geometry instead of silently saving it
- [x] persist the M1 snapshot in browser storage and restore it after reload
- [x] isolate persistence behind a small store boundary so the same snapshot can later come from Worker/D1 on multiple phones
- [x] keep GPS local-only and leave the existing basemap provider unchanged
- [x] update stale website-only/map documentation and `docs/status/CURRENT.md`
- [x] run typecheck/build through CI and fix failures before merge
- [ ] verify the complete M1 interaction on a real Android phone and iPhone/Safari-class browser

## Acceptance criteria

- A user can name a campaign, create at least one team, choose a distinct color and draw an assigned area without leaving the map.
- Drawing mode is obvious and has large Save/Cancel/Undo controls.
- A saved area survives browser reload on the same device.
- All areas are visible together with their team colors, transparent fills and strong outlines.
- Tapping an area opens compact mobile controls for assignment, editing and deletion and produces an obvious high-contrast highlight on the selected polygon.
- Editing uses large touch-friendly vertex handles; normal map panning does not mutate geometry.
- Invalid polygons cannot be saved and the reason is visible.
- No service worker, Web App Manifest, native-app code, GPS persistence or GPS sharing is introduced.
- The data snapshot and persistence boundary are ready to be backed by the Worker/D1 later without changing map-domain types.
- CI passes `npm run typecheck` and `npm run build` before merge.
- Real-device verification confirms there is no horizontal overflow or blocking overlap between map controls and bottom sheets.

## Verification so far

GitHub Actions has passed `npm run check` on the implementation/documentation head, covering TypeScript type checking and the production Vite/Cloudflare build.

Real-device feedback found that the original selected-area treatment was too subtle because it only increased opacity and line width in the same team color. The selection rendering now uses a dedicated white halo plus a stronger team-color outline. This fix still needs production-phone verification.

Real-device verification of the complete M1 interaction remains the release gate for closing this plan.

## Risks

- Map gesture handling can conflict with drawing/editing on touch devices.
- Team color ownership and area selection must remain readable over a detailed basemap.
- Browser localStorage is intentionally single-device; shared persistence still requires D1 in a later slice.

## Decisions made

- Keep M1 persistence local-first to complete the end-to-end interaction without inventing a D1 database id.
- Use a fixed accessible team-color palette and prevent duplicate team colors within a campaign.
- Use tap-to-place drawing and tap-handle-then-tap-map vertex editing instead of tiny drag handles; this is easier to operate reliably on phones.
- Keep MapLibre and the current CARTO Voyager Retina basemap unchanged; M1 adds only application-controlled GeoJSON layers above it.
- Render selected areas with their team color plus a thick white halo so selection remains obvious across all team colors and Voyager map detail.
