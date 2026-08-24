---
id: architecture-data
type: architecture
status: accepted
last_updated: 2026-08-24
related: [architecture-security, architecture-offline-sync, ADR-0009]
source_of_truth_for: [domain-data-model]
---

# Data Model

## Shared snapshot

The browser and Worker use the same Campaign/Team/Area/Task domain shape.

M4 snapshot schema v3 contains:
- `schemaVersion: 3`;
- shared `revision`;
- one Campaign;
- Campaign Teams;
- Campaign Areas;
- distribution Tasks.

D1 is the shared source of truth. localStorage remains the fast startup cache, last-known snapshot and fallback. Existing local schema v1 and M3 schema v2 snapshots migrate in-browser to v3 without deleting user data.

## Entities

### Campaign

One flyer distribution effort.

Domain fields:
- id;
- name;
- status;
- `defaultMapView` or null;
- createdAt;
- updatedAt.

`defaultMapView` is shared Campaign configuration with center longitude/latitude, zoom and bearing. It is the Aktionsfokus used only when a browser has no personal Campaign camera state.

The shared snapshot carries the Campaign `revision` at top level.

### Team

Named group within a Campaign.

Fields: id, campaignId, name, color, createdAt, updatedAt.

Within one Campaign, Team colors are unique so ownership remains visually distinguishable.

### Area

Geographic assignment owned by exactly one Team in the same Campaign.

Fields: id, campaignId, teamId, name, geometry, createdAt, updatedAt.

Geometry is a GeoJSON Polygon. Both client and Worker reject unusable geometry including too few/distinct vertices, out-of-range coordinates, degenerate area and self-intersection.

### Task

One distribution unit. The current task type is `street`.

Fields: id, campaignId, areaId, taskType, label, geometry, status, completedAt, createdAt, updatedAt.

Street geometry is a GeoJSON LineString manually traced over the basemap and assigned to an Area in the same Campaign. At least two distinct valid map points are required.

## Status vocabulary

- open
- completed
- later
- not-deliverable

`completedAt` is present when a Task is `completed` and null for the other statuses. D1 and Worker validation enforce this invariant.

## IDs

Use opaque application IDs. Browser-created entities use `crypto.randomUUID()` with entity prefixes. Sequential database IDs are not exposed as domain IDs or authorization secrets.

`?campaign=` is only a Campaign selector. Authorization is carried by M4 access/session credentials, never the Campaign id.

## D1 migrations

`migrations/0001_initial.sql` is applied M3 production history and must never be rewritten.

M4 adds `migrations/0002_m4_access.sql`.

### Existing domain tables

- `campaigns`: id, name, status, shared revision, internal write token, timestamps, plus nullable shared map-focus columns added by 0002;
- `teams`: Campaign ownership, name/color, timestamps, unique color per Campaign;
- `areas`: Campaign/Team ownership, Polygon JSON text, timestamps;
- `tasks`: Campaign/Area ownership, street LineString JSON text, status, `completed_at`, timestamps.

Composite foreign keys prevent Team/Area/Task relationships crossing Campaign boundaries. Geometry remains JSON text with semantic validation in the Worker.

### M4 access tables

`campaign_access_grants` stores:
- opaque grant id;
- Campaign id;
- role (`admin`, `team-editor`, `viewer`);
- optional Team id, required only for Team Editor;
- SHA-256 invite-token hash;
- optional operational label;
- created timestamp;
- nullable revoked timestamp.

`campaign_sessions` stores:
- opaque session id;
- backing grant id;
- Campaign id;
- SHA-256 session-secret hash;
- created timestamp;
- expiry timestamp.

Plaintext invite tokens and session secrets are not D1 fields.

Foreign keys keep every grant/session Campaign-scoped. Team Editor grants reference a Team in the same Campaign. Deleting their Team removes the scoped grant and its sessions through cascades.

## Internal write token

`campaigns.write_token` remains an implementation-only optimistic-concurrency guard. It is unrelated to M4 user access credentials and is never exposed as Campaign data.

A snapshot replacement still uses one constant-size seven-statement D1 batch:
1. claim the expected Campaign revision and install a fresh internal write token;
2. replace child rows only when that same write token is still owned by the request;
3. stale competing requests therefore cannot delete/insert child rows after losing the revision claim.

## Revision/version semantics

The Campaign revision is the coarse shared synchronization primitive.

Protected endpoints:
- `GET /api/campaigns/:campaignId/snapshot` returns current snapshot/revision;
- `GET /api/campaigns/:campaignId/version` returns only current revision;
- `PUT /api/campaigns/:campaignId/snapshot` includes the `baseRevision` the browser edited from.

Rules:
- all three require valid Campaign-scoped authorization;
- existing Campaign writes require `baseRevision` to match current server revision;
- successful replacement advances revision by one;
- stale write returns HTTP 409;
- Viewer writes return 403;
- Team Editor complete-snapshot writes are diff-authorized against the previous server snapshot;
- new Campaign creation is a dedicated creation flow rather than `baseRevision: null` on the protected PUT;
- pre-M4 Campaign ownership is established only through the explicit secured bootstrap flow.

## Browser-only data

The following are intentionally **not** shared Campaign data:
- language preference;
- personal last map center/zoom/bearing per Campaign;
- GPS history (none exists);
- active unsaved draw/edit/street draft.

Personal camera data is keyed by Campaign in localStorage and never uploaded just because the map moves.

## Browser cache and transition

M4 preserves the existing primary/backup localStorage snapshot instead of deleting it.

Safe transition:
1. render the existing local snapshot immediately;
2. migrate schema v1/v2 to v3 locally;
3. select Campaign from `?campaign=` when present, otherwise use the local Campaign id;
4. redeem an invite fragment or resolve an existing session before protected server reads;
5. if a legitimate new local Campaign has never existed on the server, use the dedicated create flow, which creates its first Admin grant/session;
6. existing M3 Campaigns without grants remain protected until explicit bootstrap;
7. preserve conflicting optimistic local data in `verteil-flyer:campaign-snapshot:conflict` before replacing it.

## Event history

An append-only mutation/event model remains future hardening work. M4 intentionally keeps complete snapshots with server-side role-aware diff validation. M5 may introduce a durable mutation queue and narrower writes.
