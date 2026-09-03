---
id: plan-030-organizer-admin-platform
type: plan
status: active
last_updated: 2026-09-03
related: [architecture-organizations, architecture-identity-threat-model, architecture-security, architecture-data, ADR-0015, ADR-0026]
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

## Anforderungen

### Identity und Security

- Stable Account ID unabhängig vom Username.
- Ein Account kann mehreren Organizations angehören.
- Username + Passwort + TOTP.
- PBKDF2-HMAC-SHA-256 mit 600.000 Iterationen als aktuelle Worker-kompatible Baseline.
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
- Neue Campaigns können mit Name und optionalem Map-Fokus erzeugt werden.
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

Der neue `worker/indexOrganizer.ts` liegt vor dem bestehenden `indexFc52.ts`. Organization-Routen werden dort abgefangen. Alle bestehenden Field-/RxDB-Routen fallen unverändert auf den vorhandenen Worker zurück.

## Dateistruktur

- `migrations/0018_organization_admin_platform.sql`: additive Organization-, Account-, MFA-, Membership-, Role-, Session-, Invite- und Audit-Tabellen plus Campaign-Tenant-Zuordnung.
- `worker/organizationAuth.ts`: Credential-Primitiven, TOTP, Recovery, Sessions, Membership-/Capability-Auflösung und Last-Organizer-Invariante.
- `worker/organizationApi.ts`: HTTP-Routen und serverseitige Organization-/Campaign-Autorisierung.
- `worker/indexOrganizer.ts`: Wrapper vor dem bestehenden Worker.
- `src/admin/*`: getrennte Admin-App, API-Client und Oberflächen.
- `tests/organization*.test.ts`: Security-, Tenant-, API- und Lifecycle-Regressionen.
- `.github/workflows/organizer-admin-staging.yml`: vollständig isoliertes Admin-Staging.

## Umsetzungsschritte

1. Organization-Schema als additive Migration 0018 einführen.
2. Account-/Password-/TOTP-/Recovery-/Session-Primitiven implementieren.
3. Bootstrap gegen First-Visitor-Race absichern.
4. Membership-/Capability-Auflösung und Last-Organizer-Schutz serverseitig implementieren.
5. Organization-API vor den bestehenden Worker schalten.
6. Organization-Dashboard und Login/Bootstrap/MFA-UI implementieren.
7. Campaign-Wizard mit echter MapLibre-Fokusauswahl implementieren.
8. Account-Invites, Role Templates, Capability-Editor und Session-Security-Oberfläche implementieren.
9. Legacy-Campaign-Adoption als expliziten Organizer-Flow mit Audit implementieren.
10. Sicheren Field-Bridge-Flow implementieren, der keine Rechte hochstuft.
11. Unit-/Integration-/Security-Tests vollständig machen.
12. Eigenes Admin-Staging mit eigenem Worker, D1, Rate-Limit-Namespaces und TOTP-Key aufbauen.
13. Chromium-E2E: Bootstrap, TOTP, Recovery, zwei Campaigns, Logout, Cookie-Clear, erneuter Login und serverseitiges Wiederfinden.
14. Desktop- und Mobile-Smokes durchführen.
15. Docs/Status aktualisieren und erst danach Production-Readiness bewerten.

## Akzeptanzkriterien

- Kein Organization-Endpunkt vertraut Browserrollen oder IDs als Autoritätsnachweis.
- Passwort, TOTP-Seed, Recovery-Code und Session-Secret stehen nicht im Klartext in D1.
- Akzeptierter TOTP-Counter ist nicht erneut verwendbar.
- Recovery-Code ist einmalig und erzeugt keine normale MFA-Sitzung.
- Letzter Organizer kann auch bei konkurrierenden Requests nicht entfernt werden.
- Account aus Organization A kann keine Daten aus Organization B lesen oder mutieren.
- Campaign-Erstellung bindet serverseitig an die autorisierte Organization.
- Existing Field Map und RxDB-Tests bleiben grün.
- Isoliertes Admin-Staging verwendet keine Production-D1 und keinen Production-Worker.
- Echter Browser-Login funktioniert nach vollständigem Cookie-/Browserzustands-Reset erneut.

## Risiken

- PBKDF2-600k muss auf dem tatsächlichen Worker-Budget weiter beobachtet werden.
- Legacy Campaign Access und Organization Account Authority dürfen nicht unbemerkt vermischt werden.
- Field-Bridge kann Rechte eskalieren, wenn Capability-Modelle zu grob übersetzt werden. Nicht eindeutig abbildbare Kombinationen müssen fail-closed bleiben.
- Migration 0018 verändert die Campaign-Tabelle additiv und darf Production nur nach expliziter Freigabe erreichen.
- TOTP-Key-Rotation benötigt vor Production einen dokumentierten Key-Version-Rollover.

## Entscheidungen

- Gewählt: Account global, Membership Organization-spezifisch.
- Gewählt: D1/Worker als einzige Authz-Grenze.
- Gewählt: Existing Worker als Fallback hinter einem kleinen Organization-Wrapper statt großer Rewrite.
- Gewählt: Admin-Lifecycle additiv neben bestehendem Field-Campaign-Status.
- Gewählt: Recovery-Sitzung mit niedrigerer Assurance.
- Gewählt: Legacy-Campaigns bleiben nach Migration unowned, bis ein Organizer sie explizit adoptiert.

## Nicht-Ziele

- Kein Production-Deploy in diesem Plan ohne separate Freigabe.
- Keine Production-D1-Migration ohne separate Freigabe.
- Kein Merge von PR #74, #75 oder #76 durch diesen Arbeitsauftrag.
- Keine Änderung des Rollback-Branches.
- Kein Ersatz von RxDB für operative Field-Daten.
- Keine native App, kein Service Worker und kein Background Sync.

## Offene Fragen / Unklarheiten

- UNKLAR: endgültige Idle- und Absolute-Session-Lifetime vor Production. Aktueller Testwert: 12 Stunden absolute Session.
- UNKLAR: UX und Operator-Prozess für den Katastrophenfall, wenn alle Organizer TOTP und Recovery-Codes verlieren.
- UNKLAR: finaler Production-Prozess für TOTP-Key-Rotation.
- UNKLAR: welche fein granularen Team-Capabilities aus der bestehenden Architektur im ersten Admin-Release sichtbar konfigurierbar werden.
