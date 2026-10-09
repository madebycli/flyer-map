# Next Agent Prompt — M1 Website Development

Use this prompt in a fresh ChatGPT chat to continue building Verteil-Flyer.

---

You are continuing the GitHub project `madebycli/flyer-map` (Verteil-Flyer).

The repository is the source of truth. Do not rely on old chat memory when the repository says something else.

## Mandatory startup

Before changing anything:

1. Read `AGENTS.md` completely.
2. Read `docs/status/CURRENT.md`.
3. Read `docs/context-map.yaml`.
4. Read the relevant product docs under `docs/product/`.
5. Read the relevant architecture docs under `docs/architecture/`.
6. Read all accepted ADRs that affect the task, especially the website-only, Cloudflare and map decisions.
7. Inspect the current implementation, recent merged PRs and current CI status.

Then give me a short inventory of the current state and immediately continue with implementation. Do not stop after planning unless a genuinely external/manual action is required.

## Product goal

Build Verteil-Flyer into a clean, fast, mobile-first collaborative WEBSITE for organizing flyer distribution.

It is NOT a native app and NOT an installable PWA.

The main experience is the map. Users should be able to coordinate distribution without screenshots and WhatsApp confusion.

The production site is currently deployed through Cloudflare from GitHub `main`.

Current production URL is documented in `docs/status/CURRENT.md` / `docs/operations/PRODUCTION.md`.

## Core product behavior

The website must progressively support:

- campaigns / distribution projects
- groups/teams with arbitrary names
- one clear color per team
- assigning geographic areas to teams
- drawing/editing those areas directly on the map
- showing all team areas clearly at the same time
- manually marking streets or later individual houses as completed
- shared synchronized state across multiple phones
- progress that survives browser restarts and multiple days
- browser geolocation for the user's own current location
- NO GPS route recording or movement history
- GPS must not be persisted/shared in MVP

Status vocabulary:
- open
- completed
- later
- not-deliverable

Street mode comes before house mode.

## UX direction

The website should feel like a polished field tool, not an admin dashboard and not a prototype.

Priorities:

- mobile first
- map first
- very clean UI
- large touch targets
- minimal typing while outside
- immediate visual distinction between teams
- obvious difference between done / not done
- simple bottom sheets / compact controls instead of desktop-style sidebars
- usable with one hand
- readable in daylight
- fast on normal mobile data
- no unnecessary animations
- no giant UI framework
- no external webfonts
- no decorative heavy imagery

The basemap is background context. Distribution areas/tasks must remain application-controlled layers above it.

Do not spend time redesigning the basemap unless there is a real usability bug. The current colorful map is considered good enough for now.

## Current technical direction

Preserve the repository architecture unless a documented reason requires a change:

- TypeScript
- React
- Vite
- plain CSS
- MapLibre GL JS
- Cloudflare Worker + Static Assets
- D1 when shared persistence is introduced
- GitHub -> Cloudflare automatic deployment

Website only:

- no Web App Manifest
- no service worker
- no installable PWA work
- no native app work

Keep the basemap provider replaceable.

## Your next milestone: M1

Move the project from a map prototype to the first real usable Verteil-Flyer workflow.

Create/update an active implementation plan under `docs/plans/active/` before nontrivial work.

The M1 vertical slice should aim to deliver, in a sensible order:

1. campaign data model / current campaign concept
2. team creation
3. editable team name
4. team color selection with sensible collision-resistant defaults
5. team list / compact mobile management UI
6. draw a distribution area on the map
7. assign the area to a team
8. edit/delete an area
9. render all saved areas with fill + clear border + selected state
10. persist and reload this data
11. prepare the data/API shape for multi-device shared state

Prefer finishing a coherent vertical slice over creating many half-built screens.

If persistence is required, use the existing Cloudflare/D1 architecture and migration direction. Never invent a D1 database ID. If account-side D1 creation is required and you cannot perform it through an available Cloudflare connection, implement everything that can be implemented safely, then tell me the exact single manual action I need to perform and what value you need back.

## Map editing requirements

Map editing must be genuinely usable on phones.

For area drawing/editing:

- avoid tiny vertex controls
- clearly show drawing mode
- provide obvious Save / Cancel
- accidental map movement must not corrupt a drawing
- selected team color should preview while drawing
- polygons must remain editable later
- invalid geometry should not be silently saved

Use a small dependency only if it materially improves correctness/mobile usability and is justified in the plan. Do not add a large library casually.

## Shared-state direction

For MVP scale (roughly 30–100 views/week, towns/districts around 30–50k inhabitants), keep synchronization simple.

Preferred direction from project docs:

- Worker API
- D1 persistence
- optimistic UI where useful
- simple polling/version endpoint instead of WebSockets unless requirements prove otherwise
- explicit error states
- no hidden data loss

Later offline resilience may use browser storage for pending mutations, but do not reintroduce a service worker/PWA architecture.

## Security/privacy rules

Follow `AGENTS.md` and security docs.

Never commit:
- API secrets
- auth tokens
- production invite links
- private campaign data
- personal location history

Authorization belongs on the Worker/server side, not only in React UI.

Current-location GPS is for local display only in MVP and must not be stored in D1.

## Engineering workflow

For nontrivial changes:

1. create/update an active plan
2. create a feature branch
3. implement the feature fully
4. keep changes focused
5. run TypeScript/typecheck and production build
6. add tests where logic is nontrivial and testable
7. update relevant docs and `docs/status/CURRENT.md`
8. open a PR
9. inspect CI
10. fix failures instead of bypassing them
11. merge only when green unless I explicitly tell you otherwise

Cloudflare is connected to `main`, so successful merges should deploy automatically.

Do not ask me to download/upload files or use a local PC.

## Product quality bar

Do not accept "technically works" if the mobile UX is bad.

Check:

- small phone width
- iPhone/Safari behavior
- Android/Chrome behavior
- touch interactions
- loading state
- network failure state
- empty states
- accidental taps
- map controls overlapping UI
- area colors remaining distinguishable
- no horizontal overflow
- no giant bundles/dependencies without justification

## What I want you to do now

Continue the project autonomously from the current repository state.

First, determine whether M0 can now be considered sufficiently complete from the documented real-device feedback. If yes, archive/complete the foundation plan appropriately and start a new M1 plan. If some M0 item genuinely still blocks feature development, keep it open but do not let minor cosmetic map work stall M1.

Then implement the first meaningful M1 vertical slice for campaigns/teams/colored editable map areas.

Do not just give me instructions for code I could write myself. Use the connected GitHub repository and make the changes.

When you finish a work cycle, report concisely:

- what is now working
- PR/merge status
- CI status
- whether Cloudflare should auto-deploy
- what I should test on my phone next
- the next logical development step
