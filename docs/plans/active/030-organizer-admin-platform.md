---
id: plan-030-organizer-admin-platform
type: plan
status: active
last_updated: 2026-09-05
related: [organizations, identity-permissions, identity-threat-model, security, data, ADR-0015, ADR-0016, ADR-0026, plan-028-rxdb-local-first-mission-sync, operations-organizer-admin-staging, prompt-organizer-admin-latest]
---

# Plan 030: Organizer/Admin Platform

## Ziel

Eine getrennte Organization-/Organizer-Admin-Plattform wird auf Basis der verifizierten RxDB-Mission-Linie aufgebaut, ohne den funktionierenden Field-Flow oder Production zu verändern. Sie unterstützt sichere Organization-scoped Accounts/Memberships, mehrere Organizer/Admins, MFA, Campaigns, Rollen/Capabilities, Audit und eine eigenständige Admin-Oberfläche.

## Verifizierte Basis und erster vollständiger Staging-Green

- Source-Branch: `mission-rxdb-sync`.
- Arbeitsbranch: `feature/organizer-admin-platform`.
- Draft-PR: #76 gegen `mission-rxdb-sync`; Draft/unmerged lassen.
- PR #74/#75 bleiben getrennt.
- Rollback `mission-release-2026-09-02-manual` bleibt unangetastet.
- Production-D1 und Production-Worker bleiben unangetastet.
- RxDB bleibt für operative Campaign-Daten zuständig, niemals für Admin-Credentials oder Organization-Autorisierung.

Erster vollständig grüner Runtime-Stand:

- Feature: `c62385a8c400f68753d1f1f811e2315551153885` (`fix: harden static asset responses`).
- Exact-head PR CI: `33924375460` / #1121 = success.
- Admin-Staging V9: Run `33924415528` / #23 = success.
- Public Staging URL: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`.

V9 #23 belegt Bootstrap/Password/TOTP, authentifiziertes `/me`, zwei persistente Campaigns nach komplett frischem Browser-Kontext, Clean-Browser Admin Invite + MFA, Mobile Chromium, Cleanup/FK-Safety und den finalen ungepinnten Public-Safety-Gate.

## Production-Isolation

Committed `wrangler.jsonc` bleibt:

- `main = ./worker/indexFc52.ts`;
- Production D1 `0113e775-1e43-4d96-8b97-51fdeec7355b`;
- Rate namespaces `91714001`, `91714002`, `91714003`;
- ohne Organizer Login Limiter oder Organizer Entry Point.

`worker/indexOrganizer.ts` ist deploy-spezifisch und darf nur in isoliertem Admin-Staging oder einer später ausdrücklich genehmigten Production-Konfiguration verwendet werden.

## Identity und Security

- Stable Account ID unabhängig vom Username.
- Account global, Membership Organization-scoped.
- Username + Passwort + TOTP.
- PBKDF2-HMAC-SHA-256 mit exakt 600.000 Iterationen als aktuelle Baseline über `OrganizationPasswordKdfDurableObject`.
- TOTP Seed AES-256-GCM verschlüsselt mit Worker Secret.
- Recovery Codes one-time und hash-only.
- Opaque revocable HttpOnly Session.
- Recovery Session mit reduzierter Assurance.
- Strict same-origin für Organization-Schreibzugriffe.
- IDs sind Selektoren, keine Autoritätsnachweise.
- Keine Secrets in URL, LocalStorage, IndexedDB, RxDB, Audit, Logs oder öffentlichen Artifacts.
- Mindestens ein aktiver Organizer muss erhalten bleiben.
- High-Risk-Aktionen verlangen fresh MFA/Reauth.

## Static-/API-Security Header

Worker-generierte Organizer-Antworten werden in `worker/indexOrganizer.ts` gehärtet. Cloudflare Workers Static Assets können UI-Dateien jedoch vor dem Worker ausliefern; deshalb setzt `public/_headers` dieselben Baseline-Header auch auf statischen Antworten:

- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Cross-Origin-Opener-Policy: same-origin`.

V9 prüft beide Pfade real gegen Cloudflare. Das Gate nicht abschwächen.

## Organization und Rechte

- Organization ist absolute Tenant-Grenze.
- Organizer ist nicht bloß Campaign Admin.
- Mehrere Organizer sind möglich.
- Admin-Capabilities kommen aus serverseitigen Role Templates/Membership-Regeln.
- Team-/Campaign-/Area-/Task-IDs sind nur Selektoren.
- Cross-Team-Rechte müssen explizit serverseitig erlaubt sein.
- Permanente Campaign-Löschung bleibt Organizer-only.
- Legacy Campaigns werden niemals automatisch beansprucht.

## Campaigns und Admin UI

- Campaign erhält `organization_id`.
- Legacy Campaigns bleiben bis expliziter Adoption `organization_id = NULL`.
- Admin-Lifecycle: `draft`, `active`, `completed`, `archived`.
- Zielrouten: `/start`, `/login`, `/admin`, `/new`, `/admin/campaign/:id` plus Account-/Role-/Security-Verwaltung.
- `/` bleibt normale Field Map.
- Desktop-first, aber mobile Chromium-tauglich.

## Implementierter Kern

Backend/Data:

- `migrations/0018_organization_admin_platform.sql`;
- `migrations/0019_organization_security_hardening.sql`;
- `worker/organizationAuth.ts`;
- `worker/organizationApi.ts`;
- `worker/organizationSecurity.ts`;
- `worker/organizationSecurityApi.ts`;
- `worker/organizationSecurityRequest.ts`;
- `worker/organizationBootstrapHashApi.ts`;
- `worker/organizationPasswordKdf.ts`;
- `worker/organizationPasswordKdfDurableObject.ts`;
- `worker/indexOrganizer.ts`.

Frontend:

- `src/organization/OrganizationApp.tsx`;
- `src/organization/OrganizationSecurityCenter.tsx`;
- `src/organization/OrganizationPublicLinks.tsx`;
- `src/organization/organizationApiClient.ts`;
- `src/organization/organizationRoutes.ts`;
- `src/organization/AdminMapPicker.tsx`;
- `src/organization/organization-admin.css`.

Tests/Operations:

- `tests/organization*.test.ts`;
- `tests/pickupReadRuntime.test.ts` für Production-Worker-Isolation;
- `.github/workflows/admin-staging-release-v9.yml`;
- `.staging/admin-v9-release.sh`;
- `.staging/admin-v9-browser.mjs`;
- `docs/operations/ORGANIZER_ADMIN_STAGING.md`.

## Geschlossene P0-/Staging-Gates

1. Production Worker Isolation wiederhergestellt und regressionsgeschützt.
2. KDF Durable Object Vertrag stabilisiert, PBKDF2 bleibt 600k.
3. `/api/*` unsupported methods/HEAD fail-closed; kein SPA HTML 200.
4. Candidate exact-version pinning verhindert Cloudflare alias race im Smoke/Browser-Gate.
5. TOTP staging key korrekt 32-byte base64url generiert.
6. Browser Campaign-Create deterministisch selektiert.
7. Invite Fragment Token wird nach React-Start sicher aus URL entfernt; E2E wartet auf tatsächliches Scrubbing.
8. Static Assets tragen die gleichen Security Header wie API-Antworten.
9. V9 API- und Browser-Matrix vollständig grün.
10. Cleanup/FK und finaler öffentlicher ungepinnter Worker Safety-Gate grün.

## Noch offene Master-Akzeptanz vor Production

1. Explizite Legacy Campaign Adoption mit Audit sowie unauthorized/foreign/already-owned/race Tests.
2. Vollständige Account Security: Username-/Passwortänderung, sichere Organizer Reset Links, TOTP Reset, Recovery Regeneration, Session List/Revoke one/all.
3. Mehrere Organizer/Admins, Disable/Remove und concurrent last-organizer invariant.
4. Named Role Templates CRUD/Assignment auf serverbekannter Capability Registry.
5. Own-team vs other-team vs explizite cross-team Durchsetzung an kanonischen Campaign/Team/Area/Task-Beziehungen.
6. Organizer-only permanente Campaign Löschung mit fresh high-risk reauth und exakter Bestätigung.
7. Audit-/Threat-Model-/Rate-Limit-/CSP-Abschluss.
8. Gewünschter Root Organizer Entry ohne Field Map Hijack.
9. Vollständige Campaign Admin Console/Wizard/Lifecycle UX ohne Fake-Daten.
10. Komplette RxDB-/Field-Regressionsuite weiter grün.

## Akzeptanzkriterien

- Browserrollen/IDs sind niemals Autoritätsnachweis.
- Passwörter, TOTP Seeds, Recovery Codes und Session Secrets stehen nicht im Klartext in D1.
- TOTP Replay ist blockiert; Recovery Codes sind one-time.
- Letzter Organizer kann auch concurrent nicht entfernt werden.
- Cross-Tenant Zugriff scheitert fail-closed.
- Campaign-Erstellung bindet serverseitig an die autorisierte Organization.
- Legacy Campaign wird nie automatisch adoptiert.
- Invite Enrollment funktioniert in sauberem Browser und Token bleibt nicht in der URL.
- Role Templates/Capabilities werden serverseitig durchgesetzt.
- High-Risk-Aktionen verlangen die vorgesehene Assurance.
- Field Map/RxDB bleiben grün.
- Committed Production Wrangler bleibt auf `indexFc52.ts`.
- Admin-Staging verwendet weder Production-D1 noch RxDB-Staging-D1.
- Finaler öffentlicher Worker trägt Security Header auf UI und API.

## Risiken / offene Production-Fragen

- finale Idle-/Absolute-Session-Lifetime;
- Disaster-Recovery-Prozess bei Verlust aller Organizer TOTP/Recovery Codes;
- Production-Prozess für TOTP-Key-Rotation;
- endgültiger sichtbarer Capability-Satz des ersten Admin-Releases;
- Production-Migrationen 0017/0018/0019 benötigen einen separaten Release-/Migrationsauftrag.

## Wiederaufnahme

`AGENTS.md` -> `docs/status/CURRENT.md` -> `docs/context-map.yaml` -> `docs/context-organizer-admin.yaml` -> `docs/context-organizer-admin-live.yaml` -> dieser Plan -> ADR-0026 -> `docs/status/ORGANIZER_ADMIN_LIVE_HANDOFF.md` -> `docs/operations/ORGANIZER_ADMIN_STAGING.md`. Danach GitHub Remote-Heads, PR #76, exact-head CI und aktuellen V9-Lauf neu verifizieren.
