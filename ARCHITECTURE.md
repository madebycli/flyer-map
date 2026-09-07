# Architecture

## Current system

Verteil-Flyer is a client-heavy mobile-first website backed by a small Cloudflare Worker API and Cloudflare D1.

```text
Mobile/Desktop Browser
  ├─ React website shell
  ├─ MapLibre GL JS 5.7.1
  │   ├─ OpenFreeMap Bright vector basemap
  │   ├─ camera / zoom / rotation / compass
  │   ├─ live/refining local geolocation and follow
  │   ├─ saved Area GeoJSON source + fill/outline layers
  │   └─ saved Street Task GeoJSON source + fixed status layers
  ├─ SVG active-input overlay
  │   └─ draw/edit/street-draw preview + temporary handles only
  ├─ local browser preferences/cache
  │   ├─ last-known Campaign snapshot
  │   ├─ personal map camera per Campaign
  │   └─ language preference
  │
  │ protected same-origin API + secure session cookie
  ▼
Cloudflare Worker
  ├─ access/session authorization
  ├─ server-side role/scope enforcement
  ├─ domain + geometry validation
  ├─ revision/conflict checks
  └─ D1 repository
  ▼
Cloudflare D1
  ├─ Campaigns / Teams / Areas / Tasks
  ├─ shared revision + Campaign map focus
  └─ access grants + sessions
```

The website is not a native app and not an installable PWA. There is no service worker or Web App Manifest installation flow.

## Browser responsibilities

The browser owns:
- presentation and field interaction;
- map camera and local live/refining geolocation display;
- immediate optimistic UI state;
- active unsaved draw/edit geometry;
- personal camera/language preferences;
- last-known snapshot cache and conflict safety copies.

The browser is untrusted for authorization. Button visibility is never the permission boundary.

On the stable/rollback line synchronization uses the M5 mutation queue. The separate
`mission-rxdb-sync` line replaces its normal browser writer with an RxDB/Dexie
local replica: five entity collections replicate through authenticated Worker
pull/push endpoints, then materialize the same Campaign read model for React and
MapLibre. D1 remains canonical and the Worker retains validation, authorization,
revision claims and idempotency. The map-rendering boundary does not change.

## Worker responsibilities

The Worker owns:
- Campaign-scoped access/session resolution;
- Admin / Team Editor / Viewer authorization;
- Team Editor scope enforcement;
- admin recovery/bootstrap endpoints guarded by server-only configuration;
- schema, geometry and ownership validation;
- optimistic revision conflict handling;
- D1 persistence;
- future organization-scoped authorization when that architecture is implemented.

A Campaign id is a selector only, never a credential.

## D1 responsibilities

D1 is the shared source of truth for persisted Campaign state and authorization state. The browser never receives direct D1 credentials.

Production migration history is additive. Applied migrations are immutable history and must not be rewritten.

## Map boundary

Persistent saved geometry is rendered by MapLibre, not by a per-frame React/SVG/Canvas projection loop.

MapLibre owns:
- basemap;
- 2D camera pitch and live/refining geolocation follow;
- camera/navigation/geolocation control;
- saved Areas;
- saved Street Tasks;
- rendered-feature hit testing for saved Areas/Streets.

The SVG overlay exists only while drawing/editing a small amount of active geometry. Stored edit points are not visible in browse mode.

MapLibre is currently pinned to **5.7.1** because the tested 6.4.1 upgrade caused a real-browser GeoJSON rendering regression. Do not casually upgrade the map runtime without a browser acceptance test containing saved Area and Street GeoJSON.

See `docs/architecture/MAP.md` and ADR-0010.

## Access model

Current access is Campaign-scoped and uses revocable bearer grants redeemed into secure HttpOnly sessions.

Roles:
- Admin;
- Team Editor scoped to one Team;
- Viewer.

This model is the current Campaign authorization baseline, not the final multi-organization model. Future organization membership, multiple organization administrators and an Admin panel are planned separately and must preserve server-side scope enforcement.

See `docs/architecture/SECURITY.md` and `docs/architecture/ORGANIZATIONS.md`.

## Product expansion boundary

The current architecture deliberately leaves room for:
- durable offline/reconnect mutations;
- OSM-backed automatic street/task generation;
- House Mode;
- comments and activity history;
- rule-based automations;
- statistics/progress aggregation;
- organization-scoped administration;
- UI appearance themes.

Those are planned product capabilities, not assumptions already present in the current schema/API. Their sequencing and accepted scope live in `docs/product/ROADMAP.md` and the active product-platform plan.

## Deployment

Vite builds the React website. The Cloudflare Vite integration packages frontend assets and Worker code for Workers Static Assets. D1 is attached through the reviewed `DB` binding. Production operations are documented under `docs/operations/`.
