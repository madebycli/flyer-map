# Plan 038 — StreetEngine delivery relevance

Status: ACTIVE
Date: 2026-09-16
Target channel: beta only until acceptance gates pass

## Problem

The current network builder treats a broad set of OSM `highway` ways as distribution streets. That is useful for connectivity but too permissive for real flyer delivery: garden/allotment paths, field-like footways and pedestrian connectors can become visible tasks. At the same time, an unnamed short access serving several homes can be operationally important even when it has no `name` tag or looks like a driveway/service spur.

A building also cannot be discarded merely because it carries a business/POI tag. Home businesses exist at normal residential addresses. Conversely, a clearly standalone supermarket, warehouse or garage should not automatically become a residential flyer target just because it has an address.

The fix therefore must not be a single `highway` allow/deny list. It needs a two-layer model: connectivity first, delivery relevance second.

## Invariants

1. Never remove an addressable residential target solely because its access way is unnamed.
2. Never exclude a building solely because `name`, `shop`, `office`, `craft`, `brand` or another business/POI tag exists.
3. Garden/field/through paths with no served delivery targets must not become visible distribution tasks.
4. A short unnamed spur that is the practical access to one or more addressable homes must remain representable.
5. Every automatic include/exclude decision must have a bounded diagnostic reason counter and samples.
6. Connectivity geometry and visible distribution tasks are separate concepts. A hidden connector may remain in the graph without becoming a street task.
7. No behavioral cutover until a shadow comparison on real and synthetic fixtures shows which houses/streets would change.
8. Keep V3 Free-Tier and transfer budgets intact.

## Phase 0 — correctness fixes before filtering

- [x] Diagnose iPad clipboard activation loss.
- [x] Make diagnostic copy start inside the click gesture and never wait for a network refresh.
- [x] Add conservative building-polygon normalization/repair before `invalid_polygon` rejection.
- [ ] Prove the repair on beta with a fresh Gebiet-4 preparation and record accepted/rejected counts.

## Phase 1 — classify without changing output

Add an internal delivery-relevance classifier. It must emit classification and reason only; current visible output remains unchanged.

### Road classes

`delivery_backbone`
- normal public residential/living streets and ordinary public road classes;
- named or unnamed;
- can directly own delivery targets.

`delivery_access`
- short service/unnamed access that materially serves addressable buildings;
- may be rendered as a visible task when it is the practical delivery route;
- label must be explicit, e.g. `Unbenannte Zufahrt` or a parent-street-derived label, never generic `Straße` when a better explanation is available.

`connector_only`
- useful for topology/reachability but not a visible distribution task;
- examples can include pedestrian connectors or service links that serve no unique target.

`irrelevant_path`
- no meaningful served addressable targets and path semantics indicate garden/allotment/field/recreational/through use;
- omitted from visible distribution output.

`blocked_access`
- explicit access semantics make automatic flyer routing inappropriate;
- remain excluded unless later evidence proves a safe delivery exception.

### Evidence used by the classifier

The classifier may consider:
- `highway`, `service`, `access`, `foot`, `motor_vehicle`, `name`, `ref`, `surface` and related OSM tags;
- segment length and topology;
- whether the segment is a dead-end/stub or through connector;
- how many addressable building targets are associated with or uniquely reached through it;
- proximity and parent relationship to a normal delivery backbone;
- whether excluding it would orphan addressable houses from visible delivery geometry.

Tag semantics alone must not be the only signal for ambiguous service/path cases.

## Phase 2 — building/target relevance classification

Classify targets separately from road visibility.

`residential_or_mixed_keep`
- residential building evidence or normal dwelling geometry/address;
- keep even when a home business, office, shop name or craft tag is present.

`commercial_uncertain_keep`
- business/POI evidence exists but residential use cannot be ruled out;
- keep by default and expose the reason in diagnostics.

`non_residential_high_confidence`
- only when structure/use evidence strongly indicates a standalone non-residential object and no residential evidence conflicts;
- candidate for exclusion from residential flyer mode after shadow validation.

`non_dwelling_structure`
- structures such as clearly tagged garage/garages, shed, roof, carport, greenhouse without residential evidence;
- candidate for exclusion, but address-node association must be checked before dropping.

### Explicit anti-rule

Do **not** implement `if shop/office/name then exclude`. A named home business in a residential house must remain deliverable unless stronger contradictory evidence exists.

## Phase 3 — two-layer graph

Build and persist two related views:

1. **Connectivity graph**: broad enough to preserve useful links and house access.
2. **Distribution view**: only segments that should be shown/worked by a flyer distributor.

House-to-road assignment must use both. A house may use a hidden connector to reach a visible parent task. If an unnamed access is operationally necessary for several houses, it can be promoted to `delivery_access` and shown.

## Phase 4 — diagnostics and shadow comparison

For every generation collect bounded counters and samples:

- roads by classification;
- visible vs connector-only vs excluded segments;
- served-target count per relevant access segment;
- addressable targets before/after target classification;
- orphaned targets before/after;
- reasons for road exclusion/promotion;
- reasons for building keep/exclude;
- unnamed access segments promoted because they serve houses.

Run current and candidate classifiers side-by-side without changing published output. Compare at least:

- current real Gebiet 4;
- a short unnamed 10–30 m residential spur serving multiple homes;
- a garden/allotment footpath with no addresses;
- a field/recreational path;
- a home business inside a normal dwelling;
- a standalone supermarket/commercial building;
- an apartment building;
- a private driveway;
- pedestrian-only housing access;
- address nodes attached to a building without building-level address tags.

## Phase 5 — beta cutover gates

Behavior may change on beta only when all are true:

- no addressable fixture target is lost solely because the serving way is unnamed;
- zero-target garden/field paths are not visible distribution tasks;
- home-business residential fixtures remain included;
- high-confidence commercial/non-dwelling exclusions are explainable by reason code;
- every exclusion/promotion is represented in DIAG counters/samples;
- Gebiet 4 before/after street and house deltas are reviewed and unexplained losses are zero;
- runtime and browser-transfer budgets do not regress beyond the V3 guardrails;
- stable/main remains untouched until explicit release approval.

## Current implementation observations

Current `eligibleRoad` admits `pedestrian`, `footway`, `path` and `steps`, which explains irrelevant visible paths. It also excludes `service=driveway` unconditionally, which is too coarse for a residential access that may serve multiple homes. Current house matching uses address street-name matching when available and a nearest-road fallback for unaddressed targets. This makes a two-layer graph safer than simply tightening the existing allow-list.

## Non-goals of this slice

- no road-filter behavior change yet;
- no automatic commercial-building exclusion yet;
- no stable deployment;
- no claim that every real-world delivery route can be inferred perfectly from OSM tags alone.
