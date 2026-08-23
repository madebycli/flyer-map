# AGENTS.md

## Project

Verteil-Flyer is a mobile-first website for coordinating flyer distribution across geographic areas.

Users work from a shared interactive map, see their current device location, view assigned distribution areas and manually mark streets or buildings as completed.

The application must remain lightweight, reliable, privacy-conscious and easy to operate outdoors on ordinary smartphones.

## Primary goals

1. Make it obvious what has already been distributed.
2. Make it obvious what still needs to be done.
3. Allow multiple people to share the same current state.
4. Preserve important user changes when mobile connectivity is unreliable.
5. Keep GPS location local to the device unless a future accepted decision explicitly requires otherwise.
6. Remain usable in ordinary mobile browsers on common Android phones and iPhones.
7. Keep hosting and infrastructure within free tiers where practical.

## MVP non-goals

- Native Android or iOS applications.
- PWA installation or app-like standalone installation flows.
- Continuous GPS route recording.
- Automatic detection of walked streets.
- Large analytics systems.
- Social networking features.
- Complex user account systems.
- Heavy animations or marketing-site effects.

## Technology baseline

Frontend:
- TypeScript
- React
- Vite
- plain CSS
- MapLibre GL JS

Platform:
- Cloudflare Workers
- Workers Static Assets
- Cloudflare D1 when persistence is introduced

Maps:
- OpenStreetMap-derived data
- MapLibre
- VersaTiles public vector basemap for the current MVP
- map provider must remain replaceable

Source control:
- GitHub

## Performance philosophy

Verteil-Flyer is a field tool, not a marketing website.

Prefer:
- small dependencies
- native browser functionality
- text and CSS over image assets
- code splitting where useful
- simple interactions
- predictable rendering
- minimal network requests

Avoid:
- large UI frameworks
- animation libraries without a concrete UX need
- external web fonts
- autoplay media
- decorative videos
- large image backgrounds
- unnecessary telemetry
- dependencies for trivial functionality

Any substantial dependency must solve a real problem.

## Source of truth

Do not treat AGENTS.md as complete project documentation.

Project knowledge lives under `/docs`.

Always read:
1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`

Then load only the documents relevant to the current task.

`ARCHITECTURE.md` contains the high-level system architecture.

## Context discipline

Do not load every documentation file by default.

Use `docs/context-map.yaml` to select relevant context.

If code and documentation disagree:
1. determine which reflects the intended current behavior;
2. fix the stale source;
3. do not knowingly leave contradictory documentation.

## Plans

Non-trivial work requires a plan in `docs/plans/active/`.

Plans should contain:
- goal
- relevant context
- tasks
- acceptance criteria
- risks
- decisions made

When completed:
- update documentation;
- update `docs/status/CURRENT.md`;
- move the plan to `docs/plans/completed/`.

## Documentation maintenance

Documentation is part of the implementation.

When behavior, architecture, data structures, security assumptions, deployment or UX rules change, update the corresponding docs in the same change.

Do not create documentation for trivial implementation details.

## Decision records

Architecture decisions that would be expensive or confusing to reverse must receive an ADR in `docs/decisions/`.

Do not rewrite history by deleting accepted ADRs. Create a new ADR that supersedes the old decision.

## Current status

`docs/status/CURRENT.md` must remain short.

It should describe:
- current working state
- current milestone
- important known problems
- active plan
- next likely work

It must not become a changelog.

## Testing

Every change must be tested at the lowest useful level.

Important user flows should receive integration or browser tests once those flows exist.

Mobile interaction, synchronization and connectivity-loss behavior require explicit testing.

## Security

Never commit:
- API secrets
- authentication tokens
- production access links
- personal data
- private campaign data

Client input is untrusted.

Authorization must be enforced by the Worker, not only by the UI.

## Working style

Prefer small, reviewable changes.

Do not refactor unrelated code while implementing a feature.

Do not introduce abstractions before they solve a demonstrated problem.

Prefer readable boring code over clever code.

Before finishing a task:
1. run relevant tests;
2. run type checking;
3. run the production build;
4. review changed files;
5. update relevant docs;
6. update `CURRENT.md`.
