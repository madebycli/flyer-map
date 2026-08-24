---
id: plan-008-renderer-webgl-performance
type: plan
status: active
last_updated: 2026-08-24
---

# Renderer performance slice — whole-city scale

## Goal

Remove visible mobile lag between MapLibre camera movement and saved Verteil-Flyer geometry before scaling to hundreds or thousands of street features.

## Evidence

Real-device use on a Pixel 9 shows a small but visible delay in the current saved SVG Area overlay while panning even with only a few Areas and Streets. The existing renderer projects every stored coordinate through `map.project()` and triggers React/SVG redraws on map movement. That path is intentionally simple but does not provide enough headroom for a fully marked 40k–60k population city.

MetroDreamin was reviewed as a reference: it renders persistent network geometry as GeoJSON sources and native map line layers rather than reprojecting every persistent feature through React/SVG for every camera frame.

## Decisions

- Keep CARTO Voyager Retina as the raster basemap.
- Move only **saved** Areas and Street Tasks to MapLibre GeoJSON/WebGL layers.
- Keep **active** Area draw, Area edit preview/handles and Street draw preview in SVG for simple touch editing.
- Stored Area corner/edit points must never render in browse mode.
- Street visuals should read like colored roads, not broad highlighter strokes.
- Street and Area outline width must be zoom-dependent: thinner when zooming out, gradually wider when zooming in.
- Use a small fixed number of MapLibre layers for all saved features rather than one DOM element per visual pass.
- Use MapLibre rendered-feature hit testing for saved Streets/Areas in browse mode.
- Preserve team colors and task status semantics.
- Do not change persistence, M4 authorization or sync semantics in this slice.

## Target visual hierarchy

- Areas: very low-opacity team tint plus crisp, narrow team-colored boundary.
- Streets: primarily the team-colored street line itself, with no permanent broad white casing.
- Selected Street: temporary readable selection halo only for the selected feature.
- `completed`: faded.
- `later`: dashed.
- `not-deliverable`: short dotted/dashed treatment.
- Draw/edit previews remain intentionally higher contrast than saved geometry.

## Performance acceptance

- Normal pan/zoom/rotate does not trigger React rerenders solely to reposition saved Areas/Streets.
- Saved geometry stays visually locked to the basemap during camera movement.
- Synthetic datasets should be tested at 500, 1,000, 2,500 and 5,000 Street Tasks.
- No stored edit handles/corner markers appear outside active edit mode.
- CI tests, TypeScript and production build remain green.
- Real-device checks include Pixel 9 and, when available, an older iPhone-class device.

## Merge ordering

This branch starts from the M4 production baseline on `main`. It is intentionally separate from M4 authorization/persistence and may be reviewed and merged independently after its own CI and device checks.