---
id: architecture-collaboration
type: architecture
status: active
last_updated: 2026-08-28
related: [product-roadmap, architecture-data, architecture-security, architecture-offline-sync, architecture-live-teams, plan-012-platform-app-expansion, ADR-0017, ADR-0018, ADR-0019]
source_of_truth_for: [field-session-foundation, comments, activity, future-automations, future-statistics]
---

# Collaboration, Field Sessions, Activity, Automations and Statistics

## Purpose

Record the accepted collaboration/history boundary and distinguish the durable Field Session, Comment, Activity, Statistics and deterministic Automation runtimes from future broader automation features.

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

The M5 mutation runtime additionally emits:
- `task.status.changed` for an authoritatively applied Street-/House-Task-Statuswechsel;

The durable Comment runtime additionally emits:
- `comment.created`;
- `comment.edited`;
- `comment.deleted`.

The deterministic Automation runtime additionally emits:
- `automation.executed`.

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

Task event creation participates in the accepted M5 idempotency/transaction model. The event and the applied mutation share the Campaign revision/write-token batch boundary; a replayed mutation returns the existing result and does not append another event.

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

Comments are now a durable runtime for Campaign, Area, Street Task and persisted House Task contexts. Pickup is intentionally unsupported until a real persistent Pickup model exists. Field Sessions are not comment targets in this slice.

### Stored model and lifecycle

Migration 0008 adds one additive `comments` table with:
- stable Comment id and Campaign id;
- explicit target type/id;
- current Team scope for non-Campaign targets;
- only the safe access principal kind/reference available from the legacy access model;
- trimmed body, created/updated timestamps, monotonic version and tombstone fields.

Polymorphic target IDs are never trusted by themselves. The Worker resolves Campaign, Area, Street Task or House Task in the requested Campaign and derives the current Team scope before serving the context or applying a mutation. Removed targets fail closed for normal Comment reads and writes while the Comment row remains as historical reference. There is no normal product hard delete.

Bodies are ordinary inert text. The Worker trims them, requires a non-empty value and enforces a 2000-character maximum. The UI renders them as React text. A soft delete clears the stored body, sets `deleted_at`, advances the version and keeps the stable id and necessary metadata. Reads expose the tombstone as `Kommentar gelöscht` and never return the deleted body.

### Authorization matrix

The Worker remains authoritative:

| Access | Read | Create | Edit/Delete moderation |
| --- | --- | --- | --- |
| Admin | within Campaign | all supported targets in Campaign | all supported targets in Campaign |
| Team Editor | Campaign plus current own-Team targets | current own-Team targets | current own-Team targets only |
| Viewer | Campaign-scoped read | no | no |
| Temporary Field Group member | current own-Team target scope | current active Campaign-/Team-/Group scope | no self exception |

The legacy access model does not safely identify a human author. Therefore Comment creation stores a safe campaign-grant or temporary-membership principal only as historical actor reference. It is not treated as a person identity, and no Self-Edit/Self-Delete capability is inferred. This conservative rule stays in force until a separately accepted identity model can support a reliable author mapping. Temporary membership never creates persistent Team or Admin rights. Team Editor and Admin moderation still re-check the target's current scope.

### Events and retries

Comment events use the existing minimized `domain_events` table. Their columns carry only the Comment entity id, target-derived Team id, actor principal, event type, occurrence time and dedupe key. `payload_json` contains only the normalized Comment version. It never contains the full body, cookies, tokens, secrets, raw request bodies, GPS data or snapshots.

Create uses a stable Comment id. Edit uses `updated_at` plus an operation id. Delete uses an idempotent operation id and never issues `DELETE FROM comments`. The Comment mutation and its event are written in one prepared D1 batch. Replaying an accepted operation returns the current result and does not append a second event.

### API and offline boundary

The API is intentionally narrow:
- `GET /api/campaigns/:campaignId/comments?targetType=...&targetId=...` reads one context with a stable cursor and a maximum page size of 50;
- `POST /api/campaigns/:campaignId/comments` creates a Comment;
- `PATCH /api/campaigns/:campaignId/comments/:commentId` edits a non-deleted Comment with optimistic version checking;
- `DELETE /api/campaigns/:campaignId/comments/:commentId` applies the tombstone.

Same-Origin checks, Campaign isolation, prepared SQL and fail-closed target/scope resolution apply to all writes. The normal product exposes Campaign comments from the launcher and Area/Street/House comments in context sheets. Already loaded comments remain visible when the website loses connectivity. Comment writes are online-only in this slice and deliberately do not introduce a second queue beside the accepted M5 mutation queue; the UI never reports a server write as successful before the Worker responds.

## Activity history, FC2

Activity is now a bounded Campaign-scoped projection of persisted `domain_events`, not raw HTTP/database logs and not a second event system. The Worker is the only authority for both the source events and the read scope.

### Read contract

The endpoint is `GET /api/campaigns/:campaignId/activity` with:
- a default page size of 30 and a hard maximum of 50;
- newest-first ordering by `occurred_at DESC, id DESC`;
- a stable opaque cursor containing only the last occurrence time and Event ID;
- an optional `team` filter for roles whose access contract permits multiple Teams;
- a 503 schema response when the prepared Field-Session/Event foundation is not available.

There is no `OFFSET` history read and no unbounded Event-table response. The query is Campaign-, scope- and cursor-bounded and uses the existing Campaign/time Event index. Current labels are resolved in the same bounded read with safe joins; Activity never performs a per-item request.

### Supported projection

Only these currently persisted event types are allowlisted:
- `field_session.closed`;
- `field_session.expired`;
- `task.status.changed`;
- `comment.created`;
- `comment.edited`;
- `comment.deleted`.

The DTO contains only the stable Event ID, event type, occurrence time, optional Team/Session/Entity selectors, a safe actor category and typed minimal details. `task.status.changed` exposes Street/Haus, old/new allowlist status values and current safe labels. Field Session metrics come from the current `field_sessions` row. Comment events expose target type/context only and never read the Comment body for Activity text. Unknown event types are omitted; unknown or removed entity targets use a generic safe fallback and do not break the feed.

`payload_json` is parsed server-side only where the explicit event schema requires it. It is never forwarded to the client. Activity does not expose `actor_ref`, cookies, access tokens, session hashes, join credentials, QR tokens, room codes, IP addresses, raw request bodies, full Comment text, GPS data or complete snapshots. Actor output is limited to `Campaign-Zugriff`, `Temporäre Gruppe`, `System` or an unknown safe category. Security-sensitive audit logging remains separate from ordinary product `domain_events` where stronger retention/restriction is required.

### Authorization scope

The Worker re-resolves the current access before every read:
- Admin and Viewer may read normal operational Activity for their Campaign;
- Team Editor is restricted to the canonical current Team and cannot widen that scope with a query parameter. Campaign-level events without a Team are excluded from this Team-scoped read;
- temporary Field Group members never receive Campaign-wide Activity. They see only events tied to their exact current Campaign/Team/Field Group Session, plus their own temporary Comment events without a Session reference. Same-Team events from other Sessions are excluded;
- Campaign IDs, Team IDs, Group IDs and Session IDs are selectors only. Campaign isolation, prepared SQL and fail-closed scope validation remain server-side.

### Product and offline boundary

The normal Launcher exposes a compact `Aktivität` sheet. It has Loading, Empty, Error/Retry, mobile-friendly cards, allowed-role Team filtering and cursor-based `Mehr laden`. Already loaded entries remain visible if connectivity is lost; new reads require Internet and are not reported as current offline data. No Activity copy table, rollup table, client-created history or second offline queue is introduced. Navigation back to a context remains optional and is not required for this slice.

## Deterministic Automations, FC2+

Automations are deterministic domain rules, not opaque AI actions. ADR-0019 is accepted for the first bounded runtime slice.

### Implemented rule

The code-owned registry contains exactly one versioned rule:

`complete-parent-street-when-all-houses-complete` (version 1)

The only trigger is a successfully authorized M5 `house.set-status` mutation whose resulting House status is `completed`. If the Campaign rule is enabled, the Worker completes a Parent Street only when:

- the House and Parent Street belong to the same Campaign and Area and resolve to the same Team;
- the current Parent Street is exactly `open`;
- at least one current persisted House child belongs to that Parent Street;
- every current child House is `completed`.

The effect never overwrites `later`, `not-deliverable` or an already completed Parent Street, and it never reopens a task. It does not alter task geometry, labels, source provenance, relationships or unrelated Campaign/Team data.

### Authority, idempotency and events

Only Campaign Admins can read or enable/disable the fixed rule through the Campaign-scoped automation API. Viewer, Team Editor and temporary Field-Group members cannot manage configuration. A temporary member may still trigger the effect through a normal House status mutation inside its existing exact Campaign/Team/Group authorization; the resulting system effect grants no new authority.

The House mutation, guarded Parent update, Parent `task.status.changed`, `automation.executed` and M5 mutation ledger share one D1 batch. The existing `(campaign_id, mutation_id)` ledger and unique event dedupe keys make retries idempotent without an execution ledger. The Worker rechecks the rule, Campaign and child predicates in the SQL write path.

Automatic events use the safe `system` actor category. The Parent status event contains only normalized old/new status. `automation.executed` contains only the fixed Rule/Effect identifiers and triggering entity reference. An unambiguous triggering Field Session is reused; otherwise the field-session reference is `NULL`. No raw request body, comment text, credential, token, session hash, GPS data or full snapshot is written.

### Configuration and product boundary

`migrations/0009_automations.sql` is additive and creates only one `automation_rules` row per Campaign/Rule pair. It is prepared locally and not remotely applied. The normal Admin Launcher exposes a compact `Automationen` sheet with loading, error/retry, migration-unavailable, enabled/disabled and offline states. Configuration writes are online-only and are confirmed only after the Worker responds.

Activity projects `automation.executed` through its explicit server-side allowlist and displays a current safe Street/Area label or a generic fallback. Activity remains a projection of `domain_events`; no Activity table, rollup copy or second queue is introduced. There are no user-defined scripts, SQL fragments, webhooks, timers, polling loops or AI execution paths.

### Future deterministic rules

Candidate rules:
- new Area -> propose/generate reviewed road Tasks;
- accepted status mutation -> append normalized activity event;
- progress threshold -> surface coordinator indicator;
- session close -> derive summary;
- sync/retry state -> surface manual-action warning.

Every future rule still requires an explicit trigger/effect, preserved authorization, idempotent effects, observable success/failure and no hidden high-frequency polling requirement.

## Statistics

Statistics remain operational, not behavioral surveillance.

### Current Stats projection

The normal Launcher exposes a compact `Stats` module backed by
`GET /api/campaigns/:campaignId/stats`. It is a bounded server-side projection of
current state, Field Sessions and normalized task-status events. There is no Activity
copy table, Stats rollup table or client-created history.

The response keeps these units separate:
- Street progress uses the `street-tasks` denominator;
- House progress uses the `house-tasks` denominator when migration 0005 is available;
- Distribution and Collection session metrics are returned in separate buckets;
- Pickup progress is not invented because no persistent Pickup model exists yet.

Current fields include Campaign/Team/Area progress, completed/open/later/not-deliverable
counts, remaining work, bounded recent Session summaries, outing count, duration,
explicit participant-count sums, known-participant-session count, person-time and a
bounded 90-day status-change series. Every percentage is accompanied by its completed
and total denominator. Participant-count sums are explicitly not unique-person counts.

The recent Session projection is capped at 20 rows and indicates truncation; the full
cursor-paginated history remains in `Einsätze`. The progress-over-time query groups
persisted `task.status.changed` events and returns counts only, never event payloads.

### Authorization and privacy

The Worker resolves the existing AccessContext before aggregation:
- Admin and Viewer may read Campaign-wide Stats, with an optional Team filter;
- Team Editor is forced to the canonical own Team and cannot widen the query;
- temporary Field-Group members receive only their own Team work area, exact Field
  Group Session metrics and events tied to that Session, never Campaign-wide or other
  same-Team Session history;
- Campaign mismatch, missing Team scope and invalid filters fail closed.

The DTO contains safe operational labels and selectors only. It does not contain raw
`payload_json`, actor references, comments, session notes, credentials, tokens,
hashes, IPs, GPS data or full geometry/snapshots. Malformed event payloads contribute
no completion-transition count but cannot break the bounded Stats response.

The normal `Stats` sheet has Loading, Empty, Error/Retry, Offline-read and refresh
states, plus a Team filter only for roles that can read multiple Teams. Already loaded
Stats remain visible offline; new reads require Internet. `Einsätze` remains the
dedicated full Session-history surface.

### Source model

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

`migrations/0007_field_sessions_events.sql`, additive `migrations/0008_comments.sql` and additive `migrations/0009_automations.sql` are prepared on Draft PR #72 but are not recorded as remotely applied. The durable Comment, Activity and first deterministic Automation runtimes are implemented against those prepared schemas. No migration is applied by application code or preview integration.
