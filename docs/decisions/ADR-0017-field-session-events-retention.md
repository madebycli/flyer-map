---
id: ADR-0017
type: decision
status: proposed
date: 2026-08-26
---

# ADR-0017: Field Session, domain event and statistics history model

## Status

Proposed only. Product direction is now clear that meaningful operational history is retained and exact historical geometry reconstruction is **not required for v1 reflection**. D1 schema implementation remains blocked on archive/permanent-deletion and final security/audit retention semantics.

## Context

Plan 012 needs:
- Field Sessions with date/duration/participant count/note;
- history showing work performed;
- repeated flyer/collection actions that can be compared later;
- selecting a past action/session and reflecting affected work on the map;
- operational statistics such as outings, person-time and Area sizing;
- comments/activity/automation auditability;
- exportable Admin analysis data;
- no continuous GPS surveillance.

Current M5 mutations already provide durable offline/reconnect behavior for Campaign state changes, but the current snapshot is not sufficient to reconstruct historical sessions after later Task edits.

The collaboration architecture therefore uses meaningful domain events rather than GPS traces.

## Proposed direction: append-only minimal domain events plus durable Field Sessions

### Field Session

A durable Field Session should use an application-owned id and store only explicit operational data:

```text
field_session
- id
- campaign_id
- team_id
- optional field_group_id
- mode: distribution | collection
- started_at
- ended_at or duration_minutes
- participant_count
- optional note
- status: active | closed
- created_at / updated_at
```

Session does not store a walked/driven route.

### Domain event

Meaningful actions append a versioned event:

```text
domain_event
- id
- campaign_id
- optional team_id
- optional field_session_id
- entity_type
- entity_id
- event_type
- occurred_at
- actor_kind / actor_reference when available and authorized
- payload_version
- small structured payload
```

Events are append-only from normal product flows. Corrections happen by later events/current-state mutations rather than rewriting old history silently.

## Event payload minimization

Retaining history does not mean retaining unrestricted request bodies or whole snapshots.

Do not store whole Campaign snapshots or unrestricted before/after JSON blobs in every event. Payload contains only fields needed to understand the event later.

Examples:
- `task.status.changed`: task id, previous status, new status;
- `task.created`: task id/type/source summary;
- `area.created`: area id/team id;
- `field-session.closed`: final duration/participant summary if not already on session row;
- `comment.created`: comment id/target reference, not duplicated full comment body unless required;
- `automation.executed`: rule type/result code, no secrets;
- access/admin/security audit events use a dedicated safe payload policy and never include credentials.

No event payload may include:
- password;
- TOTP code/seed;
- recovery code;
- session/access/join secret;
- exact continuous GPS trail;
- arbitrary raw request body;
- full private export.

## Session/action reflection on the map

Session/action history should derive affected Task ids from events and retained Task relationships.

Confirmed v1 direction:
- historical map view is primarily for reflection, not forensic geometry reconstruction;
- current/reviewed Task geometry is sufficient to show where historical work happened;
- the system does **not** need to duplicate every historical geometry revision merely so an old session can be opened;
- if a historical Task was superseded/archived, keep enough retained reference/tombstone information to make the log understandable;
- exact historical geometry may be added later only if real use proves it valuable.

This keeps history useful without turning every geometry edit into a full GIS versioning system.

## Statistics

Initial statistics derive from:
- current Tasks for current completion percentages;
- Field Sessions for duration/participant/person-time summaries;
- domain events for work performed per session/time period/action;
- action/template relationships for repeated-round comparison once ADR-0018 is accepted.

Do not add precomputed rollup tables initially. Add rollups only if measured scale proves query cost requires them.

Every percentage keeps an explicit denominator. Distribution and Pickup remain separate units.

## Actor identity minimization

Current Campaign access sessions may not have a human account identity. Future Organization accounts will.

Event actor fields therefore must tolerate:
- Organization account reference;
- scoped access-grant/session actor reference where safe;
- system/automation actor;
- unknown/legacy actor when historical migration cannot provide identity.

Do not create unnecessary personal profiles solely for event history.

Display labels are not durable authorization identity.

## Confirmed product retention direction: retain operational history

Operational history should not automatically disappear after 12/24 months or through tiered feed expiry.

For the initial product direction:
- Field Sessions are retained with the Campaign/action history;
- domain events are retained with the Campaign/action history;
- Task/event relations required for historical understanding are retained;
- statistics may continue to derive from retained history;
- there is no automatic age-based cleanup for ordinary operational history in the initial design.

This corresponds to the earlier R1 option.

The retained records still follow payload minimization. "Keep everything" means keep the product's meaningful operational history, not secrets, raw HTTP bodies, GPS trails or redundant full Campaign snapshots.

### Consequences

Benefits:
- coordinators can compare repeated flyer/collection rounds over long periods;
- session/action statistics do not develop arbitrary time gaps;
- problem Areas and workload imbalance can be analyzed later;
- Admin export can use a complete operational history;
- no cleanup scheduler is required for the first implementation.

Costs:
- D1 storage grows with product usage;
- explicit Campaign/Organization deletion/export policy becomes important;
- query/index/export design must remain bounded as history grows;
- future scale may justify archival infrastructure, but not silent history expiry.

## Team archive/delete interaction

Do not hard-delete Team identity when retained sessions/events reference it.

Preferred direction:
- archive/tombstone Team;
- retained history keeps referentially understandable Team identity;
- permanent destructive deletion requires explicit history handling and confirmation.

## Offline mutation relationship

A client queues the domain mutation through the accepted M5 mechanism.

The Worker creates the corresponding event only when the domain mutation is authoritatively applied. Replaying the same idempotent mutation must not create duplicate domain events.

Event append must therefore participate in the same idempotency/transaction boundary or use a deterministic unique relation to the applied mutation.

The client must never manufacture authoritative audit/event history independently of server application.

## Admin analytics export relationship

ADR-0018 proposes an Admin-only analysis package derived from retained operational history.

Export should consume normalized/allowlisted session/event/statistics data rather than dumping raw database rows. Comment bodies, session free-text notes, credentials and GPS trails are excluded from the initial AI-analysis dataset.

## Security and authorization

- event/session reads are Campaign/Organization scoped server-side;
- event append follows authorization of the underlying domain operation;
- Field Session create/close requires explicit capability once permissions exist;
- analytics export requires explicit Admin/Organizer capability;
- all D1 statements remain prepared/parameterized;
- arbitrary user input remains inert text;
- event APIs return only authorized tenant data;
- no event id/resource id is treated as a credential.

## Rejected: GPS-derived session history

Do not infer session work, participant time or productivity from continuous location traces.

Task/domain events plus explicit duration/participant count are sufficient for the requested operational planning features.

## Rejected: full snapshot per mutation/event

Reason:
- excessive storage;
- duplicates unrelated private data;
- harder retention/redaction;
- unnecessary for session task highlighting and normal activity history.

## Rejected for v1: exact geometry snapshot for every historical edit

Reason:
- the requested history is primarily for reflection/statistics and future planning;
- retained Task/event references plus current/reviewed geometry are sufficient initially;
- full geometry versioning would add major storage/query/reconciliation complexity before there is evidence it is needed.

## Remaining acceptance decisions

1. Define Campaign/action archive vs permanent deletion behavior for retained sessions/events.
2. Define comment edit/delete event semantics once comment moderation policy is chosen.
3. Define security/audit retention if it must differ from ordinary operational history.
4. Accept the final action/template linkage and export boundaries in ADR-0018 before cross-action analytics persistence.

## Implementation gates after acceptance

- additive D1 migration only for active M7 slice;
- event type registry is hardcoded/versioned, not arbitrary executable rules;
- M5 idempotency test proves retry does not duplicate event;
- cross-Campaign/Organization negative authorization tests;
- session close metrics reconcile with explicit duration/participants;
- session affected Task ids reconcile with event relations;
- no GPS trail or secret appears in event payload/logging;
- retention/deletion behavior has explicit tests and operational documentation.
