---
id: ADR-0017
type: decision
status: accepted
date: 2026-08-27
---

# ADR-0017: Field Session, domain event and statistics history model

## Status

Accepted on 2026-08-27 for durable Field Sessions and minimized operational domain-event history.

The accepted v1 model retains meaningful operational history for the lifetime of its Campaign/action, does not persist continuous GPS routes, and does not require exact historical geometry reconstruction. Team archive/tombstones preserve understandable history. Ordinary product flows do not hard-delete Teams that retained history references.

Permanent Campaign deletion is deliberately outside the initial Field Session runtime. If it is introduced later, it must be a separate explicitly confirmed Admin operation that removes the Campaign-owned operational history with the Campaign instead of leaving orphaned session/event data. Security/audit retention remains a separate security concern and is not modeled by ordinary product `domain_events`.

Comment edit/delete/moderation event semantics remain gated to the comment slice and do not block the Field Session foundation accepted here.

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

## Accepted direction: append-only minimal domain events plus durable Field Sessions

### Field Session

A durable Field Session uses an application-owned id and stores only explicit operational data:

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

For the initial FC1 group-close integration, the minimum durable event is `field_session.closed`. Broader Task/comment/activity event coverage is added only with the corresponding feature-complete slice.

## Event payload minimization

Retaining history does not mean retaining unrestricted request bodies or whole snapshots.

Do not store whole Campaign snapshots or unrestricted before/after JSON blobs in every event. Payload contains only fields needed to understand the event later.

Examples:
- `task.status.changed`: task id, previous status, new status;
- `task.created`: task id/type/source summary;
- `area.created`: area id/team id;
- `field_session.closed`: final duration/participant summary if not already on session row;
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

Session/action history derives affected Task ids from events and retained Task relationships.

Accepted v1 direction:
- historical map view is primarily for reflection, not forensic geometry reconstruction;
- current/reviewed Task geometry is sufficient to show where historical work happened;
- the system does **not** duplicate every historical geometry revision merely so an old session can be opened;
- if a historical Task is later superseded/archived, keep enough retained reference/tombstone information to make the log understandable;
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

Event actor fields therefore tolerate:
- Organization account reference;
- scoped access-grant/session actor reference where safe;
- system/automation actor;
- unknown/legacy actor when historical migration cannot provide identity.

Do not create unnecessary personal profiles solely for event history.

Display labels are not durable authorization identity.

## Retention: keep operational history with the Campaign

Operational history does not automatically disappear after 12/24 months or through tiered feed expiry.

Accepted v1 policy:
- Field Sessions are retained with the Campaign/action history;
- domain events are retained with the Campaign/action history;
- Task/event relations required for historical understanding are retained;
- statistics may continue to derive from retained history;
- there is no automatic age-based cleanup for ordinary operational history;
- no cleanup scheduler is required for the first implementation.

The retained records still follow payload minimization. "Keep history" means keep the product's meaningful operational history, not secrets, raw HTTP bodies, GPS trails or redundant full Campaign snapshots.

### Consequences

Benefits:
- coordinators can compare repeated flyer/collection rounds over long periods;
- session/action statistics do not develop arbitrary time gaps;
- problem Areas and workload imbalance can be analyzed later;
- Admin export can use a complete operational history;
- no cleanup scheduler is required for the first implementation.

Costs:
- D1 storage grows with product usage;
- explicit permanent Campaign deletion/export remains a privileged product operation if introduced later;
- query/index/export design must remain bounded as history grows;
- future scale may justify archival infrastructure, but not silent history expiry.

## Team archive/delete interaction

Do not hard-delete Team identity when retained sessions/events reference it.

Accepted behavior:
- ordinary lifecycle uses archive/tombstone Team identity;
- retained history keeps referentially understandable Team identity;
- current Field Session work does not introduce a Team hard-delete operation;
- a future destructive Team-history deletion would require its own accepted behavior and explicit confirmation.

## Campaign permanent deletion

Permanent Campaign deletion is not part of the initial Field Session/Event feature.

If introduced later:
- it is a separate explicitly confirmed Admin-level destructive operation;
- it deletes or otherwise permanently removes Campaign-owned operational sessions/events together with the Campaign according to the then-accepted Organization/deletion policy;
- it must not leave orphaned historical rows or silently retain ordinary operational content that the user explicitly chose to permanently delete;
- security/legal audit retention, if later required, is handled by its own restricted audit policy rather than ordinary product `domain_events`.

This keeps the initial retention model simple while avoiding a misleading promise that operational history can never be intentionally deleted.

## Offline mutation relationship

A client queues the domain mutation through the accepted M5 mechanism.

The Worker creates the corresponding event only when the domain mutation is authoritatively applied. Replaying the same idempotent mutation must not create duplicate domain events.

Event append must therefore participate in the same idempotency/transaction boundary or use a deterministic unique relation to the applied mutation.

The client must never manufacture authoritative audit/event history independently of server application.

For Field Group close, the server-owned Group id supplies the deterministic session relationship. Replaying the same successful close returns the existing closed Field Session instead of creating another one.

## Admin analytics export relationship

ADR-0018 proposes an Admin-only analysis package derived from retained operational history.

Export consumes normalized/allowlisted session/event/statistics data rather than dumping raw database rows. Comment bodies, session free-text notes, credentials and GPS trails are excluded from the initial AI-analysis dataset.

## Security and authorization

- event/session reads are Campaign/Organization scoped server-side;
- event append follows authorization of the underlying domain operation;
- Field Session create/close requires explicit capability once permissions exist;
- during the legacy Campaign-role transition, Field Group close inherits the already-authorized group-management boundary from accepted ADR-0014;
- analytics export requires explicit Admin/Organizer capability;
- all D1 statements remain prepared/parameterized;
- arbitrary user input remains inert text;
- event APIs return only authorized tenant data;
- no event id/resource id is treated as a credential;
- ordinary product events never substitute for restricted security/audit logging.

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

## Deferred decisions that do not block Field Sessions

1. Comment edit/delete/moderation event semantics are decided with the feature-complete comments slice before comment-event persistence.
2. Organization-wide permanent deletion/export policy is finalized with accepted Organization/Admin runtime before those destructive controls are exposed.
3. Security/audit retention may differ from ordinary operational history and remains governed by a separate restricted audit policy.
4. Final action/template linkage and export boundaries remain governed by ADR-0018 before cross-action analytics persistence.

## Implementation gates

- additive D1 migration only for the active Field Session/Event slice;
- event type registry is hardcoded/versioned, not arbitrary executable rules;
- M5/idempotency tests prove retry does not duplicate events;
- cross-Campaign/Organization negative authorization tests;
- session close metrics reconcile with explicit duration/participants;
- session affected Task ids reconcile with event relations once Task events are added;
- no GPS trail or secret appears in event payload/logging;
- no ordinary Team hard-delete is introduced while retained history references Team identity;
- retention/deletion behavior is documented operationally before destructive deletion runtime is exposed.
