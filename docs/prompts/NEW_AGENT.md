# Prompt — New Agent / Fresh Chat

Use this file when a completely new AI session joins the project.

```text
Du arbeitest am GitHub-Projekt `madebycli/flyer-map` (Verteil-Flyer).

Das Repository ist die einzige Source of Truth. Verlasse dich nicht auf alte Chat-Erinnerungen, wenn das Repository etwas anderes sagt.

START

1. Lies `AGENTS.md` vollständig.
2. Lies `docs/status/CURRENT.md` vollständig.
3. Lies `docs/context-map.yaml` vollständig.
4. Behandle `docs/context-map.yaml` als Routing-Graph und lade nur die Nodes, die zur Aufgabe passen.
5. Prüfe relevante akzeptierte ADRs bevor du Architekturgrenzen änderst.
6. Prüfe aktuellen `main`, offene PRs/Branches, CI und Preview/Production-Stand soweit relevant.
7. Wenn Code/PR/Doku widersprechen, ermittle den aktuellen beabsichtigten Stand und korrigiere stale Doku im selben Slice.

NICHT VERHANDELBARE AKTUELLE BASIS

Verteil-Flyer ist eine normale Mobile-First-WEBSITE:
- keine native App
- keine installierbare PWA
- kein Service Worker
- kein Background Sync API

Eine Änderung daran braucht eine neue akzeptierte ADR.

Map-Baseline:
- MapLibre GL JS 5.7.1 gepinnt
- gespeicherte Areas/Streets in persistenten MapLibre GeoJSON Sources/Layers
- aktive Draw/Edit-Geometrie nur im kleinen SVG Overlay
- kein Anwendungsschleifen-Rendering über alle gespeicherten Geometrien bei jedem Pan/Zoom

Authorization:
- Worker ist maßgeblich
- IDs sind Selector, niemals Credential
- aktuelle Rollen: Campaign Admin / Team Editor / Viewer
- keine Client-only Authorization
- keine Secrets/Access Tokens/private Campaign-Daten committen oder anfordern

AKTUELLER M5-STAND

M5 wurde bereits gestartet:
- Draft PR #24
- Branch `m5-resilient-sync-mainline`

ERSTELLE KEINEN ZWEITEN M5-BRANCH.

Prüfe PR #24 und die aktuelle Branch-Doku/CI, bevor du entscheidest, was noch offen ist.

Ein kompletter Cold-Reload ohne Internet kann unter der aktuellen No-Service-Worker-Architektur Chrome's normale Offline/Dino-Seite zeigen. Das ist kein Bedienfehler. `docs/plans/active/011-offline-map-area.md` behandelt den vorbereiteten ~3-km-Offline-Kartenbereich, garantiert aber keinen Cold-Offline-App-Start.

GROSSER PRODUKTAUSBAU

Die neue übergeordnete Planung steht in:
- `docs/product/ROADMAP.md`
- `docs/plans/active/012-platform-app-expansion.md`

Wichtige proposed Architecture Nodes:
- `docs/architecture/IDENTITY_PERMISSIONS.md`
- `docs/architecture/LIVE_TEAMS.md`
- `docs/architecture/ORGANIZATIONS.md`
- `docs/architecture/COLLABORATION.md`

Geplante Richtung nach M5:
1. M5.5 vorbereiteter Offline-Bereich
2. M6 echte Smart Streets + Houses
3. M6.5 Collection/Pickup für Kleidersammlung
4. M7 Field Sessions + Live Field Groups + Comments/Activity/Automations
5. M8 Organizations + Accounts + Permissions + Desktop Admin
6. M9 Statistics + App-like Navigation + Support/Feedback + Appearance
7. M10 Security/Field Hardening

Für einen frischen Chat, der genau diesen großen Ausbau umsetzen soll, nutze den ausführlichen Prompt:
- `docs/prompts/START_PLATFORM_EXPANSION.md`

SECURITY

Account/Admin/Permission-Code darf nicht ohne vorherige akzeptierte ADR/Threat-Model-Entscheidung gebaut werden.

Mindestgrenzen:
- parameterized/prepared D1 queries
- keine SQL-Konkatenation mit Userinput
- Passwörter/TOTP-Secrets nie loggen
- reviewed Password-Hashing
- TOTP serverseitig + Rate Limits
- opaque server-revocable Sessions
- Injection-/XSS-/CSRF-Schutz
- Organization Tenant Isolation
- Authentication ersetzt niemals Authorization
- Security/Admin/Permission-Änderungen auditieren

ARBEITSWEISE

- kleine reviewbare Commits
- additive D1 Migrationen
- bestehende aktive PRs/Pläne fortführen statt Ersatz erzeugen
- relevante Tests/Typecheck/Build
- `CURRENT.md` + Context-Graph aktuell halten
- bei manuellen Cloudflare-Schritten immer nur eine konkrete User-Aktion gleichzeitig und niemals Secrets anfordern

Gib nach dem Lesen eine kurze Bestandsaufnahme und beginne danach direkt mit der Umsetzung. Stoppe nicht nach bloßer Planung, außer eine echte externe Aktion oder notwendige Architekturentscheidung blockiert.
```

## Minimal handoff

> Read `docs/prompts/NEW_AGENT.md` and follow it exactly. For the full platform expansion also read `docs/prompts/START_PLATFORM_EXPANSION.md`.
