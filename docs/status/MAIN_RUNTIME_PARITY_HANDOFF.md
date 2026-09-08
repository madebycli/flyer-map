---
id: status-main-runtime-parity-handoff
type: status
status: candidate
last_updated: 2026-09-08
related: [plan-033-main-runtime-parity-and-domain-aliases, ADR-0028, operations-deployment]
---

# Main Runtime Parity Handoff

## Source und Scope

- Source `origin/main`: `4d860e8640761c10afdadb62a10ebb59fd43841f`.
- Arbeitsbranch: `fix/main-runtime-parity`, direkt von diesem Main erstellt.
- Draft-PR: #80 gegen `main`.
- Verifizierter Runtime-Head: `1c9e567abb2b37d585af5fc98d649485fbe35410`.
- Kanonischer Main Entry Point: `worker/indexOrganizer.ts`.
- Historische Feature- und Staging-Branches wurden nicht portiert oder verändert.
- PR #79 bleibt ein getrennter pausierter Draft.

## Ergebnis

Der vollständige Main Entry umschließt weiterhin `indexFc52.ts` und damit Core Campaign, Field Groups, Activity/Statistics, Collection/Pickup, RxDB und Static Assets. Derselbe Worker ergänzt Organization Auth, Organization Security, Admin-Routen, Bootstrap-Hash und den Password-KDF Durable Object.

`/api/runtime` liefert eine nicht-sensitive Cloudflare-Version, Umgebung und Capability-Flags. Es veröffentlicht keine Secrets, Datenbank-IDs oder internen Schlüssel.

Die Integration beweist mit `https://one.flyer.test` und `https://two.flyer.test`:

- zwei unterschiedliche `__Host-vf_organization_session`-Werte für dasselbe Account;
- dieselbe Organization Membership und dieselbe stabile `campaign_shared`;
- Mutation auf Origin A wird im normalen D1-Snapshot auf B sichtbar;
- Mutation auf B wird auf A sichtbar;
- beide Origins lesen denselben RxDB-Checkpoint;
- D1 enthält eine Campaign und einen Change-Feed-Scope, keine Domain-Kopien;
- ein Write mit abweichendem `Origin` erhält 403.

Organization `/me` liefert ohne Session 401. HEAD `/me` liefert 405. Password Login mit sicher ungültigem Input wird als bekannte Route verarbeitet. Unbekannte APIs bleiben JSON und fail-closed.

## Geänderte Runtime- und Konfigurationsdateien

- `worker/indexOrganizer.ts`: Runtime Capability Contract.
- `wrangler.jsonc`: vollständiger Entry, Organization KDF Durable Object, Login Rate Limiter, `nodejs_compat`, Version Metadata und Main-Umgebung.
- `tests/mainRuntimeParity.test.ts`: Organization Route Smoke und Zwei-Origin-Shared-State-Vertrag.
- bestehende Composition-/Pickup-/RxDB-Invariantentests: neue kanonische Entry-Erwartung.
- ADR-0028, Plan 033, Architecture, Security, Deployment, Current Status und Context Graph.

## Tests und Evidenz

- zielgerichtete Main Runtime, Route, Pickup und Durable-Object-Verträge: PASS.
- Zwei-Origin Shared Campaign, bidirektionale Mutation, Checkpoint, Host-unabhängige IDs: PASS.
- lokaler Typecheck über kompatiblen TypeScript-JS-Checker: PASS.
- Dependency Audit: PASS, 0 Schwachstellen.
- Production Build: PASS.
- vollständiger lokaler Testlauf: Die fachlichen Tests bestehen; der Unix-Socket-basierte RxDB-Mehrtab-Test kann in dieser Sandbox nicht lauschen. GitHub CI muss den nativen TypeScript-7- und vollständigen Testlauf als verbindliches Gate ausführen.
- exact Runtime-Head GitHub CI: PASS, Run `34214219630`; Tests, nativer TypeScript-7-Typecheck, Dependency Audit und Production Build grün.

## Security-Auswirkung

Organization Tenant- und Capability-Auflösung bleiben serverseitig. Cookies bleiben `Secure`, `HttpOnly`, `__Host-`, `Path=/` und `SameSite=Lax`. Es wird kein Cross-Origin Cookie und kein Wildcard-CORS eingeführt. Jede Domain authentifiziert separat. Domainnamen werden nur für HTTP-Origin-Prüfungen verwendet, niemals als Daten-ID.

Die bekannten Findings SEC-001 bis SEC-007 und Fresh-MFA werden hier nicht als geschlossen markiert. SYNC-CURSOR-001 bleibt ebenfalls getrennt offen.

## Production-Aktivierungsvoraussetzungen

Vor Merge oder Production-Aktivierung separat nachweisen:

1. Production-D1 Backup und Migrationsledger sichern.
2. Migrationen 0017, 0018, 0019 und 0020 als ausstehend oder angewendet eindeutig feststellen und fehlende Migrationen additiv in Reihenfolge anwenden.
3. Bindings prüfen: `DB`, `CAMPAIGN_SYNC`, `ORGANIZATION_PASSWORD_KDF`, `ORGANIZATION_LOGIN_LIMITER`, bestehende Field-Group- und Pickup-Limiter.
4. Secrets prüfen: `ORGANIZATION_TOTP_KEY`, `FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY`; Bootstrap-Hash nur falls Initialisierung noch benötigt wird.
5. beide SQLite Durable-Object-Migrationstags und `nodejs_compat` prüfen.
6. genehmigte Custom Domains müssen auf exakt denselben Worker mit derselben D1 zeigen.
7. exact-head CI und anschließend ein isolierter Runtime-Smoke müssen grün sein.
8. Master muss den Main-Merge wegen des automatischen Production-Builds separat freigeben.

Es wurden keine Production-Migration, kein Production-Deploy und keine Secret-Rotation ausgeführt.

## Statusmatrix

| Gate | Status | Evidenz |
|---|---|---|
| MAIN-RUNTIME-PARITY | PASS | `indexOrganizer.ts` umschließt vollständige Runtime; Organization Route Matrix grün |
| MULTI-DOMAIN-SAME-PROJECT | PASS | Zwei Origins, zwei Sessions, eine Campaign, bidirektionale Mutation |
| ORGANIZATION-LOGIN-ROUTING | PASS | `/me` 401, HEAD 405, Password Route erkannt |
| HOST-INDEPENDENT-DATA-ID | PASS | unveränderte Campaign-/Task-ID und ein Change-Feed-Scope |
| SAME-ORIGIN-WRITE-GUARD | PASS | abweichender Origin 403 |
| EXACT-RUNTIME-HEAD-CI | PASS | PR #80, Head `1c9e567a`, CI `34214219630` vollständig grün |
| PRODUCTION-ACTIVATION | NOT AUTHORIZED | kein Merge, Deploy, D1-Write oder Secret-Wechsel |
