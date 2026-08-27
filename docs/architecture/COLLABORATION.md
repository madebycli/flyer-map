---
id: architecture-collaboration
type: architecture
status: active
last_updated: 2026-08-27
related: [product-roadmap, architecture-data, architecture-security, architecture-offline-sync, architecture-live-teams, plan-012-platform-app-expansion, ADR-0017, ADR-0018]
source_of_truth_for: [field-session-foundation, future-comments, future-activity, future-automations, future-statistics]
---

# Collaboration, Field Sessions, Activity, Automations and Statistics

## Purpose

Record the accepted collaboration/history boundary and distinguish the durable Field Session foundation already implemented for Field Group close/expiry from the broader FC2 features that are still pending.

ADR-0017 is accepted and governs Field Session/event retention. ADR-0018 continues to govern future action/template and cross-action analytics persistence.

## Current durable Field Session foundation

A Field Session represents one concrete outing/work period by a Team or temporary Field Group.

The first durable slice is tied to Field Group end state and stores only explicit operational data:
- stable application-owned id;
- Campaign id;
- Team id;
- Field Group id;
- distribution/collection mode;
- start/end timestamps;
- duration;
- participant count when explicitly known;
- person-time when participant count is known;
- lifecycle status and timestamps.

No walked/driven route is stored.

### Manual close

Normal manual close requires a final participant count. The group transition and durable session/event history are bound to the same D1 transaction once migration 0007 is present.

The session stores duration, participant count and person-time. A deduplicated `field_session.closed` domain event is appended.

### Safety expiry

The 24-hour Field Group expiry is a safety fallback, not a normal user-completed tour.

Expired groups still receive durable history so the outing does not disappear. If no participant count was ever explicitly recorded, participant count and person-time remain unknown instead of being fabricated. The event type is `field_session.expired`.

## Person-time

Person-time is duration multiplied by explicit participant count.

It is an operational planning metric, not a worker-ranking metric. Do not derive it from GPS presence, joined-device count or continuous location history.

## Domain events

ADR-0017 accepts append-only minimized domain events.

Current implemented minimum:
- `field_session.closed`;
- `field_session.expired`.

Broader event types are added only with the feature slice that authoritatively owns the underlying mutation.

Candidate FC2 events include:
- Area created/renamed/geometry changed;
- Task created/status changed/deleted;
- Team created/renamed/color changed/archived;
- Field Session started/closed;
- Pickup status changes;
- comment created/edited/deleted according to the accepted comment policy;
- deterministic automation executions.

Events never contain unrestricted request bodies, credentials, raw exports, full Campaign snapshots or continuous GPS trails.

## Idempotency and authority

The client does not manufacture authoritative history.

A domain event is created only when the underlying server-authorized operation applies. Retry/replay must not duplicate history.

For the current Field Group end-state slice:
- deterministic Field Session relationship prevents duplicate sessions;
- Campaign-scoped event dedupe keys prevent duplicate close/expiry events;
- the Worker blocks normal manual close until the required 0007 history schema exists.

When Task mutations gain event attribution, event creation must participate in the accepted M5 idempotency/transaction model or an equivalent deterministic relation to the applied mutation.

## Session work and map highlighting, FC2

Future session history should relate work to actual Task/domain events created or changed while the session is active.

Accepted direction:
- domain events reference `field_session_id` where applicable;
- session summaries derive affected Task ids from events;
- map highlight uses current/reviewed Task geometry;
- no continuous route polyline is stored merely to recreate an outing;
- exact historical geometry versioning is not required for v1 reflection.

This remains FC2 work and is not implied by the current close/expiry foundation.

## Comments, FC2

Comments remain not yet durable feature-complete runtime.

They may attach to explicit contexts such as:
- Campaign;
- Area;
- Street/House/Pickup Task;
- optionally Field Session where product testing justifies it.

Before durable implementation:
- server-authorized read/write scope is required;
- edit/delete/moderation semantics must be explicit;
- user text remains inert data;
- no unnecessary personal profile collection;
- event payload must not duplicate unrestricted comment bodies unless a specific accepted requirement needs it.

## Activity history, FC2

The Activity feed will be a projection of meaningful normalized events, not raw HTTP/database logs.

It supports:
- operational auditability;
- session reconstruction;
- map reflection;
- progress/statistics explanation.

Security-sensitive audit logging remains separate from ordinary product `domain_events` where stronger retention/restriction is required.

## Automations, FC2+

Automations are deterministic domain rules, not opaque AI actions.

Candidate rules:
- new Area -> propose/generate reviewed road Tasks;
- all child House Tasks complete -> optionally complete parent Street;
- accepted status mutation -> append normalized activity event;
- progress threshold -> surface coordinator indicator;
- session close -> derive summary;
- sync/retry state -> surface manual-action warning.

Requirements:
- explicit trigger/effect;
- authorization preserved;
- idempotent effects;
- observable success/failure;
- no hidden high-frequency polling requirement.

## Statistics

Statistics remain operational, not behavioral surveillance.

### Current/future source model

Use:
- current Tasks for current progress denominators;
- Field Sessions for outings/duration/participants/person-time;
- domain events for work performed over time/session;
- action/template relationships for repeated-round comparison once ADR-0018 is accepted.

Do not add rollup tables initially. Add rollups only after measured query/scale need.

Every percentage names its denominator. Street, House, Distribution and Collection/Pickup units are not silently mixed.

## Retention and deletion

Accepted ADR-0017 policy:
- meaningful operational Field Sessions/events remain with Campaign/action history;
- no automatic age-based cleanup for ordinary operational history;
- Team identity referenced by retained history is archived/tombstoned rather than casually hard-deleted;
- permanent Campaign deletion is a future explicit destructive Admin operation and is outside the current runtime;
- security/legal audit retention, if later required, is separate from ordinary product history.

## Organization interaction

Once Organizations exist:
- comments/events/sessions/statistics remain tenant-scoped;
- Admin aggregation is only within authorized Organization/Campaign scope;
- capability checks remain server-side;
- account/admin audit data stays separated from ordinary field Activity where required.

## Field UI boundary

Field UI should stay compact:
- session start/close/feedback;
- concise history/activity access;
- comments in relevant context;
- progress context;
- session selection and optional map highlight.

Do not turn the map into a giant analytics dashboard.

Richer filtering, exports, statistics and audit views belong in Admin/analytics surfaces.

## Privacy

Collect only explicit operational data needed by the product:
- Task/event changes;
- duration;
- participant count;
- optional note when implemented;
- authorized group/session state.

Do not infer exact walked/driven routes or individual productivity from continuous GPS.

## Rollout status

`migrations/0007_field_sessions_events.sql` is prepared on Draft PR #72 but is not recorded as remotely applied. Broader FC2 schema/runtime remains intentionally unimplemented until its feature-complete slice.
