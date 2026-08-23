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

- [ ] define browser-side campaign/team/area snapshot types compatible with the planned Worker/D1 model
- [ ] create and rename the campaign
- [ ] create, rename and recolor teams with unique palette colors
- [ ] build mobile team management as a compact bottom sheet
- [ ] draw a polygon area with explicit draw mode, undo, save and cancel
- [ ] assign every area to a team and preview the team color while drawing
- [ ] render all saved areas as colored transparent fills with clear outlines
- [ ] select an existing area from the map
- [ ] edit saved polygon vertices with large mobile-friendly handles
- [ ] reassign an area to another team
- [ ] delete an area with an explicit destructive action
- [ ] reject invalid/self-intersecting polygon geometry instead of silently saving it
- [ ] persist the M1 snapshot in browser storage and restore it after reload
- [ ] isolate persistence behind a small store boundary so the same snapshot can later come from Worker/D1 on multiple phones
- [ ] keep GPS local-only and leave the existing basemap provider unchanged
- [ ] update stale website-only/map documentation and `docs/status/CURRENT.md`
- [ ] run typecheck/build through CI, fix failures, merge only when green

## Acceptance criteria

- A user can name a campaign, create at least one team, choose a distinct color and draw an assigned area without leaving the map.
- Drawing mode is obvious and has large Save/Cancel/Undo controls.
- A saved area survives browser reload on the same device.
- All areas are visible together with their team colors, transparent fills and strong outlines.
- Tapping an area opens compact mobile controls for assignment, editing and deletion.
- Editing uses large touch-friendly vertex handles; normal map panning does not mutate geometry.
- Invalid polygons cannot be saved and the reason is visible.
- No service worker, Web App Manifest, native-app code, GPS persistence or GPS sharing is introduced.
- The data snapshot and persistence boundary are ready to be backed by the Worker/D1 later without changing map-domain types.
- CI passes `npm run typecheck` and `npm run build` before merge.

## Risks

- Map gesture handling can conflict with drawing/editing on touch devices.
- Team color ownership and area selection must remain readable over a detailed basemap.
- Browser localStorage is intentionally single-device; shared persistence still requires D1 in a later slice.

## Decisions made

- Keep M1 persistence local-first to complete the end-to-end interaction without inventing a D1 database id.
- Use a fixed accessible team-color palette and prevent duplicate team colors within a campaign.
- Use tap-to-place drawing and tap-handle-then-tap-map vertex editing instead of tiny drag handles; this is easier to operate reliably on phones.
- Keep MapLibre and the current CARTO Voyager Retina basemap unchanged; M1 adds only application-controlled GeoJSON layers above it.
