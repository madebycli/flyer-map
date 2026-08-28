---
id: architecture-collaboration
type: architecture
status: active
last_updated: 2026-08-28
related: [product-roadmap, architecture-data, architecture-security, architecture-offline-sync, architecture-live-teams, plan-012-platform-app-expansion, ADR-0017, ADR-0018]
source_of_truth_for: [field-session-foundation, comments, future-activity, future-automations, future-statistics]
---

# Collaboration, Field Sessions, Activity, Automations and Statistics

## Purpose

Record the accepted collaboration/history boundary and distinguish the durable Field Session foundation from the FC2 Comment runtime and the broader activity/automation features that are still pending.

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

The durable Comment runtime additionally emits:
- `comment.created`;
- `comment.edited`;
- `comment.deleted`.

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

`migrations/0007_field_sessions_events.sql` and additive `migrations/0008_comments.sql` are prepared on Draft PR #72 but are not recorded as remotely applied. The durable Comment runtime is implemented against 0008, while the Activity projection and Automations remain intentionally unimplemented until their own feature-complete slices.
