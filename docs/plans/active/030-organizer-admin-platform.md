---
id: plan-030-organizer-admin-platform
type: plan
status: active
last_updated: 2026-09-04
related: [organizations, identity-permissions, identity-threat-model, security, data, ADR-0015, ADR-0016, ADR-0026, plan-028-rxdb-local-first-mission-sync, operations-organizer-admin-staging, prompt-organizer-admin-latest]
---

# Plan 030: Organizer/Admin Platform

## Ziel

Eine getrennte Organization-/Organizer-Admin-Plattform wird auf Basis der verifizierten RxDB-Mission-Linie aufgebaut, ohne den funktionierenden Field-Flow oder Production zu verändern.

Die Plattform soll mehrere Organizations, mehrere Organizer/Admins, sichere MFA-Accounts, Organization-scoped Campaigns, Rollen/Capabilities, Audit und eine eigenständige Admin-Oberfläche unterstützen.

## Verifizierte Basis

- Source-Branch: `mission-rxdb-sync`.
- Start-Head dieser Linie: `33ab9c0d757da44e0b20b278982a548eafe732aa`.
- Arbeitsbranch: `feature/organizer-admin-platform`.
- Draft-PR: #76 gegen `mission-rxdb-sync`.
- PR #74 und PR #75 bleiben getrennt, Draft und ungemerged.
- Rollback-Branch `mission-release-2026-09-02-manual` bleibt unverändert.
- Production-D1 und Production-Worker bleiben unangetastet.
- RxDB bleibt für operative Campaign-Daten zuständig, nicht für Admin-Credentials oder Organization-Autorisierung.

### Aktueller Handoff-Marker

Vor dem Dokumentations-Handoff am 2026-09-04 wurde Feature-Head `fb437e2f23fc7c851ecd219cfb6ff38991bb95b2` mit CI-Run `33874224651` / #1077 = success verifiziert. Der Dokumentationscommit selbst erzeugt einen neueren Head; bei Wiederaufnahme immer Remote-Head und exact-head CI erneut prüfen.

Die kanonische Production-`wrangler.jsonc` wurde am genannten Head ausdrücklich wieder auf `./worker/indexFc52.ts` zurückgesetzt. Organizer/Admin darf diese committed Production-Konfiguration nicht als bequemen Deploy-Schalter auf `indexOrganizer.ts` ändern.

## Anforderungen

### Identity und Security

- Stable Account ID unabhängig vom Username.
- Ein Account kann mehreren Organizations angehören.
- Username + Passwort + TOTP.
- PBKDF2-HMAC-SHA-256 mit 600.000 Iterationen als Baseline; aktuelle Runtime lagert die Password-KDF über `OrganizationPasswordKdfDurableObject` aus dem normalen Worker-Request-Budget aus.
- TOTP-Seed AES-256-GCM-verschlüsselt mit Worker Secret.
- Einmalige Recovery-Codes, nur gehasht in D1.
- Opaque, revocable HttpOnly Session.
- Recovery-Session ist eingeschränkt und ersetzt keine normale MFA-Sitzung.
- Login Edge Rate Limit plus D1-Backoff.
- Strict same-origin für Organization-Schreibzugriffe.
- Keine Secrets in URL, LocalStorage, IndexedDB, RxDB, Audit oder Logs.

### Organization und Rechte

- Organization ist Tenant-Grenze.
- Organizer ist nicht Campaign Admin.
- Mehrere Organizer sind möglich.
- Mindestens ein aktiver Organizer muss erhalten bleiben.
- Admin-Capabilities kommen aus serverseitigen Role Templates und Membership-Regeln.
- Team-/Campaign-IDs sind nur Selektoren.
- Cross-Team-Rechte müssen explizit serverseitig erlaubt sein.
- Permanente Campaign-Löschung bleibt Organizer-only.

### Campaigns

- Campaign erhält `organization_id`.
- Legacy-Campaigns werden nach Migration nicht automatisch adoptiert.
- Admin-Lifecycle: `draft`, `active`, `completed`, `archived`.
- Neue Campaigns können mit Name und echtem Map-Fokus erzeugt werden; Master-Akzeptanz verlangt darüber hinaus die tatsächlich benötigten Mode/Zeitraum/Policy-Schritte des Wizards.
- Field-/RxDB-Vertrag bleibt unverändert kompatibel.

### Admin-Oberfläche

Zielrouten:

- `/start`
- `/login`
- `/admin`
- `/new`
- `/admin/campaign/:id`
- Account-/Role-/Security-Verwaltung innerhalb der Admin-Shell.

Desktop-first, aber mobile Chromium-tauglich. Die normale `/`-Route bleibt Field Map.

## Architektur

```text
Admin React App
  -> same-origin Organization API
  -> opaque Account Session
  -> Worker resolves Account + Membership + Capability
  -> D1 Organization tables
        | credentials / MFA / sessions / audit
        | campaign.organization_id
        v
  existing Campaign Worker / RxDB / Field Map
```

`worker/indexOrganizer.ts` liegt logisch vor dem bestehenden `indexFc52.ts`: Organization-Routen werden dort abgefangen, alle bestehenden Field-/RxDB-Routen fallen auf den vorhandenen Worker zurück. **Wichtig:** Das bedeutet nicht, dass Production-`wrangler.jsonc` auf `indexOrganizer.ts` zeigen darf. Der Organizer-Entry-Point wird nur in der isolierten Admin-Staging-/später ausdrücklich freigegebenen Deploy-Konfiguration gebunden.

## Dateistruktur – aktueller Stand

Backend/Data:

- `migrations/0018_organization_admin_platform.sql`: additive Organization-, Account-, MFA-, Membership-, Role-, Session-, Invite- und Audit-Tabellen plus Campaign-Tenant-Zuordnung.
- `migrations/0019_organization_security_hardening.sql`: additive Security-Härtung für nachgelagerte Account-/Reset-/Session-Flows.
- `worker/organizationAuth.ts`: Credential-Primitiven, TOTP, Recovery, Sessions, Membership-/Capability-Auflösung und Last-Organizer-Invariante.
- `worker/organizationApi.ts`: HTTP-Routen und serverseitige Organization-/Campaign-Autorisierung.
- `worker/organizationSecurity.ts`, `worker/organizationSecurityApi.ts`, `worker/organizationSecurityRequest.ts`: Security-Center-/Request-Layer.
- `worker/organizationBootstrapHashApi.ts`: serverseitiger Bootstrap-Hash-Helfer.
- `worker/organizationPasswordKdf.ts`, `worker/organizationPasswordKdfDurableObject.ts`: ausgelagerte Password-KDF-Runtime.
- `worker/indexOrganizer.ts`: Organizer-Wrapper vor dem bestehenden Worker, nicht der committed Production-Entry-Point.

Frontend:

- `src/organization/OrganizationApp.tsx`
- `src/organization/OrganizationSecurityCenter.tsx`
- `src/organization/OrganizationPublicLinks.tsx`
- `src/organization/organizationApiClient.ts`
- `src/organization/organizationRoutes.ts`
- `src/organization/AdminMapPicker.tsx`
- `src/organization/organization-admin.css`

Tests:

- `tests/organization*.test.ts` für Auth/Security/KDF/Routing und weitere aktuelle Organization-Regressionen.
- `tests/pickupReadRuntime.test.ts` schützt die Production-Worker-Kette und Organizer-Wrapper-Isolation.

Operations:

- `docs/operations/ORGANIZER_ADMIN_STAGING.md` ist der aktuelle Staging-Vertrag.
- Der bestehende V6-Staging-Workflow auf `organizer-admin-staging` ist hinsichtlich der canonical `wrangler.main`-Annahme veraltet und muss vor erneutem Deploy angepasst werden.

## Umsetzungsschritte und Fortschritt

1. **Schema 0018 einführen — implementiert, Production unapplied.**
2. **Account-/Password-/TOTP-/Recovery-/Session-Primitiven — implementierte Basis vorhanden; aktuelle Security-Akzeptanz weiter vollständig verifizieren.**
3. **Bootstrap gegen First-Visitor-Race absichern — Basis vorhanden; realen Staging-Smoke erneut gegen finalen Head beweisen.**
4. **Membership-/Capability-Auflösung und Last-Organizer-Schutz — Basis vorhanden; positive/negative und Concurrent-Akzeptanz beibehalten.**
5. **Organization-API vor bestehenden Worker schalten — Code vorhanden; nur in isolierter Organizer-Konfiguration deployen.**
6. **Dashboard/Login/Bootstrap/MFA-UI — Routen/UI vorhanden; Browser-E2E noch als finales Gate.**
7. **Campaign-Wizard mit MapLibre-Fokus — Basis vorhanden; Master-Felder/Policies und Persistenz gegen aktuellen Stand prüfen/ergänzen.**
8. **Account-Invites, Role Templates, Capability-Editor, Session Security — Security-Komponenten vorhanden, aber vollständige Master-Akzeptanz für Invite Enrollment, Rollen/Capabilities und Security-Flows noch beweisen/ergänzen.**
9. **Legacy-Campaign-Adoption — als offen behandeln, bis expliziter serverseitiger Flow + Audit + negative Tests nachgewiesen sind.**
10. **Sicherer Field-Bridge-Flow — als offen behandeln, bis keine Rechteeskalation und kanonische Team-/Campaign-Beziehungen positiv/negativ getestet sind.**
11. **Unit-/Integration-/Security-Tests — laufend vorhanden; vollständige Acceptance-Matrix noch schließen.**
12. **Eigenes Admin-Staging — Ressourcen/Workflow-Linie vorhanden, Workflow vor nächstem Deploy an Production-Isolation anpassen.**
13. **Chromium-E2E Bootstrap/TOTP/Recovery/2 Campaigns/Logout/Cookie-Clear/Login — finales Gate offen, bis auf aktuellem finalen Staging-Head belegt.**
14. **Desktop/mobile Smokes — finales Gate offen.**
15. **Docs/Status — Handoff-/Graph-Dokumentation am 2026-09-04 erweitert; Architektur-/Security-Dokumente weiter zusammen mit tatsächlich akzeptierten Runtime-Slices aktualisieren.**

## Akzeptanzkriterien

- Kein Organization-Endpunkt vertraut Browserrollen oder IDs als Autoritätsnachweis.
- Passwort, TOTP-Seed, Recovery-Code und Session-Secret stehen nicht im Klartext in D1.
- Akzeptierter TOTP-Counter ist nicht erneut verwendbar.
- Recovery-Code ist einmalig und erzeugt keine normale MFA-Sitzung.
- Letzter Organizer kann auch bei konkurrierenden Requests nicht entfernt werden.
- Account aus Organization A kann keine Daten aus Organization B lesen oder mutieren.
- Campaign-Erstellung bindet serverseitig an die autorisierte Organization.
- Legacy Campaign wird niemals automatisch durch Bootstrap/Organization-Erstellung adoptiert.
- Admin-/Organizer-Invite Enrollment funktioniert in sauberem Browser mit one-time/expiring/hash-only Token und TOTP-Enrolment.
- Role Templates verwenden einen serverbekannten Capability-Vertrag; own-team/other-team/cross-team Rechte sind serverseitig positiv/negativ getestet.
- High-Risk-Aktionen verlangen die vorgesehene MFA-/Reauth-Assurance.
- Existing Field Map und RxDB-Tests bleiben grün.
- Committed Production-Wrangler bleibt auf `indexFc52.ts` und enthält keine Organizer-Staging-Bindungen.
- Isoliertes Admin-Staging verwendet keine Production-D1 und keine RxDB-Staging-D1.
- Echter Browser-Login funktioniert nach vollständigem Cookie-/Browserzustands-Reset erneut und serverseitige Multi-Campaign-Persistenz ist sichtbar.
- Desktop und mobile Chromium zeigen die Admin-Flows ohne blockierende Responsive-/Accessibility-Fehler.

## Risiken

- KDF-DO-Bindung und DO-Migration müssen im Admin-Staging explizit vorhanden sein, ohne Production-Konfiguration zu verändern.
- Legacy Campaign Access und Organization Account Authority dürfen nicht unbemerkt vermischt werden.
- Field-Bridge kann Rechte eskalieren, wenn Capability-Modelle zu grob übersetzt werden. Nicht eindeutig abbildbare Kombinationen müssen fail-closed bleiben.
- Migrationen 0018/0019 verändern die Campaign-/Security-Daten additiv und dürfen Production nur nach expliziter Freigabe erreichen.
- TOTP-Key-Rotation benötigt vor Production einen dokumentierten Key-Version-Rollover.
- Ein Staging-Workflow darf niemals geheime Bootstrap-/TOTP-/Password-Werte in öffentliche Logs oder Artifacts schreiben.

## Entscheidungen

- Gewählt: Account global, Membership Organization-spezifisch.
- Gewählt: D1/Worker als einzige Authz-Grenze.
- Gewählt: Existing Worker als Fallback hinter einem kleinen Organization-Wrapper statt großer Rewrite.
- Gewählt: Production-Worker-Kette bleibt bis zu separater Freigabe `indexFc52.ts`; Organizer-Wrapper ist deploy-spezifisch isoliert.
- Gewählt: Admin-Lifecycle additiv neben bestehendem Field-Campaign-Status.
- Gewählt: Recovery-Sitzung mit niedrigerer Assurance.
- Gewählt: Legacy-Campaigns bleiben nach Migration unowned, bis ein Organizer sie explizit adoptiert.
- Gewählt: Password-KDF über eine Organizer-spezifische Durable-Object-Runtime statt die 600k PBKDF2-Arbeit ungebunden im normalen Worker-Request auszuführen.

## Nicht-Ziele

- Kein Production-Deploy in diesem Plan ohne separate Freigabe.
- Keine Production-D1-Migration ohne separate Freigabe.
- Kein Merge von PR #74, #75 oder #76 durch diesen Arbeitsauftrag.
- Keine Änderung des Rollback-Branches.
- Kein Ersatz von RxDB für operative Field-Daten.
- Keine native App, kein Service Worker und kein Background Sync.

## Offene Fragen / Unklarheiten

- UNKLAR: endgültige Idle- und Absolute-Session-Lifetime vor Production. Aktueller Test-/Entwicklungswert muss gegen Code erneut verifiziert werden; keine Dokumentangabe als alleinige Wahrheit verwenden.
- UNKLAR: UX und Operator-Prozess für den Katastrophenfall, wenn alle Organizer TOTP und Recovery-Codes verlieren.
- UNKLAR: finaler Production-Prozess für TOTP-Key-Rotation.
- UNKLAR: endgültiger sichtbarer Capability-Satz des ersten Admin-Releases; Implementation muss an den serverbekannten Registry-/ADR-Vertrag gebunden bleiben.

## Wiederaufnahme

Für einen neuen Chat nach den normalen Entry-Points `docs/context-organizer-admin.yaml` und `docs/prompts/CONTINUE_ORGANIZER_ADMIN_LATEST.md` laden. Danach Remote-Head/PR/CI neu verifizieren und die offene Acceptance-Matrix ohne Neuaufbau fortsetzen.
