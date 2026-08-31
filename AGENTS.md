# AGENTS.md

## Project

Verteil-Flyer is a mobile-first website for coordinating flyer distribution across geographic areas.

The map is the primary field workspace. Users need to see assigned areas, real distribution units and current progress quickly on ordinary phones, while coordinators and administrators need safe shared control of campaigns.

The application must remain lightweight, reliable, privacy-conscious and easy to operate outdoors.

## Product direction

Current field model:
- Campaign / Aktion;
- Team;
- Area;
- distribution Task;
- revocable Campaign access roles.

Planned product expansion is documented in `docs/product/ROADMAP.md` and includes:
- resilient mutation synchronization;
- automatic road/task generation from map data and a House Mode;
- comments, activity history and useful automations;
- statistics/progress reporting;
- multi-organization administration and organization-scoped Admin panels;
- multiple authorized administrators rather than one implicit owner;
- personal UI light/dark/system appearance while the basemap may remain unchanged.

Do not implement these future concepts from memory. Read the roadmap and the relevant proposed architecture document first.

## Primary goals

1. Make it obvious what has already been distributed.
2. Make it obvious what still needs to be done.
3. Allow multiple people to share the same current state safely.
4. Preserve important user changes when mobile connectivity is unreliable.
5. Keep GPS location local to the device unless a future accepted decision explicitly requires otherwise.
6. Remain usable in ordinary mobile browsers on common Android phones and iPhones, including older/slower devices.
7. Keep hosting and infrastructure operationally simple and cost-conscious.
8. Scale the map to whole-city workloads without application-side geometry work on every camera frame.

## Website-only baseline

Verteil-Flyer is a normal website.

Do not introduce unless an accepted future ADR explicitly changes this:
- native Android/iOS applications;
- installable PWA behavior;
- service workers;
- Web App Manifest installation flows;
- Background Sync API.

See ADR-0006.

## Technology baseline

Frontend:
- TypeScript;
- React;
- Vite;
- plain CSS;
- MapLibre GL JS **5.7.1 pinned for the current renderer baseline**.

Platform:
- Cloudflare Workers;
- Workers Static Assets;
- Cloudflare D1 for shared persistence.

Maps:
- OpenFreeMap Liberty vector basemap using OpenStreetMap-derived data, without an API key;
- standard house numbers from the Liberty `openmaptiles` / `housenumber` contract through one app-owned symbol layer;
- MapLibre owns camera/navigation/geolocation and persistent saved application geometry;
- saved Areas and saved Street Tasks are long-lived GeoJSON sources/layers in MapLibre;
- active draw/edit geometry and edit handles use the small independent SVG overlay only while an interaction is active;
- stored edit/corner points are hidden in browse mode;
- the basemap/provider must remain replaceable.

Important renderer rule:
- normal browse pan/zoom/rotate must not project or repaint every saved Area/Street in React/SVG/Canvas;
- persistent saved geometry moves in the map renderer with the basemap;
- actual domain changes may update GeoJSON sources with `setData()`.

See `docs/architecture/MAP.md` and ADR-0010.

Source control:
- GitHub.

## Performance philosophy

Verteil-Flyer is a field tool, not a marketing website.

Prefer:
- small dependencies;
- native browser functionality;
- text and CSS over image assets;
- simple interactions;
- predictable rendering;
- minimal network requests;
- fixed/constant map-layer counts rather than one layer/DOM node per street;
- real-device measurements over desktop-only assumptions.

Avoid:
- large UI frameworks;
- animation libraries without a concrete UX need;
- external web fonts;
- autoplay media;
- decorative videos;
- large image backgrounds;
- unnecessary telemetry;
- per-frame React reconciliation for dense map geometry.

Any substantial dependency must solve a demonstrated problem.

## Source of truth

Project knowledge lives in the repository, especially `/docs`.

Always read first:
1. `AGENTS.md`;
2. `docs/status/CURRENT.md`;
3. `docs/context-map.yaml`.

Then traverse the context graph for the current task. Do not load every document by default.

`ARCHITECTURE.md` contains the current high-level system architecture. `docs/product/ROADMAP.md` contains accepted product direction beyond the current slice.

If code and documentation disagree:
1. inspect current code, current PR/main state and accepted ADRs;
2. determine the intended current behavior;
3. fix the stale source;
4. do not knowingly leave contradictory documentation.

Historical completed plans and superseded ADRs are context/history, not current implementation requirements.

## Context graph discipline

`docs/context-map.yaml` is a routing graph, not just a file list.

Use node topics/load rules and edges to select the smallest useful context set. When adding a new durable concept or source-of-truth document:
- add/update its graph node;
- connect it to its dependencies/constraints;
- avoid orphan documentation.

## Plans

Non-trivial work requires a plan in `docs/plans/active/`.

Plans should contain:
- goal;
- baseline/source of truth;
- relevant context graph nodes;
- tasks;
- acceptance criteria;
- risks;
- decisions made;
- explicit non-goals.

When completed:
- update documentation;
- update `docs/status/CURRENT.md`;
- move the plan to `docs/plans/completed/`.

Do not leave already-completed milestones in `active/` merely as historical notes.

## Documentation maintenance

Documentation is part of the implementation.

When behavior, architecture, data structures, security assumptions, deployment or UX rules change, update the corresponding docs in the same change.

`docs/status/CURRENT.md` must stay short. It is current state, not a changelog.

## Decision records

Architecture decisions that would be expensive or confusing to reverse require an ADR in `docs/decisions/`.

Do not rewrite history by deleting accepted ADRs. If a prior accepted decision is replaced, create a new ADR that explicitly supersedes it.

## Testing

Every change must be tested at the lowest useful level.

Important flows need integration/browser coverage where practical. Mobile interaction, map performance, synchronization and connectivity-loss behavior require explicit real-device testing.

Whole-city map work must be evaluated with dense representative data rather than only a handful of test streets.

## Security

Never commit:
- API secrets;
- authentication/session tokens;
- production access links;
- private campaign data;
- personal data that is not intentionally part of the product model.

Client input is untrusted. Authorization must be enforced by the Worker, never only by UI visibility.

Future organization/admin work must preserve server-side organization and Campaign scoping. Do not assume the current Campaign-role model is already sufficient for multi-organization administration; read the proposed organization architecture first.

## Working style

Prefer small, reviewable changes and evidence-driven fixes.

Do not refactor unrelated code while implementing a feature. Do not introduce abstractions before they solve a demonstrated problem. Prefer readable boring code over clever code.

Before finishing a task:
1. run relevant tests;
2. run type checking;
3. run the production build;
4. review changed files;
5. update relevant docs/context graph;
6. update `CURRENT.md`;
7. confirm the active plan accurately reflects what remains.
