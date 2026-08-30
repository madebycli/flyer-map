---
id: product-roadmap
type: product
status: accepted
last_updated: 2026-08-29
related: [product, product-mvp, product-ux, architecture-organizations, architecture-collaboration, architecture-identity-permissions, architecture-live-teams, plan-012-platform-app-expansion, plan-017-feature-complete-platform]
source_of_truth_for: [product-roadmap, planned-capabilities, milestone-order]
---

# Product Roadmap

## Product direction

Verteil-Flyer evolves from a shared flyer-distribution map into a secure, app-like field and administration platform.

The platform should support:
- flyer distribution;
- reliable offline-aware mutation synchronization;
- real Street and House geometry;
- later clothes collection/pickup;
- live field groups joined from multiple devices;
- Team/Area/Campaign progress and field-session statistics;
- comments/activity/automation;
- multiple Organizations and administrators;
- configurable permissions;
- desktop Admin;
- Support/Feedback;
- strong account security with authenticator-app TOTP for administrators.

The map remains the primary field workspace. Administrative complexity belongs in separate surfaces and must not make the mobile field map heavy.

Detailed umbrella specification: `docs/plans/active/012-platform-app-expansion.md`.
Current vertical delivery policy: `docs/plans/active/017-feature-complete-platform.md`.

## Feature-complete delivery policy

Future product work is delivered as vertical user features rather than normal-product Foundation previews.

A visible Launcher module is not considered delivered merely because local UI, fake data, domain helpers or a Workbench route exists. Shared product features must include their real persistence, Worker authorization, offline/retry behavior where relevant, error states, tests and production verification before they count as complete.

Internal `?workbench=` routes may remain useful for development, but they are not normal navigation and do not count as a completed product milestone.

The current feature-complete delivery line has shipped the Team Hub, Live Field Groups, durable Field Sessions, Comments, the bounded Activity projection, the first deterministic, explicitly authorized and idempotent Automation and the first real Stats projection on Draft PR #72. Stats derives bounded progress/session/event aggregates with explicit Street-/House denominators and no duplicate rollup persistence. The House-renderer slice, normal-product Smart-Street selection and normal-product Smart-House selection are implemented; remaining FC4 work is real-device, touch-density and dense-mobile acceptance, including the documented HOUSE_MIN_ZOOM starting value of 15. FC5 Collection/Pickup is now in architecture planning under docs/plans/active/021-collection-pickup-persistence.md; no Pickup runtime or persistence is shipped yet. Security-sensitive runtime remains gated by explicit ADR acceptance.

## Domain direction

Future vocabulary must distinguish:
- **Organization**: top-level tenant;
- **Campaign / Aktion**: one distribution/collection campaign;
- **Team**: persistent colored Campaign group;
- **Field Group / Einsatzgruppe**: temporary group currently working inside a Team;
- **Field Session / Einsatz**: one outing with date/duration/participants/work events;
- **Distribution Task**: flyer Street/House work;
- **Pickup Task**: later clothes-collection work.

Persistent Teams and temporary Field Groups are not interchangeable.

## Planned milestones

### M5 — Resilient synchronization

Goal: important field changes survive unreliable connectivity while the app is loaded and queued mutations apply idempotently after reconnect.

Capabilities:
- durable IndexedDB mutation queue;
- idempotent Worker/D1 mutations;
- reconnect/visibility/manual retry;
- conflict states instead of silent last-write-wins;
- authorization/revocation-aware queue handling;
- current snapshot as startup/recovery cache.

Current implementation is Draft PR #24 on `m5-resilient-sync-mainline`. Do not create a replacement M5 branch.

Strict cold page start/reload while fully offline is a separate architecture question under the current no-Service-Worker website baseline.

### M5.5 — Prepared offline working area

Goal: let a user deliberately prepare a small working area before going into poor connectivity.

Direction:
- Settings action for approximately 3 km around current map center;
- browser-local map data stored durably;
- offline-permitted OSM/OSM-derived source/format selected by ADR;
- do not intentionally cache/store current CARTO raster content;
- design data pipeline to help M6 real Street/House geometry where practical.

This does not by itself guarantee cold app-shell loading without network.

### M6 — Smart Street + House Tasks

Goal: stop using freehand street tracing as the normal workflow.

Capabilities:
- derive real road geometry from reviewed OSM/OSM-derived data;
- Area can generate/propose road segments;
- clip/split crossing roads according to accepted rules;
- tap/select actual Street/segment;
- manual drawing only as fallback;
- House Mode for one/multiple buildings;
- stable Street/House identities for later statistics, sessions and collection;
- whole-city performance.

### M6.5 — Clothes Collection / Pickup Mode

Goal: reuse the same map for the later clothes-collection round with cars.

The current repository has only the Pickup domain/UI foundation. Plan 021 prepares the persistence and identity decision for this milestone; it is not a shipped Collection runtime.

Capabilities:
- explicit switch between Distribution and Collection context;
- separate pickup status model;
- mark collection road sections as driven/finished;
- create/tap pickup addresses/buildings;
- manually add call-in/reported pickup addresses;
- Field Groups can work together in collection mode;
- distribution completion and collection completion never overwrite each other;
- separate collection progress/statistics.

### M7 — Field Sessions + Live Groups + Collaboration

Goal: make real field work understandable, joinable from several devices and reconstructable without WhatsApp screenshots or memory-based estimates.

#### Field Sessions
A Team/Field Group can record one outing with:
- date;
- duration;
- participant count;
- optional note;
- work performed / Task events;
- calculated person-time.

History should answer how often a Team was out and what it completed.

Selecting a session may highlight the affected Street/House geometry on the map. This comes from domain events, not GPS trails.

#### Live Field Groups
- temporary Field Group inside a persistent Team;
- multiple devices can join;
- QR code;
- human-enterable group code;
- optional group password;
- discoverability enabled by default with opt-out;
- discoverability only for authorized Campaign participants, never an internet-public directory;
- temporary join credentials separated from persistent Team/Admin access.

#### Collaboration
- comments on Campaign/Area/Task context;
- append-only activity events;
- deterministic/idempotent automations;
- initial compact Team/Area progress.

The durable Comment runtime, the normal-product Activity feed and the first deterministic Automation are now implemented on the current feature-complete delivery line. Activity is a bounded projection of normalized `domain_events`, with server-side Campaign/Team/Field-Group authorization and no raw event payloads in the client response. The Automation runtime is limited to the versioned parent-Street completion rule, configured by Admin through prepared migration 0009 and executed atomically from the authorized M5 House-status mutation path.

### M8 — Organizations + Identity + Permissions + Desktop Admin

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
Admin-configurable capabilities should cover Team creation/deletion/color, Area/Task editing across own/other Teams, invite management, live-group management, statistics, settings, permission management and admin management.

Deny by default. Worker enforcement is mandatory.

#### Desktop Admin panel
Separate desktop-first surface for:
- Organizations/Campaigns;
- Teams;
- Team archive/delete;
- access/invites;
- permissions;
- Areas/ownership;
- live-group policy;
- statistics/session history;
- activity/audit;
- security/accounts;
- support/feedback.

### M9 — Statistics + App-like Navigation + Support + Appearance

Goal: provide a polished operational overview while keeping the map fast.

#### Statistics

The current feature-complete line now has a normal Launcher `Stats` module backed by a
server-authorized bounded read. It derives current progress and operational Session
metrics from source state and normalized events, while the richer M9 reporting scope
below remains the product direction.

Show percentage/progress bars for:
- Campaign;
- Team;
- Area;
- optionally current Field Session.

Statistics may include:
- completed / total Streets;
- completed / total Houses;
- remaining work;
- number of outings;
- duration per outing;
- participant counts;
- person-time;
- progress over time;
- collection progress separately from distribution.

The denominator/aggregation rule must be explicit and reconcilable with source state/events.

#### Mobile app-like shell
Current accepted field chrome follows Plan 016/017:
- the permanent compact launcher sits at the bottom-left of the map;
- it contains only the 3x3 Menu/App button plus the visible active Team name;
- Team color is supporting context only;
- the old permanent Team dropdown is removed;
- Settings, Team management, Area creation and later privileged actions are not permanent bar buttons and move into the permission-aware launcher/module flows;
- the Menu/App button opens a compact rounded launcher sheet in the Settings/Teams visual family, not a full-screen home dashboard;
- launcher destinations use large phone-style icons with short labels;
- normal users only see destinations/actions that are both implemented and allowed by effective access/capabilities;
- selected modules may still open dedicated full surfaces;
- contextual Area/Street/House sheets remain separate and may overlay the launcher while editing;
- respect `prefers-reduced-motion`.

#### Team colors
Expanded Team palette with first visible presets in this order:
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

### M10 — Security + Field Hardening + Release

Acceptance focus:
- representative Android/iPhone including slower devices;
- desktop Admin usability;
- dense Street/House/session datasets;
- outdoor connectivity loss/recovery;
- account/auth/TOTP/permission security tests;
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

## Privacy

Do not add continuous GPS trails merely to power statistics, live groups or map highlighting.

Progress/session highlighting derives from domain Task/event data.

Live presence should avoid unnecessary device identity/location collection.

## Authorization

Every Organization, Campaign, Team, Field Group, comment, event, automation, statistic, support or admin endpoint enforces scope server-side.

No UI permission toggle grants authority by itself.

## Performance

Design for significantly more than a small demo dataset.

Synthetic acceptance should include at least:
- 500 Streets;
- 1,000 Streets;
- 2,500 Streets;
- 5,000 Streets;
- building-scale tests after House Mode;
- session/event history tests after M7.

Keep field bundle/map interaction lightweight even if Admin becomes feature-rich.

## Website-only baseline

No native app, installable PWA, Service Worker or Background Sync unless a later accepted ADR explicitly changes this.

Browser-local IndexedDB storage for mutation queues/map packages is allowed when it solves a concrete field need.

## Architecture decisions required

Before implementation of their respective slices:
- offline map provider/package ADR;
- Street/House identity/splitting ADR;
- Live Field Group join/discoverability/credential ADR;
- Organization identity + username/password/TOTP/session ADR;
- capability/role-template ADR;
- event/session/statistics retention ADR.

Do not invent expensive irreversible decisions directly in implementation code.
