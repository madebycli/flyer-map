---
id: prompt-organizer-admin-latest
type: handoff
status: current
last_updated: 2026-09-04
related: [plan-030-organizer-admin-platform, ADR-0026, organizations, identity-permissions, identity-threat-model, security, data, plan-028-rxdb-local-first-mission-sync, operations-organizer-admin-staging]
---

# Continue Organizer/Admin Platform — latest handoff

Arbeite direkt am bestehenden GitHub-Projekt `madebycli/flyer-map` weiter. Nicht neu anfangen, nichts resetten und nicht nur analysieren. GitHub/Repository ist die einzige Source of Truth. Verifiziere Branches, PRs, Heads, CI, Dateien und Staging-Zustand selbst, bevor du handelst. Die unten genannten SHAs sind nur Übergabemarker.

## Unbedingt zuerst lesen

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/context-organizer-admin.yaml`
5. `docs/plans/active/030-organizer-admin-platform.md`
6. `docs/decisions/ADR-0026-organization-admin-identity-and-authorization.md`
7. `docs/architecture/ORGANIZATIONS.md`
8. `docs/architecture/IDENTITY_PERMISSIONS.md`
9. `docs/architecture/IDENTITY_THREAT_MODEL.md`
10. `docs/architecture/SECURITY.md`
11. `docs/architecture/DATA.md`
12. `docs/operations/ORGANIZER_ADMIN_STAGING.md`

Danach nur die im Kontextgraph relevanten Code-/Testknoten nachladen.

## Remote-Stand verifizieren

Zuletzt vor diesem Dokumentations-Handoff verifiziert:

- Feature: `feature/organizer-admin-platform`
- Feature-Head: `fb437e2f23fc7c851ecd219cfb6ff38991bb95b2`
- Commit: `fix: restore production worker isolation`
- exakter CI-Run: `33874224651` / CI #1077 = success
- Base: `mission-rxdb-sync`
- Draft PR: #76 gegen `mission-rxdb-sync`
- PR #74/#75: getrennt halten, Draft/unmerged
- Rollback: `mission-release-2026-09-02-manual`, nicht verändern
- Admin-Staging-Branch: `organizer-admin-staging`

Der Dokumentationscommit nach diesem Marker erzeugt einen neueren Feature-Head. Deshalb beim Start **nicht** auf `fb437...` stehen bleiben, sondern zuerst den aktuellen Remote-Head und dessen exact-head CI lesen.

## Harte Grenzen

- Kein Merge.
- PR #76 Draft lassen; nicht Ready markieren.
- Kein Production-Deploy.
- Keine Production-D1-Migration.
- Production `wrangler.jsonc` nicht auf Organizer umstellen.
- Rollback-Branch nicht anfassen.
- PR #74/#75 nicht in diese Linie vermischen.
- Keine Abschwächung vorhandener Tests, TypeScript-Regeln oder Security Guards.
- Keine neue Ausbreitung von `any`, `unknown as`, `@ts-ignore` oder tsconfig-Escape-Hatches.
- Keine Secrets in Repository, Logs, URL, LocalStorage, IndexedDB oder RxDB.

## Production-Isolation — P0-Invariante

Die committed `wrangler.jsonc` muss weiterhin zeigen auf:

```text
main = ./worker/indexFc52.ts
Production D1 = 0113e775-1e43-4d96-8b97-51fdeec7355b
Production rate namespaces = 91714001, 91714002, 91714003
```

`ORGANIZATION_LOGIN_LIMITER` gehört nicht in die committed Production-Konfiguration. `worker/indexOrganizer.ts` importiert `indexFc52.ts`, wird aber ausschließlich durch eine isolierte Admin-Staging-/später explizit freigegebene Deploy-Konfiguration zum Entry Point.

Es gab bereits eine Regression, die die Production-Wrangler-Konfiguration auf `indexOrganizer.ts` zog. Sie wurde am Head `fb437...` korrigiert. `tests/pickupReadRuntime.test.ts` muss diese Grenze weiter schützen.

## Produktmodell

Zielhierarchie:

```text
Account
  -> Organization Membership
     -> Organizer / Admin / Role Templates
        -> multiple Campaigns / Aktionen
           -> Teams
              -> Areas
                 -> Street / House Tasks
                    -> Field Groups / Sessions
                       -> Collection
```

Organization ist die absolute Tenant-Grenze. Ein Account kann mehreren Organizations angehören. IDs sind nur Selektoren, niemals Berechtigungsnachweise. Worker/D1 lösen Session, Membership und Capability serverseitig auf.

`/` bleibt normale Field Map. Organizer/Admin-Routen sind `/start`, `/login`, `/admin`, `/new`, `/admin/campaign/:id`. Langfristig soll eine bestehende Organizer-Sitzung beim neutralen Einstieg einen sicheren Wechsel zu `Meine Aktionen`, `Neue Aktion`, `Zur letzten Aktion` anbieten, ohne den Field-Flow zu übernehmen.

## Akzeptierte Security-Entscheidung

ADR-0026 ist accepted. Wesentliche Verträge:

- stable Account-ID, Username änderbar;
- Passwortverifier PBKDF2-HMAC-SHA-256, mindestens 600.000 Iterationen;
- TOTP: 160-Bit Seed, 30s, 6 digits, ±1 step, Replay-Schutz;
- TOTP Seed AES-256-GCM mit Worker Secret;
- Recovery Codes einmalig und hash-only;
- Recovery-Login erzeugt eingeschränkte `recovery`-Session, keine normale MFA-Assurance;
- opaque revocable Sessions; D1 speichert nur Hash des Session-Secrets;
- `__Host-vf_organization_session`, Secure/HttpOnly/SameSite=Lax/Path=/;
- Bootstrap nur mit serverseitigem Bootstrap-Secret und Singleton-Lock, kein First-Visitor-Claim;
- mindestens ein aktiver Organizer bleibt erhalten;
- permanente Campaign-Löschung Organizer-only;
- Legacy Campaign `organization_id` bleibt NULL bis zu expliziter Adoption;
- Credentials/MFA/Sessions/Memberships/Roles/Audit niemals in RxDB.

Die Passwort-KDF wurde inzwischen über `OrganizationPasswordKdfDurableObject` aus dem normalen Worker-Request-Pfad ausgelagert. Diese DO-Bindung gehört in Admin-Staging, nicht in Production-Wrangler.

## Vorhandene Implementation — zuerst gegen aktuellen Head prüfen

Der Feature-Tree enthält mindestens:

Backend:
- `migrations/0018_organization_admin_platform.sql`
- `migrations/0019_organization_security_hardening.sql`
- `worker/organizationAuth.ts`
- `worker/organizationApi.ts`
- `worker/organizationSecurity.ts`
- `worker/organizationSecurityApi.ts`
- `worker/organizationSecurityRequest.ts`
- `worker/organizationBootstrapHashApi.ts`
- `worker/organizationPasswordKdf.ts`
- `worker/organizationPasswordKdfDurableObject.ts`
- `worker/indexOrganizer.ts`

Frontend:
- `src/organization/OrganizationApp.tsx`
- `src/organization/OrganizationSecurityCenter.tsx`
- `src/organization/OrganizationPublicLinks.tsx`
- `src/organization/organizationApiClient.ts`
- `src/organization/organizationRoutes.ts`
- `src/organization/AdminMapPicker.tsx`
- `src/organization/organization-admin.css`

Tests:
- `tests/organizationAuth.test.ts`
- `tests/organizationSecurity.test.ts`
- `tests/organizationPasswordKdf.test.ts`
- `tests/organizationRoutes.test.ts`
- weitere Organization-/Security-Regressionen im aktuellen Tree selbst suchen.

Vorhandene Dateien sind keine automatische Abnahme. Für jede Master-Anforderung Positiv- und Negativpfade im Server/API und echte UI-Erreichbarkeit prüfen.

## Noch zu schließen — nicht überspringen

Arbeite diese Punkte evidence-driven ab. Wenn ein Punkt inzwischen implementiert ist, beweisen statt neu schreiben.

1. **Legacy Campaign Adoption**
   - expliziter Organizer-Flow;
   - niemals automatisch beim Bootstrap/Organization-Erstellen;
   - Tenant-/Status-Prüfung, Race-sicher;
   - Audit-Ereignis;
   - Tests: fremde/owned/already-adopted/unauthorized Campaign fail-closed.

2. **Admin-/Organizer Invites und Enrollment**
   - one-time, high entropy, kurzlebig, serverseitig hash-only;
   - recipient setzt Username/Passwort, enrollt TOTP, erhält Recovery Codes;
   - Organizer-Invite nur Organizer + frische High-Risk-Reauth;
   - clean-browser E2E.

3. **Account Security komplett**
   - Username ändern;
   - Passwort ändern;
   - Organizer-sicherer Passwort-Reset via one-time expiring hash-only link;
   - TOTP Reset/Re-enrollment;
   - Recovery Codes regenerieren;
   - Sessions listen/revoke one/revoke all;
   - Security-Änderungen Session-Revocation/Rotation korrekt;
   - Recovery-Session kann normale Admin-Mutationen nicht ausführen.

4. **Organizer/Admin Management**
   - mehrere Organizer/Admins;
   - Disable/Removal serverseitig;
   - last-active-organizer invariant auch bei konkurrierenden Requests;
   - keine Self-/Cross-Tenant-Eskalation.

5. **Role Templates und Capabilities**
   - ADR-0016 prüfen;
   - server-known Capability Registry, keine beliebigen Browser-Strings;
   - Named Role Templates CRUD/Assignment;
   - Organizer Vollrechte;
   - delegierbare Admin-Rechte klar begrenzt;
   - permanente Campaign-Löschung nicht delegierbar.

6. **Own-team vs Cross-team Authorization**
   - an kanonische Campaign/Team/Area/Task-Beziehungen binden;
   - IDs nur Selektoren;
   - positiver Own-Team-Test;
   - negativer Other-Team-Test;
   - positiver expliziter Cross-Team-Capability-Test;
   - Organization A -> B immer fail-closed.

7. **Admin UX / Campaign Console**
   - `/admin`: persistente Multi-Campaign-Liste vom Server;
   - `/new`: Name, gewünschter Mode/Type, optional Zeitraum, echter Map-Fokus/Radius, relevante Defaults/Policies, Review;
   - `/admin/campaign/:id`: Overview, Map/Areas, Teams, Access/Accounts, Roles/Rights, Features, Stats nur aus echten Daten, Activity/Audit, Settings, Danger Zone soweit Backend real vorhanden;
   - Desktop-first professionell, mobile Chromium brauchbar;
   - keine Fake-Charts/KPIs.

8. **Root Organizer Entry**
   - `/` darf Field Map nicht regressieren;
   - vorhandene Organization Session kann sicheren Organizer-Einstieg bieten;
   - keine automatische Privileg-/Campaign-Auswahl.

9. **Campaign Lifecycle/Delete**
   - draft/active/completed/archived korrekt und Field-kompatibel;
   - permanent delete Organizer-only + fresh reauth + genaue Bestätigung;
   - Audit + referentielle Integrität.

10. **Audit/Threat Model/Rate Limits**
    - Login/TOTP/Recovery/Invite/Reset/High-Risk-Endpunkte angemessen drosseln;
    - Strict same-origin für Cookie-Mutationen;
    - Audit ohne Secrets;
    - CSP/Security Header prüfen, ohne Field/Map APIs zu brechen.

11. **RxDB Regression**
    - Field Map `/` unverändert nutzbar;
    - komplette bestehende Tests nicht abschwächen;
    - Production Worker chain bleibt `indexFc52 -> ...`;
    - Organization-Daten nicht in RxDB.

12. **Isoliertes Admin-Staging + reale Browser-E2E**
    - zuerst `docs/operations/ORGANIZER_ADMIN_STAGING.md` lesen;
    - existierende `admin-staging-release-v6.yml` auf `organizer-admin-staging` ist bezüglich canonical `wrangler.main` veraltet und darf nicht blind deployed werden;
    - Workflow aus aktuellem Feature-Head neu ableiten;
    - Worker `flyer-map-admin-staging`;
    - D1 `flyer-map-admin-staging-db`;
    - niemals Production-D1 `0113e775-...` oder RxDB-Staging-D1 `bcec3432-...`;
    - eigene Rate-Limit Namespaces;
    - Organization KDF DO nur dort binden;
    - Tests/typecheck/audit/build/dry-run vor Deploy;
    - reale URL smoke-testen;
    - Bootstrap -> TOTP -> Session -> Campaign A/B -> Logout -> Cookies löschen -> Login -> Campaign A/B wieder sichtbar;
    - Invite Enrollment separat in clean browser testen;
    - Desktop und mobile Chromium prüfen.

## Arbeitsweise

Nicht nach jedem Fund anhalten. Reproduzieren/prüfen -> kleinsten sicheren Fix -> Tests -> committen/pushen -> exact-head CI -> bei Fehler Logs/Artifacts lesen -> weiterfixen. GitHub ist Source of Truth.

Vor jeder Remote-Schreiboperation Head neu prüfen, um parallele Änderungen nicht zu überschreiben. Bei mehreren Dateien bevorzugt einen atomaren Git-Data-Commit statt vieler Einzelcommits.

Tests nicht auf erwartete Implementierung umschreiben, wenn der Test eine reale Sicherheits-/Production-Invariante schützt.

## Dokumentation vor Abschluss

Wenn Behavior/Schema/Security/Deployment sich ändern, im selben Slice aktualisieren:

- Plan 030;
- `docs/status/CURRENT.md`;
- `docs/context-map.yaml` bzw. Organizer-Overlay;
- ADR bei neuer dauerhafter Architekturentscheidung;
- `ORGANIZATIONS.md`, `IDENTITY_PERMISSIONS.md`, `IDENTITY_THREAT_MODEL.md`, `SECURITY.md`, `DATA.md`, `ROADMAP.md` soweit das Verhalten tatsächlich akzeptiert/implementiert ist;
- diesen Handoff-Prompt erneut aktualisieren, bevor ein Chatwechsel nötig wird.

## Finaler Abnahmebericht — erst wenn wirklich fertig

Berichte am Ende mindestens:

- exakter Feature-Head;
- PR #76 weiter Draft/unmerged;
- exakter CI-Run und Gates: tests/typecheck/audit/build;
- Production-Wrangler/D1 unverändert bestätigt;
- angewandte Admin-Staging-Migrationen;
- Admin-Staging Worker + D1 IDs/Names und echter Test-Link;
- Browser-E2E-Matrix mit Bootstrap/TOTP/Recovery/Invite/Campaign A+B/Logout/Cookie-Clear/Login;
- positive/negative Tenant-/Role-/Cross-Team-/Last-Organizer-/Delete-Tests;
- Desktop/mobile smoke;
- bekannte Restrisiken, falls irgendein echtes Gerät nicht verfügbar war.

Keinen Test-Link als „fertig“ ausgeben, solange diese Gates nicht wirklich belegt sind.
