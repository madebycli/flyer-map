---
id: ADR-0026
type: decision
status: accepted
date: 2026-09-03
related: [architecture-organizations, architecture-identity-threat-model, architecture-security, ADR-0015, plan-030-organizer-admin-platform]
---

# ADR-0026: Organization-scoped Admin identity and authorization

## Entscheidung

Die langfristige Admin-Plattform verwendet eine stabile Account-Identität mit separaten Organization Memberships. Ein Account kann mehreren Organizations angehören. Organization ist die absolute Tenant-Grenze.

Die neue Linie wird isoliert auf `feature/organizer-admin-platform` entwickelt. Diese Entscheidung autorisiert keinen Production-Deploy und keine Production-D1-Migration.

## Authentifizierung

- Username ist global kanonisiert und initial auf ASCII-Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich beschränkt.
- Passwort-Verifier ist PBKDF2-HMAC-SHA-256 mit mindestens 600.000 Iterationen, 16 Byte zufälligem Salt und 32 Byte Verifier.
- Login benötigt Passwort plus TOTP.
- TOTP verwendet 160 Bit zufälligen Seed, 30 Sekunden Schritt, 6 Ziffern und eine Toleranz von maximal einem benachbarten Schritt.
- Erfolgreich verwendete TOTP-Counter dürfen nicht erneut akzeptiert werden.
- TOTP-Seeds werden mit AES-256-GCM verschlüsselt. Der Schlüssel kommt ausschließlich aus einem Worker Secret.
- Recovery-Codes sind hochentropisch, einmal verwendbar und werden nur gehasht gespeichert.
- Recovery-Login erstellt nur eine eingeschränkte `recovery`-Sitzung. Sicherheitskritische Organization-Mutationen benötigen eine `mfa`-Sitzung.
- Account-Sessions sind opaque. D1 speichert nur SHA-256-Hashes der Session-Secrets.
- Browser-Cookie ist `__Host-vf_organization_session` mit `Secure`, `HttpOnly`, `Path=/` und `SameSite=Lax`.

## Bootstrap

Es gibt kein anonymes First-Visitor-Claiming. Der initiale Bootstrap benötigt ein serverseitiges `ORGANIZATION_BOOTSTRAP_SECRET`.

Ein Singleton-D1-Lock wird in derselben atomaren Batch wie Organization, Account, Credentials, Membership und Recovery-Codes geschrieben. Nur ein Bootstrap kann erfolgreich sein.

Weitere Organizations dürfen später nur von einem bereits vollständig authentifizierten Organizer erzeugt werden.

## Autorisierung

- Authentication und Authorization bleiben getrennt.
- IDs sind Selektoren, keine Berechtigungsnachweise.
- Jede Organization-Admin-Mutation löst Account Session und aktive Membership serverseitig aus D1 auf.
- Organizer besitzt den vollständigen Organization-Capability-Satz.
- Admin-Capabilities werden serverseitig aus Role Template plus expliziten Membership-Capabilities aufgelöst.
- Recovery-Sessions erhalten keine normalen Admin-Capabilities.
- Der letzte aktive Organizer darf nicht deaktiviert werden. Die Invariante liegt in der bedingten D1-Mutation und nicht nur in der UI.
- Permanente Campaign-Löschung bleibt Organizer-only und darf nicht durch ein normales Admin-Template delegiert werden.

## Campaign-Zuordnung

`campaigns.organization_id` ist die kanonische Tenant-Zuordnung. Bestehende Legacy-Campaigns bleiben nach Migration zunächst `NULL` und werden nicht still einer Organization zugeordnet.

Die Admin-Lifecycle-Sicht `draft | active | completed | archived` liegt in `campaigns.admin_lifecycle_status`. Der bestehende Field-/RxDB-Vertrag bleibt kompatibel, `completed` wird im vorhandenen Campaign-Status weiterhin als aktive operative Campaign behandelt, bis sie archiviert wird.

## RxDB-Grenze

Credential-, Session-, TOTP-, Recovery-, Membership-, Role- und Auditdaten gehören nicht in RxDB. RxDB bleibt ausschließlich für lokale operative Campaign-Daten zuständig.

## Rate Limits und CSRF

Passwort-Login besitzt zwei Schutzschichten:

1. Cloudflare Worker Rate Limiting Binding für Edge-Drosselung.
2. D1-basierter account-keyed Backoff als dauerhaftere Schutzschicht.

Organization-Schreibzugriffe mit Cookie-Sitzung verlangen denselben `Origin` wie der Worker.

## Kosten und Skalierung

Die Architektur verwendet vorhandene Cloudflare-Komponenten: Worker, D1 und Rate Limiting Binding. Es wird kein zusätzlicher Identity-SaaS eingeführt. Die Kosten bleiben damit an die bestehende Plattform gekoppelt.

Die Account Session ist account-global, Memberships sind Organization-spezifisch. Dadurch entstehen bei mehreren Organizations keine duplizierten Credential-Sätze.

## Verworfen

### Campaign-Admin-Konto als langfristige Identität

Verworfen, weil es Identity und Membership an eine einzelne Campaign bindet und Multi-Organization, Rollen-Templates sowie zentrale Audit-/Security-Verwaltung unnötig duplizieren würde.

### Browserseitige Rollenclaims

Verworfen, weil der Browser nicht vertrauenswürdig ist und Tenant-/Capability-Entscheidungen serverseitig erfolgen müssen.

### Stateless JWT-only Sessions

Verworfen, weil Disable, Recovery, Rollenänderungen und Security-Änderungen serverseitige sofortige Revocation benötigen.

## Release-Gates

Vor einer Production-Freigabe müssen mindestens bestehen:

- Migration 0018 auf isolierter Admin-Staging-D1;
- Unit-/Integrationstests für Hashing, TOTP, Replay, Recovery, Session-Revocation, Last Organizer und Tenant-Isolation;
- Login-Rate-Limit-Verifikation;
- Browser-E2E für Bootstrap, MFA, Logout und erneuten Login;
- Admin-UI-Smokes auf Desktop und mobilem Chromium;
- Security-Review ohne Secrets in Logs, URLs, LocalStorage, IndexedDB oder RxDB;
- explizite Production-Migrations- und Deploy-Freigabe.
