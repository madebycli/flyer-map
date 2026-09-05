---
id: status-current
type: status
status: active
last_updated: 2026-09-05
---

# Current Project State

## Aktive isolierte Linie: Organizer/Admin Platform

Plan 030 wird ausschließlich auf `feature/organizer-admin-platform` gegen `mission-rxdb-sync` entwickelt. Draft-PR #76 bleibt Draft und ungemergt. PR #74/#75 bleiben getrennt; `mission-release-2026-09-02-manual` bleibt unangetastet. Kein Production-Deploy und keine Production-D1-Migration ohne separate ausdrückliche Freigabe.

### Aktuell verifizierter Organizer/Admin-Stand

Der erste vollständig grüne isolierte Admin-Staging-Gate ist V9 Run `33924415528` / #23. Auditiert wurde Feature-Head `c62385a8c400f68753d1f1f811e2315551153885` (`fix: harden static asset responses`). Die exact-head PR-CI auf diesem Head ist vollständig grün: Tests, Typecheck, Dependency Audit und Production Build.

V9 #23 belegt gegen den echten Cloudflare-Worker:

- Candidate-Version-Konvergenz und fail-closed API-Method-Gates;
- Bootstrap -> Password -> TOTP -> authentifiziertes `/api/organization/me`;
- zwei serverseitig persistierte Campaigns nach Logout, Storage/Cookie-Clear und frischem Browser-Kontext;
- Admin-Invite in sauberem Browser, Fragment-Token-Scrubbing und MFA-Enrolment;
- Mobile Chromium 390x844 ohne horizontales Overflow;
- Remote-Cleanup auf 0 Bootstrap-/Organization-/Account-/owned-Campaign-Datensätze und fehlerfreien `PRAGMA foreign_key_check`;
- finalen ungepinnten öffentlichen Worker: `/start` 200, unauthenticated `/me` 401, HEAD API 405, fremder Origin 403;
- identische Security-Härtung auf Worker- und statischen Asset-Antworten: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`.

Die statischen Header werden über `public/_headers` gesetzt. Der Organizer-Worker setzt dieselben Header weiterhin für Worker-generierte Antworten. Der Staging-Testzugang verwendet einen einmaligen Bootstrap-Schlüssel; nur dessen SHA-256 liegt in der isolierten Workflow-Konfiguration, der Klartext gehört weder ins Repository noch in Logs/Artifacts.

### Harte Production-Isolation

Die kanonische `wrangler.jsonc` bleibt Production-sicher:

- `main`: `./worker/indexFc52.ts`;
- Production-D1: `0113e775-1e43-4d96-8b97-51fdeec7355b`;
- Production Rate-Limit Namespaces: `91714001`, `91714002`, `91714003`;
- kein `ORGANIZATION_LOGIN_LIMITER` in der committed Production-Konfiguration;
- `worker/indexOrganizer.ts` bleibt ausschließlich ein isolierter Organizer/Admin-Wrapper.

Production wurde durch das Admin-Staging nicht deployed und die Production-D1 wurde nicht migriert. Migrationen 0017/0018/0019 bleiben Production-unapplied.

### Admin-Staging

- Branch: `organizer-admin-staging`;
- Workflow: `.github/workflows/admin-staging-release-v9.yml`;
- Worker: `flyer-map-admin-staging`;
- D1: `flyer-map-admin-staging-db`;
- URL: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`;
- RxDB-Staging-D1 `bcec3432-18ec-42a2-970a-64d52c8263d5` und Production-D1 werden durch Guards ausgeschlossen.

Die V9-Linie pinnt Candidate/API/Browser-Smokes auf die exakte Cloudflare Worker Version und prüft den finalen Benutzerstand danach absichtlich ungepinnt über die öffentliche `workers.dev`-URL. Sanitized Artifacts enthalten keine Passwörter, Bootstrap-Secrets, TOTP-Keys oder Invite-Tokens.

## Noch offene Organizer/Admin-Master-Akzeptanz vor Production

Der isolierte Teststand ist jetzt browser-testbar. Das ist ausdrücklich noch keine Production-Freigabe. Vor Production müssen die verbleibenden Master-Gates evidence-driven abgeschlossen werden, insbesondere:

1. explizite Legacy-Campaign-Adoption mit Audit und negativen Foreign-/Owned-/Race-Tests;
2. vollständige Account-Security-Matrix: Username/Password, sichere Reset-Links, TOTP-Reset, Recovery-Regeneration, Sessions einzeln/alle widerrufen;
3. mehrere Organizer/Admins inklusive concurrent last-organizer invariant;
4. Named Role Templates + serverbekannte Capability Registry;
5. own-team/other-team/explizite cross-team Durchsetzung an kanonischen Campaign/Team/Area/Task-Beziehungen;
6. Organizer-only permanente Campaign-Löschung mit fresh high-risk reauth und exakter Bestätigung;
7. Audit-/Threat-Model-/Rate-Limit-/CSP-Abschluss;
8. gewünschter Root-Organizer-Einstieg ohne die normale Field Map zu hijacken;
9. vollständige Admin-Console-/Lifecycle-UX ohne Fake-KPIs;
10. komplette RxDB-/Field-Regressionsuite weiter grün halten.

## Verifizierte RxDB-Mission-Basis – nicht regressieren

`mission-rxdb-sync` bleibt die separate RxDB-Basis; Draft-PR #74 bleibt getrennt. D1 bleibt kanonisch, RxDB/Dexie hält lokale operative Campaign-Daten, Worker/D1 bleiben Autoritäts- und Sicherheitsgrenze. Die bereits geschlossenen Prepared-Street-/MapLibre-/Realtime-P0s dürfen durch Organizer/Admin-Arbeit nicht zurückkehren.

## Arbeitsregel bei Wiederaufnahme

GitHub ist Source of Truth. Zuerst `AGENTS.md`, diese Datei, `docs/context-map.yaml`, danach `docs/context-organizer-admin.yaml`, `docs/context-organizer-admin-live.yaml`, Plan 030, ADR-0026 und den aktuellen Handoff lesen. Remote-Heads, PR #76, exact-head CI und aktuellen V9-Run immer neu verifizieren; dokumentierte SHAs sind Übergabemarker.
