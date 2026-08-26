---
id: product-ux
type: product
status: accepted
last_updated: 2026-08-26
related: [product, product-roadmap, architecture-map, architecture-security, architecture-live-teams, architecture-identity-permissions, plan-012-platform-app-expansion]
source_of_truth_for: [field-ux, map-interaction, appearance-ux, app-shell-ux, admin-ux-direction]
---

# UX Rules

## Mobile first

Design for one-handed outdoor use before desktop use.

- primary actions need large touch targets;
- important information must remain readable in sunlight;
- avoid hover-only interaction;
- respect safe-area insets and desktop viewport edges;
- map panning/rotation must never accidentally complete Tasks;
- completion actions need an immediate Undo path where practical;
- icon-only controls require localized accessible labels/tooltips;
- field UI stays compact and map-first.

## Visual hierarchy

The map is the primary field workspace.

Administrative/statistical complexity belongs in separate surfaces:
- compact mobile app-launcher sheet plus dedicated modules;
- desktop-first Admin panel.

Do not permanently overlay a dashboard over the map.

## Target field chrome

The browse view intentionally keeps permanent chrome extremely small.

Current direction:
- bottom-left uses one compact translucent control group;
- first control is a 3×3 app-grid/menu icon, visually similar to one face of a cube;
- directly beside it, left aligned, show the active Team name; a small Team-color marker may support the name but never replace it;
- the old permanent Team dropdown is removed from the primary field chrome;
- Settings, Teams, Draw Area and other former toolbar actions are not permanently shown in the bottom bar;
- those actions may later move into the launcher and must only be shown where the effective permissions allow them;
- map controls and contextual Area/Street sheets remain separate from this launcher chrome;
- preserve large enough touch targets even though the visible control is compact.

The Team name is context, not an authorization boundary. Effective Team scope still comes from Worker-authorized access and canonical Campaign state.

## App launcher sheet

The Menu/App button opens a compact rounded sheet over the map. It should visually belong to the same family as the existing Settings/Teams bottom sheets rather than looking like a separate fullscreen dashboard.

Inside the sheet, destinations are shown like a phone home screen:
- large rounded app icons;
- short label directly underneath;
- no paragraph descriptions inside each launcher item;
- enough spacing for one-handed touch use;
- common labels such as Karte, Stats, Team, Feedback, Smart and Einsätze;
- Admin-only entries appear only for authorized Admin access.

On narrow phones the icon grid may reduce columns. On larger screens the sheet may center instead of occupying the full width, but should retain the compact sheet character.

Opening a destination may still transition into its dedicated full module surface. The launcher itself is not a full-screen module.

The transition may animate, but:
- keep it short;
- do not block interaction unnecessarily;
- respect `prefers-reduced-motion`;
- do not add a large animation dependency without evidence.

## Active Team / Field Group context

When working in a Team or Field Group:
- show the Team name visibly beside the app-grid icon in the bottom bar;
- Team color may be an additional marker, not the primary identifier;
- remove the old permanently visible Team dropdown as the primary switcher;
- later Team switching/details should happen through the Team destination intentionally;
- future Team progress may be shown subtly without expanding the permanent field chrome.

## Progress UX

Progress needs both a number and a visual bar.

Show where relevant:
- percentage complete;
- completed/total count;
- remaining count.

Possible scopes:
- Campaign;
- Team;
- Area;
- current Field Session;
- Collection separately from Distribution.

Never communicate critical progress only through color.

The denominator must be understandable. If Street and House models coexist, label which unit the percentage represents.

## Team/session history UX

Team details should eventually show how often the Team was out and what happened.

Each Field Session card may show:
- date;
- duration;
- number of people;
- optional note;
- completed/changed work;
- person-time.

Selecting a session can highlight its affected Streets/Houses on the map.

This highlighting is based on domain events/Task ids, not recorded GPS trails.

## Team creation UX

Team creation supports:
- Team name;
- color;
- optional date;
- later live-group/discoverability defaults where relevant.

Color preset order must start with:
1. Orange;
2. Blue;
3. Green;
4. Red;
5. Gray.

Offer additional accessible colors after those presets.

Team archive/delete needs an explicit destructive/retention-aware flow rather than a casual single tap.

## Live Field Groups UX

Teams / Join Team module should later support:
- current Team and Field Group;
- list of discoverable live Field Groups for authorized Campaign participants;
- join with code;
- scan/show QR;
- optional group password;
- leave/close group according to permissions;
- visible current group progress.

Discoverability is requested as enabled by default with opt-out, but is never public internet discovery.

Persistent Team access and temporary Field Group joining must be visually distinct.

## Distribution vs Collection UX

The app later supports two operational contexts:
- Flyer Distribution;
- Clothes Collection / Pickup.

The mode must be explicit. A user should never accidentally mark a flyer Task complete while intending to mark a pickup complete.

Collection UI may support:
- road sections driven/finished;
- pickup addresses/buildings;
- manually entered call-in addresses;
- open / collected / unavailable / follow-up status.

## Area browse/draw/edit

### Browse
A saved Area keeps normal Team-colored fill/outline.

Normal selection:
- no thick white halo;
- no stored corner/edit markers;
- no edit affordances directly on polygon;
- details communicate selection.

### Draw
Area drawing shows draft vertices/geometry plus Save/Cancel/Undo-point controls.

### Edit
Only after explicit shape edit:
- large touch-friendly vertices;
- high-contrast preview;
- selected vertex distinct;
- saved geometry unchanged until Save;
- Cancel restores saved state.

## Saved map rendering

Saved Areas/Streets remain rendered by MapLibre with the basemap and stay aligned through pan/zoom/rotate.

Street styling should remain road-like rather than broad highlighter strokes.

M6 target is real Street/House geometry; manual tracing becomes fallback.

## Map camera / geolocation

Personal last camera view is browser-local.

Startup priority:
1. personal last camera view;
2. Campaign shared focus;
3. Germany fallback.

GPS remains user initiated. No continuous route history is required for statistics or live groups.

## Access and permissions UX

UI reflects effective Worker-authorized permissions but never replaces server authorization.

Future Admin permissions need understandable labels, for example:
- Teams erstellen;
- Teams umbenennen/Farbe ändern;
- Teams archivieren/löschen;
- eigene/fremde Gebiete bearbeiten;
- eigene/fremde Straßen/Häuser bearbeiten;
- Einladungen verwalten;
- Live-Gruppen verwalten;
- Statistiken ansehen;
- Rechte verwalten;
- Administratoren verwalten.

Admin UI should show effective permissions clearly instead of presenting an unbounded confusing matrix.

## Desktop Admin panel

Admin is a separate desktop-first surface.

Expected navigation areas:
- Organizations;
- Campaigns;
- Teams;
- Areas;
- Access/Invites;
- Permissions;
- Live Groups;
- Statistics/Sessions;
- Activity/Audit;
- Support/Feedback;
- Security/Accounts.

Admin may be denser than field UI, but should remain responsive and accessible.

## Comments/activity/automations

Comments remain contextual to Campaign/Area/Task.

Automation/system activity must be distinguishable from human comments.

Automatic state changes must be visible/auditable and never silently bypass permissions.

## Support / Feedback

Support module may include:
- FAQ/help;
- app/version info;
- feedback/bug report form.

Never automatically include secrets, access tokens, TOTP secrets, private exports or exact GPS history.

## Appearance

Planned preference:
- System;
- Light;
- Dark.

Applies to website UI/Admin surfaces. Basemap may remain light initially.

## Language

Supported UI languages:
- Deutsch;
- English.

## Shared refresh/sync UX

Synchronization/authorization failures must remain visible without replacing the entire field interface when avoidable.

When newer shared data arrives during active draw/edit:
- preserve unsaved geometry;
- indicate newer data;
- recheck/apply safely after local interaction.

## Accessibility

- semantic controls;
- visible focus state;
- sufficient contrast;
- localized icon labels;
- no critical state only by color;
- touch-friendly targets;
- reduced-motion support;
- QR/code flows also have non-camera/manual alternatives.
