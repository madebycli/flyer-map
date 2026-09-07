---
id: ADR-0019
type: decision
status: accepted
date: 2026-08-28
---

# ADR-0019: Deterministic, idempotent automation runtime

## Status

Accepted on 2026-08-28 for the first FC2 automation slice. The decision is
intentionally limited to a hardcoded registry and one explicitly specified
Campaign rule. It does not authorize a general workflow or scripting platform.

## Context

The M5 mutation path already provides the authoritative Worker boundary,
Campaign revision claim and `(campaign_id, mutation_id)` idempotency ledger.
FC2 needs one useful automatic effect without adding a second event system,
client-side authority or an unbounded rules engine.

## Decision

### Hardcoded versioned registry

Automation rule types are a code-owned, versioned allowlist. The first and only
implemented rule is:

`complete-parent-street-when-all-houses-complete`

It is triggered only by an authoritatively applied `house.set-status` mutation
whose result is a House status transition to `completed`. When its Campaign
configuration is enabled, the Worker may complete an `open` Parent Street only
when at least one current persisted House child exists and every such child is
`completed`. `later`, `not-deliverable` and already completed Parent Streets are
never overwritten, and the rule never reopens a Street.

There are no user-authored conditions, scripts, SQL fragments, cron schedules,
webhooks, external requests or AI execution paths.

### Campaign activation

The rule is disabled unless an Admin explicitly enables it through the
Campaign-scoped Worker API. The API accepts only `enabled: boolean`. Viewer,
Team Editor and temporary Field-Group members cannot read or change automation
configuration. The registry, not D1 data, defines which rule types are known.

### Atomic M5 effect and idempotency

The triggering House mutation, conditional Parent-Street update, Parent-Street
`task.status.changed` event, `automation.executed` event and M5 mutation ledger
are submitted in the same guarded D1 batch. The Parent update and event inserts
are additionally guarded by the allowlisted rule, Campaign/Parent/House
relationships and the post-mutation completion predicate.

No separate execution table is introduced. A replay with the same M5 mutation
id and fingerprint returns the original revision before a second batch is
built. Event dedupe keys remain unique within the Campaign as a second defense.
If a statement in the guarded batch fails, D1 rolls the batch back rather than
reporting an automatic success.

### System actor and minimized events

The automatic Parent-Street event and `automation.executed` event use the
existing `system` actor category and no actor reference. Event payloads contain
only the fixed rule/effect identifiers and the existing allowlisted status
values where needed. Comment bodies, request bodies, credentials, GPS data and
snapshots are never copied into an event.

When the triggering mutation has one unambiguous `field_session_id`, both
automatic events use that same session. No session is inferred when the
existing attribution logic cannot prove one.

### UI and offline boundary

Automation status is exposed in the normal Admin-only Launcher sheet. The
toggle is server-authoritative, requires an online response and is disabled
offline. There is no client-side automation effect, timer, polling loop or
second offline queue.

## Consequences

Positive:

- the first rule is auditable and bounded;
- automatic state changes remain inside the existing Worker/M5 authority;
- retries cannot duplicate the Parent update or its events;
- activation is explicit per Campaign;
- Activity can project the normalized automation event without raw payloads.

Tradeoffs:

- the rule is deliberately not configurable beyond enabled/disabled;
- an automation can run only when the M5 mutation path and the prepared
  Field-Session/Event schema are available;
- automation configuration is online-only in this slice;
- a future rule needs an explicit registry entry, tests and review rather than
  a data-only configuration change.

## Rollout

`migrations/0009_automations.sql` is additive and prepared locally only. It is
not applied remotely by application code, branch preview builds or this ADR.
