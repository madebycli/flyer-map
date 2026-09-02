---
id: architecture-security
type: architecture
status: accepted
last_updated: 2026-09-01
related: [architecture-data, architecture-offline-sync, product, product-roadmap, architecture-organizations, architecture-identity-permissions, architecture-live-teams, ADR-0009, ADR-0011, ADR-0012, ADR-0013, ADR-0021, ADR-0022, plan-012-platform-app-expansion]
source_of_truth_for: [authorization, privacy-baseline, current-access-model, m5-mutation-security, m5-5-offline-map-security, m6-smart-task-security, future-security-boundaries]
---

# Security and Privacy

## Baseline

The client is untrusted.

Every protected request is authorized and every state-changing payload is validated by the Cloudflare Worker. React/UI visibility, local queue state and mutation labels are conveniences, never authorization boundaries.

Campaign ids, future Organization ids, domain ids and M5 mutation ids are selectors/identifiers only. They are never credentials.

## Current Campaign access model

Current roles:
- `admin`;
- `team-editor` scoped to one Team;
- `viewer`.

| Capability | Admin | Team Editor | Viewer |
| --- | --- | --- | --- |
| Read Campaign snapshot/version | yes | yes | yes |
| Campaign settings/map focus | yes | no | no |
| Manage Teams | yes | no | no |
| Create/edit/delete Areas | yes | own Team only | no |
| Create/edit/delete Street/House Tasks/status | yes | own Team Areas only | no |
| Modify another Team | yes | no | no |
| Create/revoke Campaign Access Links | yes | no | no |
| Submit M5/M6 domain mutations | yes | own authorized scope only | no |
| Prepare local OSM map package | yes | yes | yes |

The Worker enforces scope on every write and protected data request.

M5/M6 mutation writes are converted into a current/candidate snapshot in the Worker and passed through the same existing authorization policy before D1 persistence. `POST /api/campaigns` is limited to validated revision-0 initial creation.

`PUT /api/campaigns/:id/snapshot` is retired. The Worker returns HTTP 410 with `legacy_snapshot_write_retired` before access resolution, payload processing, revision claim or D1 access. This prevents a client from bypassing scope through a complete-snapshot write.

## Current access grants and sessions

Access grant token:
- cryptographically strong random bytes;
- plaintext returned only when created;
- D1 stores SHA-256 hash, role/scope/metadata only.

Invite links carry tokens in URL fragments. Browser redeems the fragment and removes it from the URL.

Successful redemption creates a separate opaque session secret in a `Secure; HttpOnly; SameSite=Lax` cookie. D1 stores only its hash.

Every protected request resolves the session's backing grant. Revoking the grant invalidates backed sessions on their next protected request.

## Current Team Editor scope

Team Editor grant creation verifies that the scoped Team exists. Access resolution also verifies the Team still exists.

There is intentionally no D1 Team foreign key on the grant because this is the historical migration-0002 schema. Removing the legacy snapshot-replacement path does not silently add or alter that foreign key; see `docs/architecture/DATA.md`.

For mutations, Team Editor scope is not inferred from client mutation payload alone. The Worker:
1. loads canonical current snapshot;
2. applies the proposed mutation in memory;
3. validates the candidate snapshot;
4. compares current/candidate through the existing snapshot authorization policy;
5. persists only if allowed.

House Tasks use the same Area -> Team ownership rule as Street Tasks. An optional House parent Street never expands authority: both House Area and parent Street must remain in the same Campaign/Area.

## M5 mutation request security

Protected endpoint:
- `POST /api/campaigns/:campaignId/mutations`.

Controls:
- same-origin write protection applies before route handling;
- valid Campaign session/grant required;
- Viewer rejected before mutation persistence;
- Campaign id in the payload must match the protected route Campaign;
- mutation id/type/base revision/createdAt/payload are schema validated;
- request body is size limited;
- resulting Campaign snapshot is fully validated before persistence;
- existing Worker authorization policy is authoritative;
- D1 revision/write-token claim protects concurrent persistence;
- mutation idempotency ledger prevents duplicate replay effects.

A stable mutation id allows safe retry. It does not authorize the retry. Every retry still resolves current access first.

If an already-applied mutation id is replayed, the Worker returns its previous applied revision only after the request has passed protected access resolution. The ledger is not a public lookup service.

## M5.5 prepared offline map request security

Protected endpoint:
- `POST /api/campaigns/:campaignId/offline-map/package`.

The OSM source data is public, but the application endpoint is deliberately Campaign-authenticated to reduce anonymous proxy abuse and preserve one consistent protected API boundary.

Controls:
- same-origin protection applies;
- a valid non-revoked Campaign session/grant is required for Admin, Team Editor or Viewer;
- the client may provide only ordinary JSON data such as center and radius; arbitrary Overpass query text is never executed;
- center coordinates and radius are validated server-side;
- radius is hard-capped at 3,000 m;
- Overpass-compatible query text is built only from a fixed server-owned template and validated numeric values;
- upstream URL is server configuration, not a client parameter, and requires HTTPS outside localhost development;
- request bytes, upstream response bytes and final package bytes are bounded;
- upstream fetch has a fixed timeout;
- only reviewed OSM tags are copied into the normalized package;
- OSM tag values including HTML/JavaScript/SQL-looking text remain inert strings and are never evaluated/rendered as raw HTML;
- the Worker returns a versioned package only after structural validation;
- error responses do not expose upstream payloads, session secrets or private Campaign data.

The route does not write OSM data into D1 and does not include Campaign snapshot/private domain data in the downloaded OSM package.

Worker error logging for this route must never log request bodies, cookies, Access Link tokens, session secrets or raw upstream data. A stable error category/name is sufficient for operational diagnosis.

## M6 Smart Street and House persistence security

ADR-0013 separates durable application identity from external OSM provenance.

Shared boundaries:
- every new Smart Street/House uses an application-owned generated `task_*` id;
- OSM way ids remain ordinary non-secret provenance values and never authorize access;
- reviewed geometry is copied into Campaign-owned snapshots rather than being a live remote reference;
- unexpected nested provenance fields are rejected at the Worker validation boundary rather than persisted by object spreading;
- source/geometry values are passed through D1 prepared/parameterized bindings and never concatenated into SQL;
- malformed stored provenance is treated as invalid stored data, not evaluated content;
- OSM labels/tags remain inert text if later surfaced alongside provenance ids.

Street-specific boundaries:
- reviewed Street geometry is a validated LineString snapshot;
- Street source accepts `OpenStreetMap` / `way` / positive unique `objectIds`;
- existing reviewed Street geometry/source is immutable through ordinary rename/status writes; a full-snapshot write is not an available compatibility path.

House-specific boundaries:
- reviewed House geometry is a validated Polygon footprint snapshot;
- OSM House provenance, when present, is exactly one positive Way id;
- `parentStreetTaskId`, when present, must resolve to a Street Task in the same Campaign and same Area;
- House geometry, provenance and parent relation are immutable through ordinary House rename/status writes;
- deleting a parent Street may only clear the optional parent relation, never silently delete/reassign the House;
- House ids must not collide with Street Task ids inside a Campaign snapshot;
- Team Editors may create/edit/delete Houses only inside Areas owned by their scoped Team.

Migration boundaries:
- `0004_m6_task_source_provenance.sql` and `0005_m6_house_tasks.sql` are not remotely applied merely because they exist in a branch/PR;
- before the required schema exists, affected M6 writes return explicit `schema_migration_required` before Campaign revision claim;
- House data must never be silently discarded or coerced into the Street table for compatibility.

A future OSM source reconciliation must be a dedicated explicit reviewed mutation with its own authorization and conflict semantics.

## Automatic Area preparation security

ADR-0021 keeps automatic work generation inside the Worker authorization and persistence boundary.

- only a successful persisted, non-replayed Area create or geometry mutation may schedule work; a rename or Team reassignment does not;
- the Worker loads the Area from canonical D1 state and derives the bounded OSM request itself. The preparation route accepts no client BBox, polygon or Overpass text;
- the status read requires ordinary Area read access. Start/retry requires Admin or a Team Editor for that exact Area Team; Viewers and Field Group members cannot start it;
- the bounded OSM request retains the fixed 3 km, request-size, response-size, timeout, normalizer/allowlist and feature-cap controls of the existing offline-map boundary. Raw upstream payloads are not persisted or exposed;
- generated Task identity and `areaPreparationGeneration` are server-owned. A client cannot create, delete or rewrite automatic identity through a normal mutation, although normal authorized Task status changes remain available;
- once automatic work begins, a geometry rewrite would invalidate completed work, so it returns `area_has_started_work`. Deleting the complete Area follows the scoped foreign-key cascade;
- migration 0014 is required for this path and fails closed as `area_preparation_schema_unavailable`; no remote migration is performed by a request.

No credential, account, role, TOTP or GPS behavior is introduced by this M6 slice.

## Queue and revocation behavior

IndexedDB queue records may contain domain mutation payloads necessary to retry saved work. They do not contain plaintext Access Link tokens or session secrets.

Smart Street/House create payloads may include reviewed geometry and OSM way provenance. Those values are operational domain data, not credentials.

When a queued request receives 401/403:
- the record remains locally preserved;
- queue state becomes `blocked-auth`;
- ordered automatic retry stops;
- the client must not blindly hammer a revoked credential.

A later valid access session may allow the queue to resume, but the Worker re-authorizes every mutation against current canonical state.

Prepared offline OSM packages are separate browser-local public map data. They must not be used as credentials or as proof of current Campaign authorization.

## Current bootstrap / operator recovery

Legacy Campaigns are never assigned to the first visitor.

Initial bootstrap/recovery remains protected by the server-only configured secret flow described by current accepted ADR/docs.

Campaign id alone never creates ownership.

Operator recovery remains a privileged operator mechanism, not an ordinary account login system. M5/M6 does not weaken or replace it.

## Request protections

Current and future protected routes require:
- valid authorized server-side session/credential state;
- payload schema/size/domain validation;
- revision/conflict handling rather than silent overwrite where state is changed;
- same-origin/CSRF protections where applicable;
- secrets verified server-side only.

## Future Organizations and accounts

Multi-organization administration is planned but not implemented by current Campaign roles.

Before implementation, accepted ADR(s) and threat-model review must define:
- Organization identity/membership/session behavior;
- username/password/TOTP account security;
- role/capability semantics;
- legacy Campaign Admin migration.

Mandatory properties:
- Organization is tenant boundary;
- no cross-Organization reads/writes/statistics/comments/activity;
- multiple Organization Admins supported;
- safe admin handover/recovery;
- Campaign Admin is not silently treated as Organization Admin;
- membership/revocation enforced server-side;
- privileged admin/permission/security actions audited.

M5 mutation ids/idempotency do not establish Organization identity. Future tenant scope must be added explicitly to the authorization/data model.

See `docs/architecture/ORGANIZATIONS.md` and `docs/architecture/IDENTITY_PERMISSIONS.md`.

## Future username/password/TOTP security

Requested administrator login model:
- username;
- password;
- authenticator-app TOTP;
- no SMS requirement;
- no mandatory email identity.

Security requirements:
- raw passwords never stored or logged;
- reviewed password hashing strategy with unique salts and appropriate cost;
- no home-grown password cryptography;
- TOTP secrets generated securely and protected at rest;
- TOTP codes/secrets never logged;
- login creates/rotates opaque revocable sessions;
- login/TOTP endpoints rate-limited;
- narrow server-side TOTP time tolerance;
- security-sensitive recovery/reset audited;
- last effective Organization Admin cannot be accidentally removed without safe transfer/recovery.

## Injection resistance

All user-controlled input is inert data.

Mandatory:
- never concatenate username/password/code/comment/form/OSM input into SQL;
- use D1 prepared/parameterized queries;
- never pass user input to `eval`, dynamic code execution, shell execution or raw HTML rendering;
- safely encode output;
- prefer a restrictive CSP;
- validation helps correctness but security must not depend on blacklisting suspicious strings.

If an attacker types SQL, HTML, JavaScript or other code-like text into a username/password/form field, it must remain data and never execute.

The same rule applies to external OSM tags and provenance metadata: code-like text from map data remains inert data and is not executable content.

## Future capability authorization

Future configurable permissions must be evaluated server-side on every privileged operation.

Rules:
- deny by default;
- Organization boundary cannot be overridden;
- UI toggles do not grant permission;
- permission changes are audited;
- authentication and authorization remain separate steps.

## Live Field Group security

Future live groups/QR/team codes must not become backdoors around persistent access policy.

Requirements:
- discoverability limited to authorized Campaign context;
- no public internet directory;
- random/non-sequential temporary codes;
- expiry/revocation;
- rate limiting/brute-force resistance;
- optional join passwords handled as secrets, not plaintext storage;
- QR contains minimum required join material;
- Field Group join never grants Admin automatically;
- temporary group credentials are distinct from persistent Team/Admin invites.

See `docs/architecture/LIVE_TEAMS.md`.

## Comments, activity, sessions and statistics

Future collaboration/reporting endpoints enforce server-side scope.

Automations cannot bypass caller/system authorization.

Statistics/session highlighting derives from Task/domain events, not continuous GPS surveillance.

## GPS and presence privacy

The product does not upload/persist continuous device location history by default.

One-shot browser location may orient the map. Personal center/zoom/bearing remains local browser preference unless explicitly shared through authorized Campaign configuration.

Future live groups may expose limited operational presence where useful, but must not require exact live GPS trails or permanent device fingerprinting.

## Secrets

Never commit or paste into normal project communication:
- Cloudflare API tokens;
- bootstrap/recovery secrets;
- plaintext production Access Links/tokens;
- session secrets;
- passwords;
- TOTP secrets/codes;
- private Campaign/Organization exports.

A D1 database id is configuration, not a credential.

## Data minimization

Collect only data needed for explicit product/security requirements.

M5 stores only domain payload and metadata needed to deliver/reconcile queued saved work. It does not add GPS history, device profiling or user tracking.

Prepared offline OSM packages contain public map geometry/metadata and local package metadata only. They do not need user identity, continuous GPS history or private Campaign state.

M6 Smart Street/House persistence stores only reviewed route/building geometry plus OSM Way ids needed for source traceability. It does not store raw Overpass responses, browsing history or device location trails in D1.

Field Sessions may store operational values such as date, duration, participant count and Task events. They should not become individual movement surveillance.

Future Organization identity should not collect email/phone merely because account systems often do so if username/password/TOTP meets the accepted product/security design.

See ADR-0009 for Campaign access/session, ADR-0011 for durable mutation/idempotency behavior, ADR-0012 for the prepared offline-map data boundary and ADR-0013 for Smart Street/House identity and reviewed source snapshots.
