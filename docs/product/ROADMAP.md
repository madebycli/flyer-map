---
id: product-roadmap
type: product
status: accepted
last_updated: 2026-09-01
related: [product, product-mvp, product-ux, architecture-organizations, architecture-collaboration, architecture-identity-permissions, architecture-live-teams, plan-012-platform-app-expansion, plan-017-feature-complete-platform, plan-021-collection-pickup-persistence, plan-023-auto-area-task-preparation]
source_of_truth_for: [product-roadmap, planned-capabilities, milestone-order]
---

# Product Roadmap

## Product direction

Verteil-Flyer evolves from a shared flyer-distribution map into a secure, app-like field and administration platform.

The platform should support:
- flyer distribution;
- reliable offline-aware mutation synchronization;
- real Street and House geometry;
- clothes collection/pickup;
- live field groups and temporary collector access from multiple devices;
- Team/Area/Campaign and Collection progress/statistics;
- comments/activity/automation;
- multiple Organizations and administrators;
- configurable permissions;
- desktop Admin;
- Support/Feedback;
- strong account security with authenticator-app TOTP for administrators.

The map remains the primary field workspace. Administrative complexity belongs in separate surfaces and must not make the mobile field map heavy.

Detailed umbrella specification: `docs/plans/active/012-platform-app-expansion.md`.
Current vertical delivery policy: `docs/plans/active/017-feature-complete-platform.md`.
Current FC5 architecture/product contract: `docs/plans/active/021-collection-pickup-persistence.md`.

## Feature-complete delivery policy

Future product work is delivered as vertical user features rather than normal-product Foundation previews.

A visible Launcher module is not considered delivered merely because local UI, fake data, domain helpers or a Workbench route exists. Shared product features must include their real persistence, Worker authorization, offline/retry behavior where relevant, error states, tests and production verification before they count as complete.

Internal `?workbench=` routes may remain useful for development, but they are not normal navigation and do not count as a completed product milestone.

The current feature-complete delivery line has shipped the Team Hub, Live Field Groups, durable Field Sessions, Comments, bounded Activity, the first deterministic Automation, the first real Stats projection, the House renderer, normal-product Smart Street and normal-product Smart House on Draft PR #72. Remaining FC4 work is real-device/touch-density/dense-mobile acceptance including the documented `HOUSE_MIN_ZOOM` starting value 15.

For FC5, Master selected the First-Class Collection/Pickup direction. Collection is not a second status on Distribution Street/House Tasks. It has its own Main Area, work Areas, Runs, Road Sections, Pickup Tasks, temporary Collector access and progress. FC5.1 Collection Access, Areas und Runs sowie der vollständige FC5.2-Runtime-Scope für Pickup-Persistenz, Visibility/Capabilities, Geoapify/OSM-derived Sonderadress-Suche, MapLibre-Pickup-Rendering, durable Pickup Comments, Run-/Collector-Assignment, Edit/Move, Soft-Archive, Archivprüfung und normale Admin-/Collector-Pickup-Flows sind als echte normale Produktwege implementiert. FC5.3 Road Sections, Collection/Pickup Stats, Actor Highlight/Attribution und compensating Revert bleiben weitere FC5-Slices. Reale Android-/iPhone-Abnahme bleibt ein separates Acceptance Gate.

## Domain direction

Future vocabulary must distinguish:
- **Organization**: top-level tenant;
- **Campaign / Aktion**: shared upper scope for one distribution/collection action until a later accepted Action/Cycle architecture supersedes it;
- **Team**: persistent colored Distribution Campaign group;
- **Field Group / Einsatzgruppe**: temporary group inside an established Distribution Team;
- **Field Session / Einsatz**: one outing with date/duration/participants/work events;
- **Distribution Task**: flyer Street/House work;
- **Collection Main Area**: overall boundary in which Collection work/search takes place;
- **Collection Area**: independently cut inner work area for collection;
- **Collector Access**: temporary Collection-only device/user access created from the Campaign Collection QR;
- **Collection Run / Fahrt**: one vehicle/outing that may claim one or more Collection Areas and may contain several devices;
- **Collection Road Section**: independent road work for the collection round;
- **Pickup Task**: one collection location/address/building.

Persistent Distribution Teams, temporary Field Groups, Collector Access and Collection Runs are not interchangeable.

## Planned milestones

### M5 - Resilient synchronization

Goal: important field changes survive unreliable connectivity while the app is loaded and queued mutations apply idempotently after reconnect.

Capabilities:
- durable IndexedDB mutation queue;
- idempotent Worker/D1 mutations;
- reconnect/visibility/manual retry;
- conflict states instead of silent last-write-wins;
- authorization/revocation-aware queue handling;
- current snapshot as startup/recovery cache.

Strict cold page start/reload while fully offline is a separate architecture question under the current no-Service-Worker website baseline.

### M5.5 - Prepared offline working area

Goal: let a user deliberately prepare a small working area before going into poor connectivity.

Direction:
- Settings action for approximately 3 km around current map center;
- browser-local map data stored durably;
- offline-permitted OSM/OSM-derived source/format selected by ADR;
- do not intentionally cache/store current CARTO raster content;
- design data pipeline to help real Street/House geometry where practical.

This does not by itself guarantee cold app-shell loading without network.

### M6 - Smart Street + House Tasks

Goal: stop using freehand street tracing as the normal workflow.

Capabilities:
- derive real road geometry from reviewed OSM/OSM-derived data;
- Area can generate/propose road segments;
- clip/split crossing roads according to accepted rules;
- tap/select actual Street/segment;
- manual drawing only as fallback;
- House Mode for one/multiple buildings;
- stable app-owned Street/House identities;
- whole-city performance.

Normal Smart Street, Smart House and the persisted House renderer are implemented. Real-device FC4 acceptance remains open.

The completed backend-only Plan 023 adds server-prepared automatic Area work: a successful persisted Area create or geometry update can atomically publish ordinary clipped Street and House Tasks for all devices. It does not mass-prepare existing Areas and does not replace the Smart/manual flows. A follow-up UI slice may offer an explicit prepare/retry action for an older editable Area after migration 0014 has been deliberately rolled out.

### M6.5 - Clothes Collection / Pickup Mode

Goal: use the same platform and map for the later clothes-collection round with cars while keeping Collection operationally independent from flyer Distribution.

Plan 021 is the current source of truth for the selected FC5 product/architecture contract.

#### Separation

- Distribution and Collection never overwrite each other's status.
- Distribution Street/House deletion does not delete Collection work.
- Collection archive/edit does not change Distribution.
- Only deleting the complete Campaign/Aktion may remove both domains together.
- Collection Areas may be larger, smaller or completely differently cut than Distribution Areas.
- OSM IDs remain data-source provenance, never Collection primary keys.

#### Main Area and Collection Areas

- Admin defines an overall Collection Main Area.
- Main Area is rendered with a light gray tint.
- Inner Collection Areas render above it with their own colors rather than mixing with gray.
- Main-Area surface not yet assigned to an inner Area remains visibly gray/unassigned.
- Pickup Tasks may initially remain unassigned to an inner Area but still belong to the Campaign/Main Area.
- Address search is spatially restricted to the Main Area and post-filtered against its polygon.

#### Temporary Collection QR access

- Volunteers do not need a pre-created normal account.
- A Campaign-specific QR/link opens Collection-only access.
- Each device/session receives its own revocable Collector identity such as `Nutzer 1`, `Nutzer 2`.
- QR access does not grant Distribution/Admin/Organization rights.
- Admin/Operator may revoke individual Collector access.

#### Collection Runs / Fahrten

- Collection uses Runs/Fahrten rather than reusing persistent Distribution Teams.
- A Run may claim one or more Collection Areas depending on vehicle/capacity.
- Other users see claimed/in-progress Areas and current progress.
- Other devices may join the active Run.
- Multiple joined devices may record progress.
- A participant may leave without automatically cancelling the Run for remaining members.
- Explicit Leave/Release/Abbrechen controls are required.
- Admin/Operator may force-release/reassign.
- No automatic inactivity timeout or automatic Area release.

#### Collection Road Sections

Collection road work is independent from Distribution Streets.

Statuses:
- `open` / Offen;
- `driven` / Abgefahren;
- `later` / Später;
- `unavailable` / Nicht befahrbar.

Road Sections have their own IDs, geometry, Area/Run context, events and statistics. Dieser Teil bleibt FC5.3.

#### Pickup Tasks / Sonderadressen

Pickup Tasks:
- may exist without a Distribution House;
- require a map position;
- contain title, address and description;
- use the separate Pickup status model;
- use durable contextual comments with target `pickup-task`;
- can be archived but should not be hard-deleted individually;
- may be edited/moved later with change attribution;
- copy their own address/geometry snapshot when created from an existing House/OSM candidate;
- may be assigned to one or more active Collection Runs/Collectors through the existing M5 mutation path;
- are editable and soft-archivable in the normal Admin and authorized Collector product paths;
- remain reviewable after archive while archived Pickups are excluded from the active MapLibre marker set.

Existing Pickup statuses:
- `open`;
- `collected`;
- `unavailable`;
- `needs-follow-up`.

#### OSM-based online address search

`Sonderadresse hinzufügen` uses a Maps/Spotlight-like Search Sheet:

`Plus -> Search -> result -> map focus/marker -> Sonderadresse hinzufügen -> title/address/description`

Implemented FC5.2 boundary:
- OSM-derived address data via Geoapify Address Autocomplete behind the Worker;
- no provider credential in the client;
- server-side rate limit, validation and timeout;
- Main-Area BBox/proximity plus authoritative polygon post-filter;
- one-shot device-location bias when permitted, otherwise current MapLibre center;
- distance in metres/kilometres;
- manual map position correction;
- visible Geoapify/OpenStreetMap attribution;
- no continuous GPS history.

#### Special-address capabilities

For temporary Collection helpers:
- view special addresses defaults on;
- create defaults off;
- edit defaults off;
- assign defaults off.

Admin/Operator may grant these narrow Collection-specific capabilities without bringing forward the general Organizations/Permission runtime. View=false remains authoritative for Pickup data/search/write. Assignment requires the separate assign capability and validates active Run/Collector references server-side.

#### Actor attribution and corrections

Every authoritative Collection change should identify the acting Collector/Admin/Operator.

Admin/Operator should be able to:
- filter/highlight contributions from one Collector;
- select specific changes;
- revert selected changes through authorized compensating mutations;
- revoke the Collector.

This is not a destructive global undo stack and does not erase audit history.

#### Collection statistics

Separate from Distribution:
- Pickup progress denominator `pickup-tasks`;
- Road progress denominator `collection-road-sections`;
- Area/Run/Campaign progress;
- session/event metrics;
- no Distribution denominator mixing.

### M7 - Field Sessions + Live Groups + Collaboration

Goal: make real field work understandable, joinable from several devices and reconstructable without WhatsApp screenshots or memory-based estimates.

#### Field Sessions

A Team/Field Group can record one outing with:
- date;
- duration;
- participant count;
- optional note;
- work performed / Task events;
- calculated person-time.

History should answer how often a group was out and what it completed.

Selecting a session may highlight affected Street/House/Collection geometry from domain events, not GPS trails.

#### Live Field Groups

- temporary Field Group inside a persistent Team;
- multiple devices can join;
- QR code;
- human-enterable group code;
- optional group password;
- discoverability enabled by default with opt-out;
- discoverability only for authorized Campaign participants, never an internet-public directory;
- temporary join credentials separated from persistent Team/Admin access.

Collection QR/Collector Access is a related but distinct FC5 entry flow and must remain Collection-only.

#### Collaboration

- comments on Campaign/Area/Task/Pickup context;
- append-only/minimized activity events;
- deterministic/idempotent automations;
- Team/Area/Collection progress.

The durable Comment runtime, Activity feed and first deterministic Automation already exist on the current feature-complete line. FC5.2 extends the same durable Comment runtime to `pickup-task` with Collection-Collector authorization and additive forward migration 0013.

### M8 - Organizations + Identity + Permissions + Desktop Admin

Goal: support multiple organizations, multiple administrators and explicit administration safely.

#### Organizations

- Organization is tenant boundary;
- Campaigns belong to Organization;
- no cross-Organization reads/writes;
- safe migration of existing Campaigns.

#### Administrator accounts

Requested account model:
- username;
- password;
- authenticator-app TOTP 2FA;
- no SMS requirement;
- no mandatory email identity.

Multiple administrators and safe admin transfer are required.

Implementation requires accepted ADR/threat model before account code.

#### Security requirements

- parameterized/prepared D1 queries;
- no SQL/user-input string concatenation;
- raw passwords never stored/logged;
- reviewed password hashing strategy;
- protected TOTP secrets;
- server-revocable secure sessions;
- login/TOTP rate limiting;
- server-side authorization after authentication;
- injection/HTML/JS-like input remains inert data;
- audit events for security/admin/permission changes.

#### Permissions

Admin-configurable capabilities should cover Team creation/deletion/color, Area/Task editing across own/other Teams, invite management, live-group management, Collection special-address policy, statistics, settings, permission management and admin management.

Deny by default. Worker enforcement is mandatory.

#### Desktop Admin panel

Separate desktop-first surface for:
- Organizations/Campaigns;
- Teams;
- Team archive/delete;
- access/invites;
- permissions;
- Areas/ownership;
- Collection Main Area/Areas/Runs/Collectors/Pickups;
- live-group policy;
- statistics/session history;
- activity/audit;
- security/accounts;
- support/feedback.

### M9 - Statistics + App-like Navigation + Support + Appearance

Goal: provide a polished operational overview while keeping the map fast.

#### Statistics

The current feature-complete line has a normal Launcher `Stats` module backed by a server-authorized bounded read. It derives current Distribution progress/session/event aggregates. FC5.3 adds separate Collection denominators and progress.
Show percentage/progress bars for:
- Campaign;
- Team;
- Area;
- optionally current Field Session;
- Collection Main Area;
- Collection Area;
- Collection Run.

Statistics may include:
- completed / total Streets;
- completed / total Houses;
- remaining Distribution work;
- number of outings;
- duration;
- participant counts;
- person-time;
- progress over time;
- collected / total Pickup Tasks;
- driven / total Collection Road Sections.

The denominator/aggregation rule must be explicit and reconcilable with source state/events.

#### Mobile app-like shell

Current accepted field chrome follows Plan 016/017:
- permanent compact launcher at bottom-left of map;
- only the 3x3 Menu/App button plus visible active Team/context;
- Team color is supporting context;
- no permanent old Team dropdown;
- Settings, management, Area creation and privileged actions live in launcher/module flows;
- compact rounded launcher sheet, not full-screen home dashboard;
- large phone-style icons with short labels;
- only implemented and allowed destinations/actions;
- dedicated full surfaces allowed where useful;
- contextual Area/Street/House/Collection sheets remain separate;
- respect `prefers-reduced-motion`.

#### Team colors

Expanded Team palette with first visible presets:
1. Orange;
2. Blue;
3. Green;
4. Red;
5. Gray;
then additional accessible colors.

#### Team metadata

Optional date can be entered when creating a Team and shown in Team history/details where useful.

#### Support / Feedback

- help/FAQ;
- app/version information;
- feedback/bug report;
- never attach secrets/tokens/TOTP/GPS history automatically.

#### Appearance

- System;
- Light;
- Dark;
- UI chrome/Admin/sheets follow preference;
- basemap may remain unchanged initially.

### M10 - Security + Field Hardening + Release

Acceptance focus:
- representative Android/iPhone including slower devices;
- desktop Admin usability;
- dense Street/House/Collection/session datasets;
- outdoor connectivity loss/recovery;
- account/auth/TOTP/permission security tests;
- temporary Collection QR credential revocation/abuse tests;
- SQL injection/XSS/CSRF/session tests;
- tenant-isolation tests;
- join-code brute-force/expiry/revocation tests;
- accessibility/reduced-motion;
- statistics correctness;
- production/recovery documentation.

## Team management requirements

Team deletion/archive is explicitly required and currently missing.

Before implementation define history semantics for:
- Areas;
- Tasks;
- Field Sessions;
- comments/activity;
- access grants/invites;
- statistics.

Prefer archive/soft-delete when historical information must remain.

Collection entity lifecycle is separately governed by Plan 021 and must not be accidentally coupled to Distribution Team deletion.

## Privacy

Do not add continuous GPS trails merely to power statistics, live groups, collection proximity ranking or map highlighting.

Progress/session highlighting derives from domain Task/event data.

One-shot device location may be used for immediate map/search UX when the user allows it, but is not retained as a route history.

Live presence should avoid unnecessary device identity/location collection.

## Authorization

Every Organization, Campaign, Team, Field Group, Collection Collector/Run/Area/Road/Pickup, comment, event, automation, statistic, support or admin endpoint enforces scope server-side.

No UI permission toggle grants authority by itself.

## Performance

Design for significantly more than a small demo dataset.

Synthetic acceptance should include at least:
- 500 Streets;
- 1,000 Streets;
- 2,500 Streets;
- 5,000 Streets;
- building-scale tests after House Mode;
- representative Collection Areas/Road Sections/Pickup density;
- session/event history tests.

Keep field bundle/map interaction lightweight even if Admin becomes feature-rich.

## Website-only baseline

No native app, installable PWA, Service Worker or Background Sync unless a later accepted ADR explicitly changes this.

Browser-local IndexedDB storage for mutation queues/map packages is allowed when it solves a concrete field need.

## Architecture decisions required

Before implementation of their respective slices:
- offline map provider/package ADR;
- Street/House identity/splitting ADR;
- Live Field Group join/discoverability/credential ADR;
- ADR-0020 records the accepted First-Class Collection Access/Areas/Runs persistence boundary before further FC5 schema work;
- Organization identity + username/password/TOTP/session ADR;
- capability/role-template ADR;
- event/session/statistics retention ADR.

Do not invent expensive irreversible decisions directly in implementation code.
