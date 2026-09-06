---
id: operations-organizer-admin-staging
type: operations
status: active
last_updated: 2026-09-06
related: [plan-030-organizer-admin-platform, plan-031-field-ui-navigation, ADR-0026, ADR-0014, plan-028-rxdb-local-first-mission-sync]
---

# Organizer/Admin Staging

## Zweck

Organizer/Admin hat zwei strikt getrennte Cloudflare-Testlinien:

1. persistentes manuelles Staging für laufende Entwicklung und manuelle QA;
2. eine disposable Acceptance-Umgebung für destruktive Plan-031-API- und Browser-Tests.

Production-D1/Worker und RxDB-Staging dürfen für Organization-/Credential-Migrationen niemals wiederverwendet werden.

## Geschützte Ressourcen

Production:

- committed `wrangler.jsonc`;
- Entry Point `./worker/indexFc52.ts`;
- D1 `0113e775-1e43-4d96-8b97-51fdeec7355b`;
- Rate-Limit Namespaces `91714001`, `91714002`, `91714003`.

RxDB-Staging:

- Worker `flyer-map-staging`;
- D1 `bcec3432-18ec-42a2-970a-64d52c8263d5`.

## Persistentes manuelles Admin-Staging

- Branch `organizer-admin-staging`;
- Workflow `.github/workflows/admin-staging-persistent.yml`;
- Worker `flyer-map-admin-staging`;
- D1 `flyer-map-admin-staging-db`;
- Organizer Entry Point `worker/indexOrganizer.ts`;
- Organization Password KDF DO `OrganizationPasswordKdfDurableObject`;
- separate Staging Rate-Limit Namespaces `91914001`, `91914002`, `91914003`, `91914004`;
- Public URL: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`.

Der persistente Workflow:

- löst den aktuellen Head von Draft-PR #76 auf und auditert genau diesen Product-Head;
- führt Tests, Typecheck, Dependency Audit und Production Build erneut aus;
- materialisiert ausschließlich eine isolierte Organizer-Konfiguration;
- wendet Migrationen nur auf `flyer-map-admin-staging-db` an;
- führt keinen Remote-Cleanup und kein `DELETE FROM` aus;
- vergleicht normalisierte D1-Zählungen vor und nach dem Deploy;
- prüft Foreign Keys, Production-Grenzen, Security Header und öffentliche Safety-Endpunkte.

### Persistenz- und Secret-Regel

Der Bootstrap-Digest ist stabil und wird bei Code-Deploys nicht gewechselt. Der zugehörige Klartext wird nur für die einmalige Ersteinrichtung unter `/start` gebraucht. Nach erfolgreichem Bootstrap arbeitet der Organizer mit Account-Passwort und MFA weiter; normale Deploys verlangen den Setup-Key nicht erneut.

- Im Repository, in Logs und Artifacts liegt kein Bootstrap-Klartext.
- `ORGANIZATION_TOTP_KEY` wird bei bestehender Organization-/Account-Datenbank nicht rotiert.
- `FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY` wird bei vorhandenen Recovery-Zeilen nicht rotiert.
- Fehlt ein solcher Secret bei vorhandenen Daten, bricht der Workflow fail-closed ab.
- Eine Generierung eines fehlenden TOTP-/Recovery-Secrets ist nur bei leerem, sicherem Staging-Zustand erlaubt.
- Der persistente Deploy darf bestehende Organizations, Accounts, Campaigns, Memberships, Kommentare oder Room-Credentials weder löschen noch zurücksetzen.

## Disposable Plan-031-Acceptance

- Workflow: `.github/workflows/plan031-live-staging.yml`;
- Worker: `flyer-map-admin-acceptance`;
- D1: `flyer-map-admin-acceptance-db`;
- Acceptance-Cleanup ist ausschließlich auf diese disposable Ressourcen begrenzt.

Der vollständig grüne aktuelle Lauf ist Run `34007347508` gegen Product-Head `b22114d4e15774e563d1581cb798ad52f87ccf96`. Er belegt:

- API-Matrix für Create, Hidden Room, Reveal, Rotation, Revoke, Close und Expiry;
- Recovery-Zeilen nach Rotation `2`, nach Revoke/Close/Expiry jeweils `0`;
- additive Migration `0020` mit AES-GCM-Recovery-Spalten und grüner Foreign-Key-Prüfung;
- Desktop- und Mobile-Chromium bei `390x844` ohne horizontalen Overflow;
- Launcher mit sieben Zielen und fokussierten Hubs Rooms, Kommentare und Streets;
- finalen Safety-Worker mit `/start=200`, unauthenticated `/me=401`, `HEAD=405`, fremdem Origin `403`;
- `production_untouched=true` und finalen Cleanup auf null disposable Acceptance-Daten.

Der persistent grüne Deploy-Nachweis ist Run `34007250234` gegen denselben Product-Head. Sein Safety-Nachweis bestätigt identische Vorher-/Nachher-Zählungen, grüne Foreign Keys und `no_cleanup=true`.

## Static Asset Security Headers

Cloudflare Workers Static Assets können HTML direkt vor dem Worker bedienen. Deshalb reicht die Härtung in `worker/indexOrganizer.ts` für `/start` und andere statische Antworten nicht aus.

`public/_headers` setzt für alle statischen Assets:

- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Cross-Origin-Opener-Policy: same-origin`.

Der Organizer-Worker setzt dieselben Header weiterhin für Worker-generierte Antworten.

## Release-Ablauf

### Persistent manuelles Staging

1. Feature-Head, PR #76 und exact-head CI neu verifizieren.
2. Committed Production Wrangler gegen `indexFc52.ts`, Production-D1 und 91714001-3 prüfen.
3. Exakte Staging-Konfiguration materialisieren und Production-/RxDB-D1 IDs fail-closed ausschließen.
4. Vorhandene Secrets per Cloudflare API prüfen; bei Datenbestand niemals rotieren.
5. Migrationen ausschließlich auf `flyer-map-admin-staging-db` anwenden.
6. D1-Zählungen vor dem Deploy sichern.
7. Worker deployen, öffentliche Safety-Endpunkte prüfen und D1-Zählungen danach vergleichen.
8. Bei jeder Abweichung oder fehlender bestehender Secret-Konfiguration fail-closed abbrechen.

### Disposable Acceptance

1. aktuellen Product-Head exakt aus PR #76 auschecken;
2. isolierte Acceptance-Konfiguration materialisieren;
3. Migrationen nur auf `flyer-map-admin-acceptance-db` anwenden;
4. API-, Crypto-, Desktop- und Mobile-Tests durchführen;
5. ausschließlich Acceptance-Testdaten löschen;
6. Evidence und Foreign Keys prüfen;
7. Persistent-Staging-Daten und Secrets niemals anfassen.

## Production-Gate

Ein grünes Admin-Staging ist keine Production-Freigabe. Production-D1-Migrationen 0017/0018/0019, Production-Worker-Wechsel, PR-Merge oder Ready-for-Review benötigen weiterhin einen separaten ausdrücklichen Auftrag.
