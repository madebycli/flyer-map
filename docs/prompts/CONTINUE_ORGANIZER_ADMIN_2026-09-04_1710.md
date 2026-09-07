# Organizer/Admin Platform — Weiterarbeit ab 2026-09-04 17:10 CEST

Arbeite direkt am bestehenden GitHub-Projekt `madebycli/flyer-map` weiter. **Nicht neu anfangen, nichts resetten, nicht nur analysieren.** Repository/GitHub ist die einzige Source of Truth. Verifiziere vor jeder Änderung Remote-Heads, PRs, exact-head CI, Dateien und den realen Cloudflare-Staging-Zustand. Die SHAs unten sind Übergabemarker, keine unveränderlichen Wahrheiten.

## Master-Ziel

Führe die Organizer/Admin-Plattform bis zu einer **wirklich testbaren, isolierten Admin-Staging-Version** fort. Nicht mit einem Link aufhören, solange der echte Cloudflare-Erfolgspfad und Browser-E2E nicht grün sind. Nur dann eine Frage stellen, wenn für Produkt/Architektur tatsächlich eine Entscheidung des Masters erforderlich ist. Technische Fehler, CI, Tests, Logs, Code und Deployments selbständig lösen.

## Zuerst lesen

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/context-organizer-admin.yaml`
5. `docs/context-organizer-admin-live.yaml`
6. `docs/status/ORGANIZER_ADMIN_LIVE_HANDOFF.md`
7. `docs/plans/active/030-organizer-admin-platform.md`
8. `docs/decisions/ADR-0026-organization-admin-identity-and-authorization.md`
9. `docs/architecture/ORGANIZATIONS.md`
10. `docs/architecture/IDENTITY_PERMISSIONS.md`
11. `docs/architecture/IDENTITY_THREAT_MODEL.md`
12. `docs/architecture/SECURITY.md`
13. `docs/architecture/DATA.md`
14. `docs/operations/ORGANIZER_ADMIN_STAGING.md`

Danach nur relevante Code-/Testknoten nachladen.

## Zuletzt exakt verifizierter GitHub-Stand

Zeitpunkt: 2026-09-04 17:10 CEST.

- Repo: `madebycli/flyer-map`.
- Source/Base: `mission-rxdb-sync` = `33ab9c0d757da44e0b20b278982a548eafe732aa`.
- Feature vor diesem Handoff-Slice: `feature/organizer-admin-platform` = `b772906d1cbf046cb982afc46d682c3cbba596c4`.
- Exact-head Feature CI: Run `33881431786`, CI #1079 = success.
- PR #76: open, Draft, unmerged, mergeable, Base `mission-rxdb-sync`.
- PR #74: open, Draft, unmerged, Head `33ab9c0d...`.
- PR #75: open, Draft, unmerged, Head `501b8058...`.
- Rollback `mission-release-2026-09-02-manual`: nicht verändern.

Nach diesem Dokumentations-Handoff gibt es neuere reine Docs-Heads. Deshalb beim Start **immer aktuellen Feature-Head + exact-head CI neu lesen**, nicht blind auf `b772...` stehen bleiben.

## Harte Grenzen

- Kein Merge.
- PR #76 Draft lassen; nicht Ready markieren.
- Kein Production-Deploy.
- Keine Production-D1-Migration.
- Rollback-Branch nicht anfassen.
- PR #74/#75 nicht in diese Linie mischen.
- Keine Abschwächung vorhandener Tests, TypeScript-Regeln, Dependency-Audit, Authz-Checks oder Security-Header-Gates.
- Keine neue Ausbreitung von `any`, `unknown as`, `@ts-ignore` oder tsconfig-Escape-Hatches.
- Keine Secrets in Repository, Logs, URLs, LocalStorage, IndexedDB, RxDB oder öffentlichen Artifacts.

## Production-Isolation — P0-Invariante

Committed `wrangler.jsonc` muss Production-sicher bleiben:

```text
main = ./worker/indexFc52.ts
Production D1 = 0113e775-1e43-4d96-8b97-51fdeec7355b
Production rate namespaces = 91714001, 91714002, 91714003
```

Kein `ORGANIZATION_LOGIN_LIMITER` und kein Organizer-Entry-Point in committed Production config. `worker/indexOrganizer.ts` ist nur der Organizer/Admin-Wrapper und wird ausschließlich durch isolierte Staging-/später explizit freigegebene Deployment-Konfiguration gebunden. `tests/pickupReadRuntime.test.ts` schützt diese Grenze.

## Produkt-/Security-Vertrag

Hierarchie:

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

Verträge:

- Organization ist absolute Tenant-Grenze.
- Account global, Membership Organization-scoped.
- IDs nur Selektoren; Worker/D1 lösen Session, Membership und Capability serverseitig auf.
- `/` bleibt normale Field Map.
- Credentials/MFA/Sessions/Memberships/Roles/Audit niemals in RxDB.
- ADR-0026 ist accepted.
- stable Account ID; Username änderbar.
- PBKDF2-HMAC-SHA-256 mindestens 600.000 Iterationen.
- TOTP 160-bit Seed, 30s, 6 digits, ±1, Replay-Schutz, AES-256-GCM verschlüsselt.
- Recovery Codes one-time/hash-only; Recovery-Session ist keine normale MFA-Assurance.
- opaque revocable `__Host-vf_organization_session`, Secure/HttpOnly/SameSite=Lax/Path=/.
- Bootstrap nur serverseitig kontrolliert, kein First-Visitor-Claim.
- mindestens ein aktiver Organizer bleibt erhalten.
- permanente Campaign-Löschung Organizer-only + fresh high-risk reauth.
- Legacy Campaign `organization_id` bleibt NULL bis expliziter Adoption.

## Vorhandene Implementation — zuerst prüfen, nicht blind neu schreiben

Backend/Data:

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
- weitere `tests/organization*.test.ts` selbst suchen
- `tests/pickupReadRuntime.test.ts` für Production-Worker-Isolation

## AKTUELLER P0 — GENAU HIER FORTSETZEN

Nicht zuerst neue UX/Features bauen. Zuerst realen Cloudflare-Runtime-P0 schließen.

### Admin-Staging V7

- Branch: `organizer-admin-staging`.
- Head: `f0e17da54592d37ae6b8c9b3bc23089e2b369e6f` (`ci: harden admin staging release gate`).
- Workflow: `.github/workflows/admin-staging-release-v7.yml`.
- Run: `33875342446` = failure.
- Worker: `flyer-map-admin-staging`.
- D1: `flyer-map-admin-staging-db`.
- URL: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`.
- **URL existiert, ist aber NICHT test-ready.**

V7 checkt bewusst den auditierten Source-Commit `fb437e2f23fc7c851ecd219cfb6ff38991bb95b2` aus und materialisiert Organizer-Config nur im Runner. Nach dem Runtime-Fix den Workflow auf den dann aktuellen grünen Feature-Head aktualisieren.

### Was der V7-Run beweist

Grün:

- exact audited source + Production-safe baseline;
- npm ci;
- Tests;
- Typecheck;
- Dependency Audit;
- Production-safe Build;
- Cloudflare Account/D1 isolation;
- Organization migrations;
- TOTP secret configuration;
- smoke candidate build/deploy/convergence;
- cleanup;
- final private rebuild/deploy;
- checked-in Production config blieb unangetastet.

### Echter Fehler 1 — KDF Durable Object

`admin-staging-v7-diagnostics`:

```text
runtime_smoke.ok = false
stage = bootstrap
http_status = 503
error_code = organization_password_kdf_unavailable
reason = response_500_kdf_failed
```

Candidate Deploy zeigt Bindung:

```text
env.ORGANIZATION_PASSWORD_KDF -> OrganizationPasswordKdfDurableObject
env.ORGANIZATION_PASSWORD_KDF_ITERATIONS = 600000
```

Damit ist die Namespace-Bindung vorhanden, aber der interne DO/KDF Request-Response-Pfad liefert 500. Nicht einfach Iterationen reduzieren. Root Cause reproduzieren und den DO-Vertrag fixen.

Cleanup-Evidence:

```text
bootstrap_count = 0
organization_count = 0
account_count = 0
owned_campaign_count = 0
```

Der fehlgeschlagene Bootstrap hat also keine halbe Organization/Identity hinterlassen.

### Echter Fehler 2 — `/api/*` HEAD/SPA-Fallback

Finaler Public-Safety-Artifact:

- `GET /start` = 200.
- unauth `GET /api/organization/me` = 401.
- Cross-Origin Bootstrap = 403.
- rotierter Smoke-Bootstrap wird nach Convergence mit 403 abgewiesen.
- aber `HEAD /api/organization/me` liefert `HTTP 200`, `content-type: text/html`, Cloudflare SPA/assets response und nicht den erwarteten API-/Security-Response.
- Header-Dump enthält nicht `X-Frame-Options: DENY`.

Das ist ein echter API-Method-/Fallback-Randfall. Nicht einfach den Test löschen. `/api/*` muss für unsupported methods fail-closed bleiben und darf nicht als SPA HTML 200 enden; Security Headers müssen konsistent sein.

### Finaler aktuell deployter Staging-Worker aus dem Artifact

- Version ID: `1f9734ce-1bb6-47b3-9137-59f2fcc600a1`.
- Er ist nach Cleanup/final restore deployt, aber wegen der oben genannten Fehler **nicht freigegeben**.

## Konkrete nächste technische Schritte

1. Feature-Head, PR #76, staging head und aktuelle Actions neu verifizieren.
2. `worker/organizationPasswordKdf.ts`, `worker/organizationPasswordKdfDurableObject.ts`, `worker/indexOrganizer.ts` und V7 materialized-config code lesen.
3. KDF DO fetch request/response lokal/Workerd bzw. mit sicherer Staging-Diagnostik reproduzieren.
4. Sanitisierten internen Fehlergrund erfassen. Niemals Passwort, Salt, Hash, derived key, TOTP-Key oder Bootstrap-Secret loggen.
5. Root Cause des DO-500 beheben. PBKDF2 600k nicht still absenken.
6. Regressiontest ergänzen, der die tatsächliche serialisierte Durable-Object-Fetch-Schnittstelle und Failure-Mapping abdeckt.
7. `/api/*` HEAD/unsupported methods fail-closed machen; Regressiontest: kein SPA HTML 200 und Security Headers vorhanden.
8. Feature commit/push; exact-head CI vollständig grün: Tests, Typecheck, Audit, Build.
9. Admin-Staging-Workflow auf exakt diesen Feature-Head aktualisieren. Committed Production Wrangler unangetastet lassen.
10. Isolierte D1/Migrationen/Safety neu prüfen.
11. Realer API-Smoke muss vollständig grün sein:
    - `/start` 200;
    - Bootstrap 201;
    - Password Challenge/Login;
    - TOTP;
    - authenticated `/api/organization/me` mit MFA-Assurance.
12. Danach realer Chromium-Gate:
    - bootstrap Organizer;
    - Campaign A erstellen;
    - Campaign B erstellen;
    - beide im Dashboard sehen;
    - Logout;
    - Cookies/Storage löschen;
    - Login + TOTP;
    - Campaign A+B erneut serverseitig sehen.
13. Invite Enrollment separat in clean browser.
14. Desktop + mobile Chromium smoke.
15. Erst wenn Final Gate vollständig grün: Test-Link + Setup-Verfahren herausgeben.

## Danach verbleibende Master-Acceptance

Evidence-driven abarbeiten; wenn bereits vorhanden, beweisen statt neu schreiben:

1. explizite Legacy Campaign Adoption + Audit + negative foreign/owned/already-adopted/unauthorized/Race Tests;
2. Admin-/Organizer Invites one-time/high entropy/expiring/hash-only + clean-browser Password/TOTP/Recovery enrollment;
3. Account Security komplett: Username, Password, Organizer reset link, TOTP reset, Recovery regeneration, session list/revoke one/all;
4. Organizer/Admin management + disable/remove + concurrent last-organizer invariant + keine Self-/Cross-Tenant-Eskalation;
5. Named Role Templates CRUD/assignment + server-known Capability Registry + Organizer full rights + begrenzte Admin delegation;
6. Own-team vs Other-team vs explizite Cross-team Authorization an kanonischen Campaign/Team/Area/Task-Beziehungen;
7. `/admin` Multi-Campaign server list, `/new` mit Name/Mode/Zeitraum/Map-Fokus/Policies/Review soweit Master-Anforderung, `/admin/campaign/:id` professionelle Console;
8. Root Organizer entry ohne Field Map zu hijacken;
9. lifecycle draft/active/completed/archived + Organizer-only permanent delete + fresh reauth + exact confirmation + audit;
10. Audit/Threat Model/Rate Limits/CSP/Security Headers vollständig;
11. kein RxDB-/Field-Regression;
12. Responsive Desktop/Mobile Admin UX ohne Fake-Charts/KPIs.

## Arbeitsweise

Nicht nach jedem Fund stoppen. Reproduzieren -> Logs/Artifacts lesen -> kleinsten sicheren Fix -> Tests -> commit/push -> exact-head CI -> bei Fehler erneut Logs/Artifacts -> weiter. GitHub ist Source of Truth.

Vor jeder Remote-Schreiboperation Head neu prüfen. Bei mehreren Dateien atomaren Git-Data-Commit bevorzugen. Bestehende grüne Tests nicht auf gewünschte Implementierung umschreiben, wenn sie eine echte Safety-/Production-Invariante schützen.

## Dokumentation vor nächstem Chatwechsel

Wenn Behavior/Schema/Security/Deployment geändert wurde, im selben Slice aktualisieren:

- `docs/status/CURRENT.md`;
- `docs/context-organizer-admin.yaml` und `docs/context-organizer-admin-live.yaml`;
- `docs/status/ORGANIZER_ADMIN_LIVE_HANDOFF.md`;
- Plan 030;
- `docs/operations/ORGANIZER_ADMIN_STAGING.md`;
- ADR/ORGANIZATIONS/IDENTITY_PERMISSIONS/IDENTITY_THREAT_MODEL/SECURITY/DATA/ROADMAP soweit tatsächlich akzeptiertes Verhalten betroffen ist;
- diesen oder einen neuen lossless Handoff-Prompt.

## Finaler Abnahmebericht — erst bei wirklich fertiger Testversion

Mindestens nennen/belegen:

- exakter Feature-Head;
- PR #76 weiter Draft/unmerged;
- exact-head CI Run + Tests/Typecheck/Audit/Build;
- Production-Wrangler/D1 unverändert;
- Admin-Staging Head/Workflow/Run;
- Worker + D1 Name und ID;
- angewandte Admin-Staging-Migrationen;
- finaler Cloudflare Version ID + echter Test-Link;
- realer Bootstrap/Password/TOTP/Session API-Smoke;
- Browser-Matrix Bootstrap/TOTP/Recovery/Invite/Campaign A+B/Logout/Cookie-Clear/Login;
- positive/negative Tenant-/Role-/Cross-Team-/Last-Organizer-/Delete-Tests;
- Desktop/mobile smoke;
- bekannte Restrisiken.

**Keinen Test-Link als „fertig“ ausgeben, solange Bootstrap 201 und die realen Browser-Gates nicht belegt sind.**
